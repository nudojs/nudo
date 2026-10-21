/**
 * @nudo:mock / sinon 指令 → Abs seed（供 求值引擎注入：runTranspiled
 * envGlobals / mockSeedsToAbsMocks）。
 * host 层：依赖 parser 指令形态；core 只吃 Abs 绑定。
 *
 * 不变量（族 14 · 分片 I）：
 * - **作用域**：@nudo:mock 是**函数级**指令 ⇒ 同名 mock 被多个函数各自声明时，
 *   平表只作兜底（后者胜出），真值按作用域取（`scoped` + 覆盖表，
 *   载体键 MOCK_SCOPE_OVERRIDES ⇒ 随 inject.mocks 流转，core 的按函数求值
 *   边界取本函数那一份）。
 * - **可构造性**：内联 mock 按载荷形态带 `ctor` facet（箭头/generator/async
 *   不可构造；function/class 表达式可构造）——与 `from` 形态的
 *   hostFnCtorFacet 同口径，$new 的「定抛 vs may-throw」不再两条路径分叉。
 * - **rejects**：`stub().rejects(e)` 建模成「必定 reject 的 promise」
 *   （不是 never——never 会让返回契约空洞成立）。
 */

import type { Node } from "@babel/types";
import { extractDirectivesQuiet, type FunctionWithDirectives } from "@nudojs/parser";
import { parse, parseCaseArgExpr } from "@nudojs/parser";
import type { MockHelper } from "@nudojs/core";
import {
  type Abs,
  absFunction,
  emptyEnv,
  abs as makeAbs,
  confJoin,
  unknown as absUnknown,
  undefAbs,
  litValue,
  formatAbs,
  getFnImpl,
  hostFnCtorFacet,
  tryRunTranspiled,
  bindingsOf,
  callTranspiledExportApply,
  CONSTRAINT_EXPR_RE,
} from "@nudojs/core";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { evalMockFileWithDeps } from "./mock-file.ts";
import { DIAG } from "@nudojs/core/internal";

/**
 * mock 依赖结果 conf 不得高于 mock。
 * 必须保留同一对象身份：absFunction 的 impl 挂在 WeakMap 上，
 * makeAbs 新建对象会丢掉 body/apply。
 */
function markMockConf(a: Abs): Abs {
  a.conf = confJoin(a.conf, "mock");
  return a;
}

/** Structural content key for mock body AST (callsFake etc.). */
function astContentKey(n: unknown, depth = 0): string {
  if (n == null || depth > 24) return "";
  if (typeof n !== "object") return String(n);
  if (Array.isArray(n)) return n.map((x) => astContentKey(x, depth + 1)).join(",");
  const obj = n as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";
  const parts: string[] = [type];
  for (const key of ["name", "value", "raw", "operator", "computed"]) {
    const v = obj[key];
    if (v !== undefined && (typeof v !== "object" || v === null)) parts.push(`${key}=${String(v)}`);
  }
  for (const key of Object.keys(obj)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments" ||
      key === "type" ||
      key === "name" ||
      key === "value" ||
      key === "raw" ||
      key === "operator" ||
      key === "computed"
    ) {
      continue;
    }
    const v = obj[key];
    if (v && typeof v === "object") parts.push(`${key}:{${astContentKey(v, depth + 1)}}`);
  }
  return parts.join("|");
}

function stampFingerprint(a: Abs, fp: string): Abs {
  const impl = getFnImpl(a);
  if (impl) impl.fingerprint = fp;
  return a;
}

/**
 * 内联 mock 载荷的**可构造性** facet（Bug 482）。
 * 与 `from` 形态的 hostFnCtorFacet 同口径：
 * - 箭头函数（含 async 箭头）/ 方法简写 / generator / async function → 不可构造
 * - 普通 function 表达式 / class 表达式 → 可构造
 * 判不出 ⇒ undefined（未知：$new 走 may-throw 软路径，不硬抛）。
 */
