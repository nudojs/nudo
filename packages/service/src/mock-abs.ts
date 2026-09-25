/**
 * @nudo:mock / sinon 指令 → Abs seed（供 B 路径注入：runTranspiled
 * envGlobals / mockSeedsToAbsMocks）。
 * host 层：依赖 parser 指令形态；core 只吃 Abs 绑定。
 */

import type { Node } from "@babel/types";
import { extractDirectives, type FunctionWithDirectives } from "@nudojs/parser";
import { parse, parseCaseArgExpr } from "@nudojs/parser";
import type { MockHelper } from "@nudojs/core";
import {
  type Abs,
  absFunction,
  emptyEnv,
  abs as makeAbs,
  confJoin,
  unknown as absUnknown,
  litValue,
  formatAbs,
  getFnImpl,
  tryRunTranspiled,
  bindingsOf,
  callTranspiledExportFull,
} from "@nudojs/core";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";

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
  const av = litValue(actual);
  const dv = litValue(declared);
  if (dv !== undefined) {
    return av !== undefined && Object.is(av, dv);
  }
  // declared 是 prim（如 number()）：接受同源字面量或同 prim
  if (declared.shape.k === "prim") {
    if (actual.shape.k === "prim") return actual.shape.type === declared.shape.type;
    if (av !== undefined) {
      const t = typeof av;
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
    defaultReturn = makeAbs({ k: "never" }, undefined, undefined, "exact");
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
    return constantMockFn(makeAbs({ k: "never" }, undefined, undefined, "exact"));
  }
  if (sinonExpr.returnValue) {
    return constantMockFn(sinonExpr.returnValue);
  }
  return constantMockFn(absUnknown);
}

export type AbsMockSeeds = {
  seedVars: Record<string, Abs>;
  seedFns: Record<string, { params: string[]; body: Node; async?: boolean; fingerprint?: string }>;
  /** `@nudo:mock name from "path"` 解析失败（缺文件 / 缺绑定 / 求值失败）——fail-closed 诊断用 */
  fromErrors?: FromMockError[];
};

export type FromMockError = {
  name: string;
  fromPath: string;
  message: string;
};

function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/**
 * `@nudo:mock name from "path"`：装载 mock 模块并取与 mock 同名的绑定，
 * 种成 B 路径 Abs seed（与内联 mock 同一注入通道）。
 * 缺文件 / 求值失败 / 无同名绑定 → 返回 error，不静默丢弃、不造假类型。
 */
function loadFromMockBinding(
  name: string,
  fromPath: string,
  fromFile: string | undefined,
  loadModule: LoadModule | undefined,
): { abs?: Abs; error?: string } {
  const load = loadModule ?? defaultLoadModule;
  const base = fromFile ?? `${process.cwd()}/<mock-from>`;
  let source: string | undefined;
  try {
    source = load(fromPath, base);
  } catch {
    source = undefined;
  }
  if (source === undefined) {
    return { error: `Mock file not found for '${name}' (from "${fromPath}")` };
  }
  let run: Record<string, unknown> | undefined;
  try {
    // exec 模式：mock 文件需完整求值顶层绑定/导出（analyze 会剥掉非纯顶层）
    run = tryRunTranspiled(source, { mode: "exec" });
  } catch {
    run = undefined;
  }
  if (!run) {
    return { error: `Mock file "${fromPath}" failed to evaluate` };
  }
  let val: unknown = run[name];
  if (val === undefined) {
    const binds = bindingsOf(run);
    val = binds?.get(name);
  }
  if (val === undefined) {
    return {
      error: `Mock file "${fromPath}" does not define a binding named '${name}'`,
    };
  }
  let absVal: Abs;
  if (isAbsVal(val)) {
    absVal = val;
  } else if (typeof val === "function") {
    const fn = val as { length?: number };
    const params = Array.from({ length: fn.length ?? 0 }, (_, i) => `arg${i}`);
    absVal = absFunction(params, {
      apply: (args: Abs[]): Abs => callTranspiledExportFull(run!, name, args).result,
      kind: "bpath-export",
      fingerprint: `from-mock=${fromPath}#${name}`,
    });
  } else {
    absVal = absUnknown;
  }
  return { abs: markMockConf(absVal) };
}

/**
 * B 路径注入用：seedVars + seedFns 统一为 Abs 函数绑定。
 * arrowFn mock 落在 seedFns（AST body，供 ast-eval），B 路径的
 * envGlobals 注入只吃 Abs——不合并会把 mock 丢掉，函数体内的调用
 * 会落到真实原生函数（如 fetch 拿 Abs 当 URL，直接崩）。
 */
export function mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs> {
  const out: Record<string, Abs> = { ...seeds.seedVars };
  for (const [name, fn] of Object.entries(seeds.seedFns)) {
    out[name] = absFunction(fn.params, { body: fn.body, async: fn.async ?? false });
  }
  return out;
}

/** 从函数上的 @nudo:mock 指令收集 Abs seed */
export function mockDirectivesToAbsSeeds(
  functions: Array<{ directives: FunctionWithDirectives["directives"] }>,
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
  for (const fn of functions) {
    for (const d of fn.directives) {
      if (d.kind !== "mock") continue;
      if (d.fromPath) {
        const r = loadFromMockBinding(d.name, d.fromPath, opts?.fromFile, opts?.loadModule);
        if (r.abs) {
          seedVars[d.name] = r.abs;
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
        seedFns[d.name] = {
          params: d.arrowFn.params,
          body,
          async: false,
          fingerprint: `fake=${d.arrowFn.params.join(",")}:${astContentKey(body)}`,
        };
      } else if (d.nudoMock) {
        seedVars[d.name] = markMockConf(absFromMockHelper(d.nudoMock));
      } else if (d.sinonExpr) {
        seedVars[d.name] = markMockConf(absFromSinon(d.sinonExpr));
      } else if (d.expression) {
        // `= T.number` 等类型值 mock：此前只进 TypeValue env（applyMocks），
        // B 路径注入只吃 seed → 被当 unknown 全局（nudo:builtin-unknown）。
        // 桥进 seedVars 后两条路径口径一致。
        try {
          seedVars[d.name] = parseCaseArgExpr(d.expression);
        } catch {
          seedVars[d.name] = absUnknown;
        }
      }
    }
  }
  return { seedVars, seedFns, ...(fromErrors.length > 0 ? { fromErrors } : {}) };
}

/** 便捷入口：源码 → @nudo:mock 的 B 注入 Abs 绑定（checkSource 注入管线用） */
export function mockSeedsForSource(
  source: string,
  opts?: { fromFile?: string; loadModule?: LoadModule },
): Record<string, Abs> {
  const fns = extractDirectives(parse(source));
  return mockSeedsToAbsMocks(mockDirectivesToAbsSeeds(fns, opts));
}