function inlineCtorFacet(expr: string | undefined): boolean | undefined {
  if (!expr) return undefined;
  // callsFake 包裹：引擎把 mock 建成**载荷函数本身**（seedFns 走 AST body）
  // ⇒ 可构造性取内层载荷的形态。
  const chain = expr.match(/^(?:sinon\.)?stub\(\)\.callsFake\((.+)\)$/);
  const payload = (chain ? chain[1]! : expr).trim();
  if (!payload) return undefined;
  let init: Node | undefined;
  try {
    const file = parse(`const __mock = ${payload};`);
    const decl = file.program.body[0];
    if (decl?.type === "VariableDeclaration") {
      init = decl.declarations[0]?.init ?? undefined;
    }
  } catch {
    return undefined;
  }
  if (!init) return undefined;
  if (init.type === "ArrowFunctionExpression") return false;
  if (init.type === "FunctionExpression") return !init.generator && !init.async;
  if (init.type === "ClassExpression") return true;
  return undefined;
}

/** 用常量 Abs 造 mock 函数：调用即返回该值（结果 conf 标 mock） */
function constantMockFn(result: Abs): Abs {
  const marked = markMockConf(result);
  const mockEnv = emptyEnv();
  const retName = "__nudo_mock_ret";
  mockEnv.vars.set(retName, marked);
  const body = {
    type: "BlockStatement",
    body: [
      {
        type: "ReturnStatement",
        argument: { type: "Identifier", name: retName },
      },
    ],
  } as unknown as Node;
  let retKey: string;
  try {
    retKey = formatAbs(marked);
  } catch {
    retKey = "?";
  }
  return stampFingerprint(
    markMockConf(absFunction(["...args"], { body, env: mockEnv })),
    `ret=${retKey}`,
  );
}

/**
 * withArgs 实参匹配：
 * - 字面量声明要求实参同值字面量
 * - prim 声明接受同源字面量或同 prim
 */
function absArgMatches(declared: Abs, actual: Abs | undefined): boolean {
  if (!actual) return false;
  const avR = litValue(actual);
  const dvR = litValue(declared);
  // 「是否字面量」必须看 ok：lit(undefined) 的 value 就是 undefined，
  // 用 value !== undefined 当门闩会把 withArgs(undefined) 永远判不中。
  if (dvR.ok) {
    return avR.ok && Object.is(avR.value, dvR.value);
  }
  // declared 是 prim（如 number()）：接受同源字面量或同 prim
  if (declared.shape.k === "prim") {
    if (actual.shape.k === "prim") return actual.shape.type === declared.shape.type;
    if (avR.ok) {
      const t = typeof avR.value;
      return (
        (declared.shape.type === "number" && t === "number") ||
        (declared.shape.type === "string" && t === "string") ||
        (declared.shape.type === "boolean" && t === "boolean") ||
        (declared.shape.type === "bigint" && t === "bigint")
      );
    }
  }
  // unknown 声明不视为可证明匹配
  return false;
}

function dispatchMockFn(defaultReturn: Abs, cases?: { args: Abs[]; returnValue: Abs }[]): Abs {
  if (!cases?.length) return constantMockFn(defaultReturn);
  const caseAbs = cases.map((c) => ({
    declared: c.args,
    result: markMockConf(c.returnValue),
  }));
  const dummyBody = {
    type: "BlockStatement",
    body: [{ type: "ReturnStatement", argument: null }],
  } as unknown as Node;
  const markedDefault = markMockConf(defaultReturn);
  let defaultKey: string;
  try {
    defaultKey = formatAbs(markedDefault);
  } catch {
    defaultKey = "?";
  }
  const caseKey = cases
    .map(
      (c) =>
        `${c.args.map((a) => formatAbs(a)).join(",")}->${formatAbs(c.returnValue)}`,
    )
    .join("|");
  return stampFingerprint(
    markMockConf(
      absFunction(["...args"], {
        body: dummyBody,
        env: emptyEnv(),
        apply: (args: Abs[]): Abs => {
          for (const c of caseAbs) {
            if (c.declared.every((d, i) => absArgMatches(d, args[i]))) {
              return c.result;
            }
          }
          return markedDefault;
        },
      }),
    ),
    `dispatch=default=${defaultKey};cases=${caseKey}`,
  );
}

function absFromMockHelper(h: MockHelper): Abs {
  if (h.callsFakeImpl) {
    const { params, body, async } = h.callsFakeImpl;
    return stampFingerprint(
      absFunction(params, { body: body as never, async: async ?? false }),
      `fake=${params.join(",")}:${astContentKey(body)}`,
    );
  }

  let defaultReturn: Abs;
  if (h.resolvedValue) {
    defaultReturn = makeAbs(
      { k: "eff", eff: "promise", inner: h.resolvedValue },
      undefined,
      undefined,
      "path",
    );
  } else if (h.rejectedValue) {
    // Bug 488：`stub().rejects(e)` 的语义是「返回一个必定 reject 的 promise」，
    // 旧建模是 `never`（「没有值」的形状）⇒ never ⊑ 任意返回类型 ⇒ 返回契约
    // 空洞成立（假绿）+ 签名/dts 写出 `never`。
    // 与 resolves 分支同形（eff/promise）；内层 never = 永不 fulfill
    // （reject 的值不是 fulfillment 类型），sync/async 两面口径一致。
    defaultReturn = makeAbs(
      {
        k: "eff",
        eff: "promise",
        inner: makeAbs({ k: "never" }, undefined, undefined, "exact"),
      },
      undefined,
      undefined,
      "path",
    );
  } else if (h.returnValue) {
    defaultReturn = h.returnValue;
  } else if (h.onFirstCallValue) {
    // 无 returnValue 时 onFirstCall 作默认返回
    defaultReturn = h.onFirstCallValue;
  } else {
    defaultReturn = absUnknown;
  }

  return dispatchMockFn(defaultReturn, h.withArgsCases);
}

function absFromSinon(sinonExpr: {
  type: string;
  returnValue?: Abs;
  resolvedValue?: Abs;
  rejectedValue?: Abs;
}): Abs {
  if (sinonExpr.resolvedValue) {
    return constantMockFn(
      makeAbs(
        { k: "eff", eff: "promise", inner: sinonExpr.resolvedValue },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  if (sinonExpr.rejectedValue) {
    // Bug 488：同 nudo 形态——reject 的 promise（不是 never）
    return constantMockFn(
      makeAbs(
        {
          k: "eff",
          eff: "promise",
          inner: makeAbs({ k: "never" }, undefined, undefined, "exact"),
        },
        undefined,
        undefined,
        "path",
      ),
    );
  }
  if (sinonExpr.returnValue) {
    return constantMockFn(sinonExpr.returnValue);
  }
  return constantMockFn(absUnknown);
}

export type AbsMockSeeds = {
  seedVars: Record<string, Abs>;
  seedFns: Record<string, { params: string[]; body: Node; async?: boolean; fingerprint?: string; ctor?: boolean }>;
  /**
   * 按**函数作用域**分组的 mock 种子（Bug 455）。
   * `@nudo:mock` 是函数级指令（parser 用 listFnDirectiveScopes 绑到最近的
   * 函数），同名 mock 被两个函数各自声明时，平表「后者胜出」会把先声明的
   * 函数改写成错类型 ⇒ 这里保留每个作用域各自的那一份。
   */
  scoped?: AbsMockScopeSeeds[];
  /** `@nudo:mock name from "path"` 解析失败（缺文件 / 缺绑定 / 求值失败）——fail-closed 诊断用 */
  fromErrors?: FromMockError[];
};

/** 单个函数作用域内的 mock 种子 */
export type AbsMockScopeSeeds = {
  /** 作用域名（parser 的函数作用域名：函数名 / `C.m` / `owner.m`） */
  scope: string;
  seedVars: Record<string, Abs>;
  seedFns: AbsMockSeeds["seedFns"];
};

/**
 * 作用域 mock 覆盖表的载体键（Bug 455）。
 * `Symbol.for` ⇒ 跨包同一注册表符号：service 侧造表、core 侧（按函数求值的
 * 边界）取本函数那一份；键是 symbol ⇒ 不进 `Object.keys` ⇒ 不会被当成
 * mock 名注入成模块级绑定，也不污染 inject 指纹。
 */
export const MOCK_SCOPE_OVERRIDES: unique symbol = Symbol.for("nudo.mock.scopeOverrides");

export type FromMockError = {
  name: string;
  fromPath: string;
  message: string;
  /** 缺省 nudo:module-missing；表达式解析失败 = nudo:mock-invalid */
  code?: string;
};

function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/**
 * `@nudo:mock name from "path"`：装载 mock 模块并取与 mock 同名的绑定，
 * 种成 求值引擎 Abs seed（与内联 mock 同一注入通道）。
 * 缺文件 / 求值失败 / 无同名绑定 → 返回 error，不静默丢弃、不造假类型。
 */
function loadFromMockBinding(
  name: string,
  fromPath: string,
  fromFile: string | undefined,
  loadModule: LoadModule | undefined,
): { abs?: Abs; error?: string } {
  const base = fromFile ?? `${process.cwd()}/<mock-from>`;
  // mock 文件自身相对 import：走 abs 模块图（绝对路径入口），不是裸 exec
  const evaled = evalMockFileWithDeps(fromPath, base, loadModule);
  if (!evaled.ok) {
    return {
      error:
        evaled.kind === "not-found"
          ? `Mock file not found for '${name}' (from "${fromPath}")`
          : evaled.error,
    };
  }
  const run = evaled.run;
  // 「名存在但值 undefined」≠「从未绑定」：用 in / Map.has 判存在，
  // 与 evalExportsToModuleExports 保留 undefined 槽位同口径
  let val: unknown;
  let found = false;
  if (name in run) {
    val = run[name];
    found = true;
  } else {
    const binds = bindingsOf(run);
    if (binds?.has(name)) {
      val = binds.get(name);
      found = true;
    }
  }
  if (!found) {
    return {
      error: `Mock file "${fromPath}" does not define a binding named '${name}'`,
    };
  }
  let absVal: Abs;
  if (val === undefined) {
    // 名存在但值 undefined：保留槽位为 undefAbs（与 evalExportsToModuleExports 同口径）
    absVal = undefAbs();
  } else if (isAbsVal(val)) {
    absVal = val;
  } else if (typeof val === "function") {
    const fn = val as { length?: number };
    const params = Array.from({ length: fn.length ?? 0 }, (_, i) => `arg${i}`);
    // Bug 9：求值模块的宿主函数导出（函数声明产物）——generator/async 不可
    // new，普通声明可 new。可构造性 facet 进 shape（$new 校验）。
    const ctorFacet = hostFnCtorFacet(val as Function);
    absVal = absFunction(params, {
      // H1：throws 面经 apply 返回值通道保留（callTranspiledExportApply），
      // $call 统一路由——mock 桥与导出桥同一通道（BUG-006 根治）。
      apply: callTranspiledExportApply(run!, name),
      kind: "eval-export",
      fingerprint: `from-mock=${fromPath}#${name}`,
    }, ctorFacet !== undefined ? { ctor: ctorFacet } : undefined);
  } else {
    absVal = absUnknown;
  }
  return { abs: markMockConf(absVal) };
}

/**
 * 求值引擎注入用：seedVars + seedFns 统一为 Abs 函数绑定。
 * arrowFn mock 落在 seedFns（AST body，供 ast-eval），求值引擎的
 * envGlobals 注入只吃 Abs——不合并会把 mock 丢掉，函数体内的调用
 * 会落到真实原生函数（如 fetch 拿 Abs 当 URL，直接崩）。
 *
 * Bug 455：同名 mock 被多个函数各自声明时，作用域覆盖表随表一起流转
 * （MOCK_SCOPE_OVERRIDES 载体键）⇒ 按函数求值的边界取本函数那一份，
 * 平表保留「后者胜出」的兜底语义（无作用域信息的老路径不受影响）。
 */
export function mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs> {
  const out: Record<string, Abs> = { ...seeds.seedVars };
  for (const [name, fn] of Object.entries(seeds.seedFns)) {
    out[name] = absOfSeedFn(fn);
  }
  const overrides = mockScopeOverrides(seeds);
  if (overrides) {
    (out as unknown as Record<symbol, unknown>)[MOCK_SCOPE_OVERRIDES] = overrides;
  }
  return out;
}

/** seedFns 条目 → Abs 函数绑定（可构造性 facet 随条目走，Bug 482） */
function absOfSeedFn(fn: AbsMockSeeds["seedFns"][string]): Abs {
  return absFunction(
    fn.params,
    { body: fn.body, async: fn.async ?? false },
    fn.ctor !== undefined ? { ctor: fn.ctor } : undefined,
  );
}

/**
 * 作用域覆盖表（Bug 455）：只收**被多个作用域同名声明**的 mock——
 * 未冲突的 mock 全文件同一份（保持既有「文件级可见」语义），
 * 冲突的按声明作用域各取各的。
 */
function mockScopeOverrides(
  seeds: AbsMockSeeds,
): Record<string, Record<string, Abs>> | undefined {
  const scopes = seeds.scoped;
  if (!scopes || scopes.length < 2) return undefined;
  const scopesOfName = new Map<string, string[]>();
  const note = (name: string, scope: string): void => {
    const list = scopesOfName.get(name);
    if (!list) {
      scopesOfName.set(name, [scope]);
      return;
    }
    // 同一作用域内重复声明同一名（两个 @nudo:mock getPort）不算冲突
    if (!list.includes(scope)) list.push(scope);
  };
  for (const s of scopes) {
    for (const name of Object.keys(s.seedVars)) note(name, s.scope);
    for (const name of Object.keys(s.seedFns)) note(name, s.scope);
  }
  const conflicts = [...scopesOfName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name]) => name);
  if (conflicts.length === 0) return undefined;
  const out: Record<string, Record<string, Abs>> = {};
  for (const s of scopes) {
    const own: Record<string, Abs> = {};
    for (const name of conflicts) {
      const v = s.seedVars[name] ?? (s.seedFns[name] ? absOfSeedFn(s.seedFns[name]) : undefined);
      if (v) own[name] = v;
    }
    if (Object.keys(own).length > 0) out[s.scope] = own;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 取 inject.mocks 上挂的作用域覆盖表（core 的按函数求值边界用） */
export function mockScopeOverridesOf(
  mocks: Record<string, Abs> | undefined,
): Record<string, Record<string, Abs>> | undefined {
  if (!mocks) return undefined;
  return (
    mocks as unknown as Record<symbol, Record<string, Record<string, Abs>> | undefined>
  )[MOCK_SCOPE_OVERRIDES];
}

/**
 * 按函数作用域选 mock（同名 mock 各归各函数，Bug 455）。
 * scope 无覆盖 ⇒ 原表（未冲突的 mock 仍是文件级可见）。
 */
export function mockScopeSelected(
  mocks: Record<string, Abs>,
  scope: string,
): Record<string, Abs> {
  const own = mockScopeOverridesOf(mocks)?.[scope];
  return own ? { ...mocks, ...own } : mocks;
}

/** 从函数上的 @nudo:mock 指令收集 Abs seed */
export function mockDirectivesToAbsSeeds(
  functions: Array<{ directives: FunctionWithDirectives["directives"]; name?: string }>,
  opts?: {
    /** `@nudo:mock name from "path"` 相对解析基准（被分析文件） */
    fromFile?: string;
    /** 自定义装载器（LSP buffer-aware）；缺省 defaultLoadModule */
    loadModule?: LoadModule;
  },
): AbsMockSeeds {
  const seedVars: Record<string, Abs> = {};
  const seedFns: AbsMockSeeds["seedFns"] = {};
  const fromErrors: FromMockError[] = [];
  // 作用域分组（Bug 455）：同名 mock 各归各声明函数——平表只保「后者胜出」
  // 的兜底语义，作用域表保真（core 的按函数求值边界按 scope 取用）。
  const scoped: AbsMockScopeSeeds[] = [];
  for (const fn of functions) {
    const scope = typeof fn.name === "string" ? fn.name : "";
    let scopeVars: Record<string, Abs> | undefined;
    let scopeFns: AbsMockSeeds["seedFns"] | undefined;
    const putVar = (name: string, abs: Abs): void => {
      seedVars[name] = abs;
      if (!scope) return;
      scopeVars ??= {};
      scopeVars[name] = abs;
    };
    const putFn = (name: string, seed: AbsMockSeeds["seedFns"][string]): void => {
      seedFns[name] = seed;
      if (!scope) return;
      scopeFns ??= {};
      scopeFns[name] = seed;
    };
    for (const d of fn.directives) {
      if (d.kind !== "mock") continue;
      if (d.fromPath) {
        const r = loadFromMockBinding(d.name, d.fromPath, opts?.fromFile, opts?.loadModule);
        if (r.abs) {
          putVar(d.name, r.abs);
        } else {
          fromErrors.push({
            name: d.name,
            fromPath: d.fromPath,
            message: r.error ?? `Mock file "${d.fromPath}" could not be loaded`,
          });
        }
        continue;
      }
      if (d.arrowFn) {
        const body = d.arrowFn.body as Node;
        putFn(d.name, {
          params: d.arrowFn.params,
          body,
          async: false,
          fingerprint: `fake=${d.arrowFn.params.join(",")}:${astContentKey(body)}`,
          // Bug 482：内联 mock 也要带可构造性 facet（与 `from` 形态同口径）
          ctor: inlineCtorFacet(d.expression),
        });
      } else if (d.nudoMock) {
        putVar(d.name, markMockConf(absFromMockHelper(d.nudoMock)));
      } else if (d.sinonExpr) {
        putVar(d.name, markMockConf(absFromSinon(d.sinonExpr)));
      } else if (d.expression) {
        // `= T.number` 等类型值 mock：此前只进 TypeValue env（applyMocks），
        // 求值引擎注入只吃 seed → 被当 unknown 全局（nudo:builtin-unknown）。
        // 桥进 seedVars 后两条路径口径一致。
        // fail-closed：解析失败不得静默 absUnknown——否则无法区分
        // 「mock 故意 unknown」与「表达式没解析出来」。
        const expr = d.expression.trim();
        const intentionalUnknown =
          expr === "unknown" ||
          expr === "any" ||
          /^T(\.|$)/.test(expr) ||
          CONSTRAINT_EXPR_RE.test(expr);
        try {
          const abs = parseCaseArgExpr(d.expression);
          const silentFallback =
            abs.shape.k === "unknown" && !abs.term && !intentionalUnknown;
          if (silentFallback) {
            fromErrors.push({
              name: d.name,
              fromPath: "(inline)",
              message: `Failed to parse mock expression for '${d.name}': ${d.expression}`,
              code: DIAG.mockInvalid,
            });
          } else {
            putVar(d.name, abs);
          }
        } catch (e) {
          fromErrors.push({
            name: d.name,
            fromPath: "(inline)",
            message: `Failed to parse mock expression for '${d.name}': ${
              e instanceof Error ? e.message : String(e)
            }`,
            code: DIAG.mockInvalid,
          });
        }
      }
    }
    if (scope && (scopeVars || scopeFns)) {
      const prev = scoped.find((s) => s.scope === scope);
      if (prev) {
        // 同名作用域（同名嵌套函数）⇒ 合并，后声明者覆盖
        Object.assign(prev.seedVars, scopeVars);
        Object.assign(prev.seedFns, scopeFns);
      } else {
        scoped.push({ scope, seedVars: scopeVars ?? {}, seedFns: scopeFns ?? {} });
      }
    }
  }
  return {
    seedVars,
    seedFns,
    ...(scoped.length > 0 ? { scoped } : {}),
    ...(fromErrors.length > 0 ? { fromErrors } : {}),
  };
}

/** 便捷入口：源码 → @nudo:mock 的 eval 注入 Abs 绑定（checkSource 注入管线用） */
export function mockSeedsForSource(
  source: string,
  opts?: { fromFile?: string; loadModule?: LoadModule },
): Record<string, Abs> {
  const fns = extractDirectivesQuiet(parse(source));
  return mockSeedsToAbsMocks(mockDirectivesToAbsSeeds(fns, opts));
}
