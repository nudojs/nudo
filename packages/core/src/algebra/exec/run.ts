/**
 * 进程内 求值引擎执行：transpile 源码 → new Function 跑在 runtime 上。
 * 不写临时文件；相对 import 用注入的 AbsModuleExports / JS 导出绑定。
 *
 * mode:
 * - "exec"（默认）：执行全部顶层（含副作用）
 * - "analyze"：只保留函数声明与纯字面量 const；跳过顶层表达式/循环/if
 *   ——分析入口安全，不触发 fetch 等顶层副作用
 */

import { rtAllBindings, compileRuntimeUnit, runtimeArgValues } from "./rt.ts";
import { parse as babelParse } from "@babel/parser";
import {
  enterEvalCallBudgetSession,
  exitEvalCallBudgetSession,
  setEvalBindingSink,
} from "./calls.ts";
import { withExecPhi, $copy } from "./runtime.ts";
import type { Abs } from "../abs.ts";
import type { Phi } from "../pred.ts";
import { never, unknown, abs, strLit } from "../abs.ts";
import { makeAbsApplyResult, type AbsApplyResult } from "../abs-fn.ts";
import { joinAbs } from "../objects.ts";
import { type AbsModuleExports, namespaceAbsOf, defaultImportBindingOf } from "../abs-modules.ts";
import { formatAbs } from "../format.ts";
import { transpile, transpileExpression, runtimeImportOf } from "./transpile.ts";
import { RUNTIME_IMPORT_RE } from "./transpile/runtime-import.ts";
import { ENV_SHADOW_SKIP_GLOBALS, HOST_INTRINSIC_SET } from "./transpile/intrinsics.ts";
import { NudoUnsupportedError } from "./unsupported.ts";
import { drainClassCollisions, beginClassEpoch } from "./class-registry.ts";
import { registerLiveImportRefresh, refreshLiveImports } from "./live-imports.ts";
import {
  stripStaticExportDecls,
  sourceTopLevelFunctionNames,
  IDENT_NAME_SRC,
} from "./export-names.ts";
import { errorTypeAbs, throwPayloadOf } from "./may-throw.ts";
import { drainPromiseMicros, errorBrandAbs } from "../builtins.ts";
import { sourceHasCjsExports, sourceHasEsmSyntax } from "../code-text.ts";
import { isNudoThrow, isNudoReturn, $isForkExit, runWithLoopExits, takeLoopExits, takeThrowExits, asAbsVal, withNewTargetReset, NudoThrow } from "./runtime.ts";
import { $call } from "./call.ts";
import { refineFnReturnType } from "./class.ts";
import {
  runWithCollectorScope,
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "../collector-scope.ts";

export type RunTranspiledOptions = {
  /** 说明符 → 依赖导出（host 模块图或 runTranspiled 产物） */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  maxLoopIters?: number;
  /** analyze = 跳过效应性顶层语句 */
  mode?: "exec" | "analyze";
  /** @nudo:replace 注入值：varName → Abs */
  replacements?: Record<string, Abs>;
  /** @nudo:replace 匹配表：传给 transpile（stmtStart/stmtEnd = **字符区间**
   *  `[start, end)`，非行号——Bug 166 起按 AST 节点身份定位） */
  replacementTargets?: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  /** @nudo:as 注入值：varName → Abs */
  asOverrides?: Record<string, Abs>;
  /** @nudo:as 语句范围表（stmtStart/stmtEnd = **字符区间**，非行号） */
  asOverrideTargets?: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  /** @nudo:env 全局 Abs（JSON/Math/console…）→ 作用域绑定 */
  envGlobals?: Record<string, Abs>;
  /** @nudo:mock 注入值：name → Abs（mockDirectivesToAbsSeeds 产物） */
  mocks?: Record<string, Abs>;
  /** 节点级 Abs 记录插桩（hover 重放用——透传 transpile 的
   * recordPositions：Identifier 值读 / 静态成员读包 $nodoPos） */
  recordPositions?: boolean;
  /** 宽松全局（调用点发现 exec 采集：未声明全局调用保守 unknown 不中断） */
  lenientGlobals?: boolean;
  /**
   * **关闭** async 体的生成器路径（`$async` 同步路径）——安全网。
   *
   * Bug 1139：生成器模式下 `await` 的位置表与转译侧脱节 ⇒ `yield` 落进嵌套
   * 箭头 ⇒ `new Function` SyntaxError ⇒ **整个模块**编译失败 ⇒ 全部导出
   * 丢失 ⇒ L2 闸门**假绿**（exit 0）。本开关让求值引擎能在生成器模式编译
   * 失败时**重试一次**（关闭生成器路径）⇒ 模块至少编译得出来 ⇒ 导出可见。
   */
  disableAsyncGen?: boolean;
};

/**
 * inject/modules **内容**指纹（memo 键）。对象身份对「每次新建同内容」
 * 的 CLI 注入不稳——同一语义的 inject 跨 checkSource 调用会 miss 缓存。
 */
export function runTranspiledOptionsMemoKey(
  opts: RunTranspiledOptions | undefined,
): string {
  if (!opts) return "-";
  const seen = new WeakSet<object>();
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === "function") return "fn";
    if (typeof v !== "object") return String(v);
    const obj = v as object;
    if (seen.has(obj)) return "@";
    seen.add(obj);
    if ("shape" in obj && "conf" in obj) {
      try {
        return formatAbs(obj as Abs);
      } catch {
        return "?abs";
      }
    }
    if (Array.isArray(v)) return `[${v.map(fmt).join(",")}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${k}:${fmt(o[k])}`)
      .join(",")}}`;
  };
  return fmt(opts);
}

/** 运行时 import 行剥离正则：单一真值源在 `transpile/runtime-import.ts`
 *  （body-fn.ts 共用同一定义）；本文件按公开面原样再导出。 */
export { RUNTIME_IMPORT_RE };

/** 相对 import → 从注入 modules 取绑定（Abs fn 包成 JS 可调用）。
 *  ESM live binding（Bug ②）：绑定是间接引用——首个 import 语句后注册
 *  refresh 闭包，$call 出口重读依赖当前导出值（见 live-imports.ts）。
 *
 *  Bug 273：mock 名与**模块级绑定**同名时，前置注入的 `let <名> = …` 与这里
 *  生成的 `let <名> = …` **重复声明** ⇒ new Function SyntaxError ⇒ 整文件
 *  求值失败（fail-closed unknown ⇒ 门禁绿灯 exit 0）。口径：**mock 覆盖
 *  import 绑定**（mock 是显式指令）——改写时直接读 mock 值，且**不**登记
 *  live-import 刷新（刷新会把 mock 冲掉）。 */
function rewriteUserImports(js: string, mockTable?: Record<string, Abs>): string {
  const refreshBinds: string[] = [];
  const mocked = (bind: string): boolean =>
    mockTable !== undefined && Object.hasOwn(mockTable, bind);
  const namedBindSrc = (bind: string, spec: string, imported: string): string => {
    if (mocked(bind)) {
      return `let ${bind} = __nudoEnv[${JSON.stringify(bind)}];`;
    }
    refreshBinds.push(
      `${bind} = __nudoBindImport(${JSON.stringify(spec)}, ${JSON.stringify(imported)});`,
    );
    return `let ${bind} = __nudoBindImport(${JSON.stringify(spec)}, ${JSON.stringify(imported)});`;
  };
  const nsBindSrc = (local: string, spec: string): string => {
    if (mocked(local)) {
      return `let ${local} = __nudoEnv[${JSON.stringify(local)}];`;
    }
    refreshBinds.push(`${local} = __nudoBindNamespace(${JSON.stringify(spec)});`);
    return `let ${local} = __nudoBindNamespace(${JSON.stringify(spec)});`;
  };
  let registered = false;
  const registerAfter = (line: string): string => {
    if (registered) return line;
    registered = true;
    return `${line}\n__NUDO_LIVE_IMPORT_REGISTER__;`;
  };
  // 混合形态：默认 + 命名空间 `import d, * as ns from "…"`（Bug 153）
  // ——默认走具名绑定（导出名 "default"），命名空间走 __nudoBindNamespace
  js = js.replace(
    /^import\s+([A-Za-z_$][\w$]*)\s*,\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];\s*$/gm,
    (_all, def: string, local: string, spec: string) =>
      registerAfter(`${namedBindSrc(def, spec, "default")}\n${nsBindSrc(local, spec)}`),
  );
  // namespace：transpile 会写成 `import { * as ns } from "…"`
  js = js.replace(
    /^import\s*\{\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, local: string, spec: string) => registerAfter(nsBindSrc(local, spec)),
  );
  // 无绑定副作用 import → 仅触发模块求值
  js = js.replace(
    /^import\s*["']([^"']+)["'];\s*$/gm,
    (_all, spec: string) => `void __nudoBindNamespace(${JSON.stringify(spec)});`,
  );
  js = js.replace(
    /^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, names: string, spec: string) => {
      const parts = names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return registerAfter(
        parts
          .map((p) => {
            const [imported, local] = p.split(/\s+as\s+/).map((x) => x.trim());
            const bind = local ?? imported;
            // Bug 177：任意模块导出名（`import { "a-b" as x }`）——重写时
            // 名字带引号，须去引号才是真正的导出名（带引号查不到 → unknown）
            const importedName = imported.replace(/^["'](.*)["']$/, "$1");
            return namedBindSrc(bind, spec, importedName);
          })
          .join("\n"),
      );
    },
  );
  // 多条 import 语句：注册闭包引用全部绑定（占位符在首个 import 位置，
  // 全部 rewrite 完成后替换为全量绑定——后续 import 的 `let` 文本位置在其后，
  // refresh 命中 TDZ 由 refreshLiveImports 容忍——绑定创建时读到的已是当前值）
  // Bug 456：闭包存进**模块域变量**（`__nudoRefreshKeep`）——注册表持弱引用
  // （live-imports.ts），闭包须由模块域强持有，否则模块域一死闭包即被回收，
  // 跨轮复用的模块实例（会话缓存）其 import 绑定就永久停在快照上。
  if (registered) {
    js = js.replace(
      "__NUDO_LIVE_IMPORT_REGISTER__;",
      `__nudoRegisterImportRefresh(__nudoRefreshKeep = () => { ${refreshBinds.join(" ")} });`,
    );
    js = `let __nudoRefreshKeep;\n${js}`;
  }
  return js;
}

/**
 * 分析模式：strip 顶层危险副作用与未知全局调用；保留本地函数调用（诊断依赖）。
 *
 * 结构化实现：Babel 解析 transpile 产物，按顶层语句节点整条剥除。历史上的
 * 行级正则 + `endsWith(";")` / 括号计数启发式在多类输入上静默改变程序语义：
 * - 多行语句（回调体内部行以 `;` / `}` 结尾）提前终止跳过 → 语句尾部悬空
 *   → `new Function` SyntaxError（与下方 $for 悬空修复同源的问题类）；
 * - 字符串/模板字面量里的未配对 `(`（如 `"fetch("`）被计入括号平衡 →
 *   连带误删后续顶层语句（export function 整体消失，导出静默 unknown）；
 * - 列 0 的 `catch (` 头匹配「未知全局调用」正则 → catch 头被剥 →
 *   顶层 try/catch 一律悬空 SyntaxError。
 * 剥除对象不变：transpile + import/export 改写后的 JS（runTranspiledInner 内序）。
 */
function stripEffectfulTopLevel(js: string): string {
  let body: import("@babel/types").Statement[];
  try {
    body = babelParse(js, {
      sourceType: "module",
      allowReturnOutsideFunction: true,
      attachComment: false,
    }).program.body;
  } catch {
    // transpile 产物按构造是可解析 JS；解析失败按「全部保留」降级，
    // 不让 strip 阶段引入新的失败面
    return js;
  }

  // 本文件内可解析的绑定名（函数/类/const/let/var/import）。先全量收集
  // 再判定——与旧实现两遍口径一致（顶层调用可先于声明文本出现）
  const declared = new Set<string>();
  for (const stmt of body) collectTopLevelDeclared(stmt, declared);

  const cuts: Array<[number, number]> = [];
  for (const stmt of body) {
    if (isEffectfulTopLevelStmt(stmt, declared)) cuts.push([stmt.start!, stmt.end!]);
  }
  if (cuts.length === 0) return js;

  // 按源区间整条切除，未动语句保持字节级原文——stripStaticExportDecls 等
  // 后续行锚定正则依赖行结构
  let out = "";
  let pos = 0;
  for (const [start, end] of cuts) {
    out += js.slice(pos, start);
    pos = end;
    // 吞掉语句残余 `;`；本行仅剩空白时连同换行一起吞（避免空行堆积）
    while (pos < js.length && js[pos] === ";") pos++;
    const nl = js.indexOf("\n", pos);
    const lineRest = js.slice(pos, nl === -1 ? js.length : nl);
    if (/^\s*$/.test(lineRest)) pos = nl === -1 ? js.length : nl + 1;
  }
  return out + js.slice(pos);
}

/** 顶层声明名收集（export 包裹展开；rewriteUserImports 已把 import 改写成
 *  let 绑定，ImportDeclaration 分支为未改写形态兜底） */
function collectTopLevelDeclared(
  stmt: import("@babel/types").Statement,
  declared: Set<string>,
): void {
  const decl =
    stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
      ? stmt.declaration
      : stmt;
  if (!decl) return;
  if (
    (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") &&
    decl.id
  ) {
    declared.add(decl.id.name);
    return;
  }
  if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations) {
      if (d.id.type === "Identifier") declared.add(d.id.name);
    }
    return;
  }
  if (decl.type === "ImportDeclaration") {
    for (const spec of decl.specifiers) declared.add(spec.local.name);
  }
}

/**
 * 模块级绑定名（顶层声明 + import 改写产生的 let + 引擎注入绑定）——env/mock
 * 注入的**撞名判定**用（Bug 273）。
 *
 * 解析失败 → null（调用方按「不注入」降级：宁可少注入，也不要再造一次重复
 * 声明 SyntaxError——那会把整个模块打成 fail-closed unknown）。
 * 解析口径先 module 后 script：module 严（strict-only 语法在 module 下报错），
 * script 松（sloppy CJS 源在 module 下解析失败）。
 */
function moduleLevelBindingNames(js: string): Set<string> | null {
  let body: import("@babel/types").Statement[] | null = null;
  for (const sourceType of ["module", "script"] as const) {
    try {
      body = babelParse(js, {
        sourceType,
        allowReturnOutsideFunction: true,
        attachComment: false,
      }).program.body;
      break;
    } catch {
      // 试下一种口径
    }
  }
  if (body === null) return null;
  const names = new Set<string>();
  for (const stmt of body) {
    collectTopLevelDeclared(stmt, names);
    const decl =
      stmt.type === "ExportNamedDeclaration" ||
      stmt.type === "ExportDefaultDeclaration"
        ? stmt.declaration
        : stmt;
    if (decl && decl.type === "VariableDeclaration") {
      // 解构声明的绑定名（collectTopLevelDeclared 只收 Identifier）
      for (const d of decl.declarations) {
        collectBindingPatternNames(
          d.id as unknown as import("@babel/types").PatternLike,
          names,
        );
      }
    }
  }
  // CJS 前导（后于注入拼入）占用的名字——撞名同样是重复声明
  names.add("exports");
  names.add("module");
  names.add("__nudoCjsOrig");
  names.add(CJS_THIS_BIND);
  return names;
}

/** 绑定模式里的名字（解构 `const {a, b} = x` → a / b）。 */
function collectBindingPatternNames(
  pattern: import("@babel/types").PatternLike,
  out: Set<string>,
): void {
  switch (pattern.type) {
    case "Identifier":
      out.add(pattern.name);
      return;
    case "ObjectPattern":
      for (const p of pattern.properties) {
        if (p.type === "RestElement") {
          collectBindingPatternNames(p.argument, out);
        } else {
          collectBindingPatternNames(
            p.value as unknown as import("@babel/types").PatternLike,
            out,
          );
        }
      }
      return;
    case "ArrayPattern":
      for (const el of pattern.elements) {
        if (el) collectBindingPatternNames(el, out);
      }
      return;
    case "AssignmentPattern":
      collectBindingPatternNames(pattern.left, out);
      return;
    case "RestElement":
      collectBindingPatternNames(pattern.argument, out);
      return;
    default:
      return;
  }
}

/**
 * 顶层副作用语句判定（剥除口径与旧行级实现一致）：
 * - 源形态危险全局：`console.*` 成员调用 / `fetch`·`setTimeout`·`setInterval`
 *   裸调用（transpile 后均已插桩为 $invoke/$callNamed，此分支为未插桩输入兜底）；
 * - `$callNamed("X", …)` 且 X 非本文件声明（fetch 等未知全局）→ 剥；
 * - 其它未知全局裸调用（非 `$` 前缀插桩、非 `__nudo*` 簿记、非本文件声明）→ 剥；
 * - 插桩控制流 `$for` / `$fork` / `$while*` 与源形态 if/for/while → 剥
 *   （顶层控制流依赖自由标识符，执行即 ReferenceError）。
 * 保留：函数/导出声明、本地调用、`$forOf`/`$switch`/`$throw`、赋值 IIFE、
 * `__nudoExport` 等簿记、try/catch。
 */
function isEffectfulTopLevelStmt(
  stmt: import("@babel/types").Statement,
  declared: Set<string>,
): boolean {
  switch (stmt.type) {
    case "ExpressionStatement":
      return isEffectfulTopLevelExpr(stmt.expression, declared);
    // 源形态控制流（transpile 后不出现，兜底口径与旧正则一致；do-while 旧正则不剥，保持）
    case "IfStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
      return true;
    default:
      return false;
  }
}

function isEffectfulTopLevelExpr(
  expr: import("@babel/types").Expression,
  declared: Set<string>,
): boolean {
  if (expr.type !== "CallExpression") return false;
  const callee = expr.callee;
  // 源形态危险全局：console.* （链根为 console 的成员调用）
  if (
    callee.type === "MemberExpression" &&
    memberChainRoot(callee) === "console"
  ) {
    return true;
  }
  // 方法链/函数值调用（$invoke 包裹等）外层非标识符 → 整条保留
  if (callee.type !== "Identifier") return false;
  const name = callee.name;
  // 源形态危险全局：裸 fetch/setTimeout/setInterval
  if (name === "fetch" || name === "setTimeout" || name === "setInterval") return true;
  // 顶层调用：$callNamed("localFn", …) 仅当 localFn 已声明时保留
  //（诊断需要执行本地顶层调用）；未知全局剥
  if (name === "$callNamed") {
    const first = expr.arguments[0];
    return first?.type === "StringLiteral" && !declared.has(first.value);
  }
  // 插桩控制流（$while 前缀含 $whileSeq）
  if (name === "$for" || name === "$fork" || name.startsWith("$while")) return true;
  // 其它未知全局裸调用；__nudoExport/__nudoExportStar/__nudoRecordBinding/
  // __nudoRecordAssign/__nudoRegisterImportRefresh 是簿记（rewrite/插桩产物），
  // 非副作用，保留（live import 注册剥离会让 analyze 模式丢失绑定刷新）
  return (
    !name.startsWith("$") &&
    name !== "__nudoExport" &&
    name !== "__nudoExportLazy" &&
    name !== "__nudoExportStar" &&
    name !== "__nudoRecordBinding" &&
    name !== "__nudoRecordAssign" &&
    name !== "__nudoRegisterImportRefresh" &&
    !declared.has(name)
  );
}

/** 成员链最左根标识符名（非标识符根返回 undefined） */
function memberChainRoot(member: import("@babel/types").MemberExpression): string | undefined {
  let node: import("@babel/types").Expression | import("@babel/types").Super = member.object;
  while (node.type === "MemberExpression") node = node.object;
  return node.type === "Identifier" ? node.name : undefined;
}

/**
 * 具名导入的绑定物化：**原样直出声明 Abs**（不再把 fn Abs 包成 JS 箭头 wrapper）。
 *
 * Bug 932：此前 fn Abs 被包成 `w = (...args) => $call(v, args)`（原 Abs 只挂在
 * `w.__nudoAbsFn` 上，没有任何一处在物化绑定时读它）⇒ 绑定值成了引擎为宿主
 * 函数合成的**裸 fn 形状**（无 `paramTypes` / 无 `returnType`）⇒ 值面退化成
 * 通用 fn，签名面渲染成**非法占位符** `() => ?`；而同一份 env 声明经
 * **命名空间**导入（`bindNamespace`：槽直填原 Abs）渲染成完整的
 * `(CallbackFn) => PromiseFn` ⇒ 同一文件、同一导出、两种导入形态两种类型。
 *
 * 直出原 Abs 后，具名与命名空间**共用同一物化逻辑**（都是原 Abs）⇒ 两种导入
 * 形态给出同一个类型；调用面照旧派发到同一份声明类型。
 *
 * **可调用性不丢**：Abs 一等函数在两条调用面上原生可派发——
 * 标识符调用走 `$callNamed`（Abs 分支 → `$call(fn, args)`，exec/calls.ts:769），
 * `new` 走 `$new`（Abs 分支 → exec/class/declare.ts:565）。JS wrapper 只在
 * 「宿主 JS 侧需要一个真函数」时才有意义，本路径没有这种需求。
 */
function bindImport(
  modules: RunTranspiledOptions["modules"],
  spec: string,
  name: string,
): unknown {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (name === "default") {
    // Bug 282：默认导入的绑定值走 core 单一事实源（defaultImportBindingOf）——
    // CJS 互操作模块（env 模块：node:fs…）的 default = **模块对象本身**
    // （= 命名空间）⇒ 与同一模块的命名空间导入给出同一个类型；用户模块缺
    // default ⇒ 仍是 unknown（Bug 990 口径，不得回退到命名空间）。
    const d = defaultImportBindingOf(mod);
    if (typeof d === "function") return d;
    return d as Abs;
  }
  const named = (mod as AbsModuleExports).named;
  const v = named?.[name];
  if (v === undefined) {
    const rec = (mod as Record<string, unknown>)[name];
    if (typeof rec === "function") return rec;
    // 缺名：unknown Abs（非 JS undefined）——re-export 走 __nudoExport 时留槽
    return unknown;
  }
  if (typeof v === "function") return v;
  return v as Abs;
}

/** `import * as ns`：整命名空间（named + default 槽）→ Abs 对象。
 *  ESM namespace 对象成员是 live binding（Bug ②）：`const N = U; mut(); N.x`
 *  原生仍读当前值——槽 value 经 getter 读取时解析依赖当前导出表（导出名集
 *  在命名空间构建时固定，与 ESM link-time 名集一致）。 */
function bindNamespace(modules: RunTranspiledOptions["modules"], spec: string): Abs {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (!mod.named) return unknown;
  const named = mod.named;
  const slots: Record<string, { value: Abs }> = {};
  const liveSlot = (read: () => Abs): { value: Abs } => {
    const slot = {} as { value: Abs };
    Object.defineProperty(slot, "value", { get: read });
    return slot;
  };
  for (const key of Object.keys(named)) {
    slots[key] = liveSlot(() => named[key]);
  }
  if (mod.default !== undefined) {
    slots["default"] = liveSlot(() => (mod as AbsModuleExports).default as Abs);
  }
  return abs({ k: "obj", slots, open: true }, undefined, undefined, "path");
}

/**
 * require 值解析（普通 require 与可选 require **共用**口径）：
 * `module.exports = X` 重赋值形态（cjsMain）→ 原生 require 返回 X 本身
 * （ms 等单函数导出包可直接调用），返回 default 而非命名空间对象——
 * Bug 10 的 obj-callee 定抛暴露了旧口径的形状失真（namespace obj 不可调）。
 * 否则 → 可 $get 的 namespace Abs。
 */
function requireValueOf(mod: AbsModuleExports): unknown {
  if (mod.cjsMain) {
    const d = (mod as AbsModuleExports).default;
    if (d !== undefined) return d;
  }
  if (mod.named) return namespaceAbsOf(mod);
  return mod;
}

/**
 * CJS require：modules[spec] → 可 $get 的 namespace Abs；非字符串 → unknown（不炸）。
 *
 * Bug 276：**缺失模块必须抛**（原生 require 缺失 → MODULE_NOT_FOUND）。
 * 此前缺失被当作普通值 `unknown` 返回 ⇒ 用户 try/catch 的 **catch 臂成死
 * 代码** ⇒ 引擎声称「不抛」⇒ L2 `nudo:entry-may-throw` 门禁**少报**。
 * 抛 NudoThrow（Error brand）：用户的 catch 臂可吸收（$catchVal 认
 * NudoThrow ⇒ 绑错误 Abs），未吸收则如实计入 throws 面。
 *
 * `loading` = 模块**装载期**（模块体正在求值）。装载期的 require 缺失 =
 * **模块装载失败**（原生 MODULE_NOT_FOUND 打断装载）——引擎保持既有降级
 * （该 require 折 unknown，文件其余部分照常分析；缺模块由诊断面
 * `nudo:module-missing` 报）。若装载期也抛 ⇒ 整文件装载失败 ⇒ 全文件
 * 退化 unknown ⇒ 门禁假绿（且顶层绑定未记录 ⇒ 跨文件契约检查失效）。
 * 调用期（模块已装载，导出函数被调用）的 require 缺失 = 抛 ✔。
 */
function requireFromModules(
  modules: RunTranspiledOptions["modules"],
  spec: string,
  loading: boolean,
): unknown {
  if (typeof spec !== "string") return unknown;
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) {
    if (loading) return unknown;
    throw new NudoThrow(
      errorBrandAbs("Error", [strLit(`Cannot find module '${spec}'`)]),
    );
  }
  return requireValueOf(mod);
}

/**
 * 可选 require（try/catch 双侧字面量）：优先成功侧——第一个能解析的 spec；
 * 全不能解析 → unknown（诚实降级，不假装某模块）。
 *
 * Bug 275：此前**漏了 cjsMain 分支**——`module.exports = X` 的模块经可选
 * require 拿到的是**命名空间**而非 X 本身（与普通 require 口径分叉）。
 */
function requireOptionalFromModules(
  modules: RunTranspiledOptions["modules"],
  specs: string[],
): unknown {
  if (!Array.isArray(specs)) return unknown;
  for (const spec of specs) {
    if (typeof spec !== "string") continue;
    const mod = modules?.[spec] as AbsModuleExports | undefined;
    if (!mod) continue;
    return requireValueOf(mod);
  }
  return unknown;
}

/** 导出语句后处理：specifier / re-export / star / default → __nudoExport 调用。
 *  静态声明导出（export function/const/let）走既有正则扫描 + 返回对象；
 *  冲突语义：显式导出（decl / specifier / 显式 re-export）压过 export *
 *  （ESM 早错保证 decl/specifier 不重名，star×star 按源序后者覆盖——
 *  与 collectAbsExports 顺序口径一致）。 */
function rewriteExportStatements(js: string): { js: string; exportedNames: string[] } {
  // export { x as y } from "spec"：绑定经 modules 表注入。
  // ESM live binding（Bug ②）：re-export 是间接引用——导出槽挂 getter，
  // 读取时经 __nudoBindImport 解析依赖当前值（依赖内部变异对导入方可见）。
  js = js.replace(
    /^export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, names: string, spec: string) =>
      names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => {
          const [local, exported] = p.split(/\s+as\s+/).map((x) => x.trim().replace(/^"|"$/g, ""));
          const exp = exported ?? local;
          return `__nudoExportLazy(${JSON.stringify(exp)}, () => __nudoBindImport(${JSON.stringify(spec)}, ${JSON.stringify(local)}));`;
        })
        .join("\n"),
  );
  // export * as ns from "spec"：命名空间 re-export（与 importLocalBindings 的
  // namespace open-obj 口径一致——__nudoBindNamespace 建 live 槽命名空间）
  // Bug 289：ES2022 **任意模块导出名**（`export * as "my-ns" from "…"`）此前
  // 不匹配本正则 ⇒ 语句原样泄漏 ⇒ new Function SyntaxError ⇒ **整个模块**
  // 求值失败 ⇒ 全部导出被静默清空 ⇒ L1 门禁假绿。名可标识符或**字符串
  // 字面量**（标识符口径与 export-names.ts 同一 IDENT_NAME_SRC）。
  js = js.replace(
    new RegExp(
      `^export\\s*\\*\\s+as\\s+(?:(${IDENT_NAME_SRC})|"([^"]*)"|'([^']*)')\\s*from\\s+["']([^"']+)["'];\\s*$`,
      "gmu",
    ),
    (
      _all,
      ident: string | undefined,
      dq: string | undefined,
      sq: string | undefined,
      spec: string,
    ) => {
      const ns = ident ?? dq ?? sq ?? "";
      return `__nudoExportLazy(${JSON.stringify(ns)}, () => __nudoBindNamespace(${JSON.stringify(spec)}));`;
    },
  );
  // export * from "spec"：并入 named（不含 default，ESM 语义）。
  // 描述符拷贝保留来源 getter（来源 named 表 live 化后传递 liveness）
  js = js.replace(
    /^export\s*\*\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, spec: string) => `__nudoExportStar(${JSON.stringify(spec)});`,
  );
  // export { a, b as c }：本地绑定重命名导出。
  // ESM live binding（Bug ②）：specifier 导出是绑定引用非值快照——
  // `export { x }; x = 2` 后导入方读 2（getter 读模块作用域当前值）
  js = js.replace(
    /^export\s*\{([^}]*)\};\s*$/gm,
    (_all, names: string) =>
      names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => {
          const [local, exported] = p.split(/\s+as\s+/).map((x) => x.trim().replace(/^"|"$/g, ""));
          return `__nudoExportLazy(${JSON.stringify(exported ?? local)}, () => ${local});`;
        })
        .join("\n"),
  );
  // Bug 156：`export { … }` 形态（解构导出 / 源级具名导出 / 再导出）的**导出名**
  // 收进显式导出面——此前只有 `export const|let` / `export function` 的静态声明名
  // 进该面（导出名回收正则认那两种形态），解构导出的真实名不在面内 ⇒ 与
  // `export *` 同时出现时优先级判错。
  const exportedNames: string[] = [];
  // `export default` 的导出名恒为 `default`（ESM 语义）——star 的 named 表
  // 即使畸形含 `default` 也不得填它；显式面在求值前就应包含 default
  // （真实导出名 = 静态声明 ∪ specifier/再导出 ∪ default ∪ CJS 合并名）。
  // 转译产物的字符串/模板字面量换行已 JSON 转义、注释不落盘 ⇒ 行首
  // `export default` 只会是真实语句（与 Bug 1121 的文本口径同前提）。
  const hasDefaultExport = /^export default\b/m.test(js);
  // export default <expr>;（transpile 保证函数/类默认已展开成命名 + 标识符形态）。
  // 表达式默认值（块体箭头/含方法对象）转译产物跨多行——`.` 不匹配换行的
  // 单行正则会整条漏改写（default 槽静默丢失）。按语句边界切分：从
  // `export default ` 起做括号深度扫描（跳过字符串字面量），深度归零且剩余
  // 仅 `;` 即语句完结。
  const rewritten = rewriteExportDefaults(js);
  if (hasDefaultExport) exportedNames.push("default");
  // 显式导出名：从改写产物（__nudoExportLazy("<名>", …)）回收——本地具名导出与
  // 再导出都是显式导出（ESM 早错保证不与 export * 撞名）。
  for (const m of rewritten.matchAll(/__nudoExportLazy\(\s*"([^"]+)"/g)) {
    exportedNames.push(m[1]!);
  }
  return { js: rewritten, exportedNames };
}

/** export default 语句完结判定：括号深度归零处剩余仅 `;`（+尾随空白）。
 *  完结时返回去 `;` 的表达式文本，否则 null。 */
function exportDefaultExprOf(expr: string): string | null {
  let depth = 0;
  for (let k = 0; k < expr.length; k++) {
    const c = expr[k]!;
    if (c === '"' || c === "'") {
      const quote = c;
      k++;
      while (k < expr.length && expr[k] !== quote) {
        if (expr[k] === "\\") k++;
        k++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) {
      return /^;\s*$/.test(expr.slice(k)) ? expr.slice(0, k) : null;
    }
  }
  return null;
}

function rewriteExportDefaults(js: string): string {
  const lines = js.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^export default /.test(line)) {
      out.push(line);
      continue;
    }
    let expr = line.slice("export default ".length);
    let done = exportDefaultExprOf(expr);
    let j = i;
    while (done === null && j + 1 < lines.length) {
      j++;
      expr += "\n" + lines[j]!;
      done = exportDefaultExprOf(expr);
    }
    if (done === null) {
      // 未完结（不应发生——transpile 产物语句完整）：原样保留
      out.push(line);
      continue;
    }
    out.push(`__nudoExport("default", ${done});`);
    i = j;
  }
  return out.join("\n");
}

/** runTranspiled 顶层绑定表（checkSource varAbs 通道；WeakMap 不碰返回面） */
const runBindings = new WeakMap<object, Map<string, unknown>>();

/**
 * env 全局注入时**不得**遮蔽的宿主内建名 = `HOST_INTRINSIC_SET`（与转译的
 * Identifier 发射判据同源：`expr/atom.ts` 对这三个名字按
 * `opts.shadowedIntrinsics` 分态——未遮蔽折字面量（`void 0` / `0/0` /
 * `1/0`）；被用户绑定遮蔽时发 `$absVal(<标识符>)`，由 JS 词法绑定决定读值）。
 *
 * 注入形式是模块级 `let <name> = __nudoEnv["<name>"]`（可写绑定，原生
 * globalThis 属性可赋值），会**取代**宿主全局：模块级 let 遮蔽 globalThis。
 * env 注入对面还绕过源 AST 声明扫描（转译器看不到注入，无法判定遮蔽），
 * 且注入值会直接流进产物里的 `$fork` 省略哨兵与用户代码，语义不再等价于
 * 宿主内建。
 *
 * 典型故障（已修）：env 把 `undefined` 绑成 Abs 后，`$fork(test, cons, undefined)`
 * 的第三参从「省略」变成 truthy 非函数 → 调用炸 → fail-closed unknown，
 * 循环内提前 return 整条折 unknown；`NaN` 绑 `prim.num()` 时标识符读点拿到
 * 抽象 number 而非 NaN 字面量身份，`0 === NaN` 从恒 false 退化成 boolean。
 *
 * env 注入对这三个名字无收益（跳过 = 不声明，标识符读回落到宿主全局或用户
 * 遮蔽绑定）→ 跳过。@nudo:mock 相反——mock 遮蔽宿主全局正是意图（Bug 274），
 * 其名字进转译选项 shadowedIntrinsics（见下方 mockedIntrinsicNames）。
 *
 * 宿主命名空间名（Math/JSON/…）若注入会遮蔽 namespaceNameOf 的对象身份路由
 * → 区间透传/内建语义回退（issue #87）→ 一并跳过（ENV_SHADOW_SKIP_GLOBALS）。
 */
const ENV_SHADOW_SKIP = ENV_SHADOW_SKIP_GLOBALS;

/**
 * CJS 顶层 `this` 的模块级绑定名（Bug 277）：Node CJS 把模块体包在
 * `wrapper.call(module.exports, …)` 里 ⇒ **顶层 this === module.exports**。
 * 转译器把顶层 `this` 折成 `opts.thisParam`（缺省 `$lit(void 0)` = ESM
 * 语义）⇒ 本绑定名即该 `thisParam`；绑定**值**按文件口味定（CJS ⇒ exports；
 * 纯 ESM ⇒ undefined；非 ESM 无 CJS 面 ⇒ 空对象 = module.exports 初始形态）。
 */
const CJS_THIS_BIND = "__nudoCjsThis";

/**
 * 分析面槽位表（Symbol 键，非枚举）——run 表返回对象的**第二个面**：
 * 键 = 顶层函数**本地名**，值 = 读取本地绑定的 thunk。
 *
 * 为什么需要：run 表的字符串键是**导出面**（同名 re-export / 别名会覆盖
 * 私有本地函数名）。按函数名分析（generalize / 调用点 / LSP replay）必须以
 * **源码绑定**为准，不能走导出槽——否则 `function g(){}` +
 * `export { g } from "./dd.js"` 会把依赖的 g 当成待分析函数。
 * `Object.keys(run)` 不受影响（Symbol + 非枚举）。
 */
const ANALYSIS_SLOTS_KEY = "nudo.analysis";
const ANALYSIS_SLOTS = Symbol.for(ANALYSIS_SLOTS_KEY);

/**
 * run 表的**顶层绑定表**：
 * - 顶层 const/let（`$recordBinding` 通道，Abs 值）；
 * - **私有**顶层函数声明（宿主 JS 函数；与 ANALYSIS_SLOTS 同源，导出面同名
 *   可枚举键不重复登记——导出函数只走导出表）。
 *
 * 后者供 LSP completion / collectAbsBindingsFromGraph 与导出面复用同一套
 * 宿主函数 → Abs 转换（源码形参表 / ctor facet）。
 */
export function bindingsOf(run: Record<string, unknown>): Map<string, unknown> | undefined {
  return runBindings.get(run);
}

/**
 * 执行一段 求值引擎程序，返回顶层 `export function` / `export const`。
 */
export function runTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> {
  // collector 作用域（幂等）：宿主入口包一次；嵌套（checkSource 内 /
  // 导出桥 re-entry）零开销复用外层 store。无外层宿主时行为 = fallback。
  return runWithCollectorScope(() => {
    enterEvalCallBudgetSession(); // 宿主入口：最外层重置；嵌套导出桥继承外层预算
    try {
      try {
        return runTranspiledInner(source, opts);
      } catch (e) {
        // Bug 1139（安全网）：**生成器模式编译失败**（`new Function` 抛
        // SyntaxError：`yield` 落进了嵌套箭头）⇒ 关闭 asyncGen **重试一次**
        // ⇒ `await` 退化为 `$await`（同步近似）⇒ 模块至少**编译得出来**
        // ⇒ 导出可见 ⇒ L2 闸门照常判定。
        //
        // 为什么必须重试而不是直接回落：编译失败 ⇒ **整个模块**的导出全部
        // 丢失 ⇒ 闸门看不到任何入口 ⇒ **零诊断 + exit 0** ⇒ CI 闸门**假绿**
        // （合法代码与违约代码都判绿）。宁可少精确，不可整模块消失。
        //
        // 只在**首次**尝试（未关闭 asyncGen）时重试 ⇒ 不会无限递归。
        if (e instanceof SyntaxError && !opts.disableAsyncGen) {
          return runTranspiledInner(source, { ...opts, disableAsyncGen: true });
        }
        throw e;
      }
    } finally {
      exitEvalCallBudgetSession();
    }
  });
}

function runTranspiledInner(
  source: string,
  opts: RunTranspiledOptions,
): Record<string, unknown> {
  const modules = opts.modules ?? {};
  // Bug 277：CJS 文件的**顶层 this** === module.exports（Node CJS 语义——
  // 包装函数以 `this = module.exports` 调用）。此前顶层 this 恒 $lit(void 0)
  // （ESM 语义）⇒ `this.x = v` 定抛 TypeError ⇒ 整个模块求值失败
  // （fail-closed unknown ⇒ L2 门禁假绿）。
  //
  // 转译器把**顶层** this（及捕获它的顶层箭头）折成 `opts.thisParam`
  // （缺省 `$lit(void 0)` = ESM 语义）；函数体内的 this 走 __this / $rawThis
  // （不受影响）。本处一律给 thisParam，再按文件口味决定该绑定的**值**：
  // - 有 CJS 面（exports/module）⇒ 绑到 exports（=== module.exports）；
  // - 纯 ESM ⇒ 绑 undefined（原生 ESM 顶层 this 就是 undefined）；
  // - 非 ESM 且无 CJS 面（Node `.js` 默认 CJS）⇒ 绑空对象（module.exports
  //   的初始形态）。
  const isEsmSource = sourceHasEsmSyntax(source);
  const hasCjsExports = sourceHasCjsExports(source);
  // @nudo:mock 可遮蔽宿主内建（Bug 274：mock 遮蔽宿主全局正是意图）——mock
  // 名稍后以模块级 `let <名> = __nudoEnv[...]` 注入，转译器必须按「已遮蔽」
  // 发射标识符读点（$absVal(<名>)），否则未遮蔽面的字面量折叠（$lit(...)）
  // 会让 mock 值被静默丢弃。源内已有的同名绑定由 transpileFile 自行扫描
  // （重复并入无副作用）。
  const mockedIntrinsicNames = Object.keys(opts.mocks ?? {}).filter((n) => HOST_INTRINSIC_SET.has(n));
  let js = transpile(source, {
    runtimeImport: "@nudojs/core/exec",
    maxLoopIters: opts.maxLoopIters,
    source,
    replacements: opts.replacementTargets,
    asOverrides: opts.asOverrideTargets,
    lenientGlobals: opts.lenientGlobals,
    recordPositions: opts.recordPositions,
    thisParam: CJS_THIS_BIND,
    disableAsyncGen: opts.disableAsyncGen,
    ...(mockedIntrinsicNames.length > 0
      ? { shadowedIntrinsics: new Set(mockedIntrinsicNames) }
      : {}),
  });
  js = js.replace(RUNTIME_IMPORT_RE, "");
  // 顶层 this 出现在产物里（函数体内的 this 不折成本绑定）⇒ 该源需要顶层
  // this 绑定（否则模块体引用它 → ReferenceError → 整文件求值失败）。
  const usesCjsThis = js.includes(CJS_THIS_BIND);
  js = rewriteUserImports(js, opts.mocks);
  const exportRewrite = rewriteExportStatements(js);
  js = exportRewrite.js;
  if (opts.mode === "analyze") {
    js = stripEffectfulTopLevel(js);
  }

  // @nudo:replace / @nudo:as 绑定
  const reps = opts.replacements ?? {};
  const asVals = opts.asOverrides ?? {};
  const allInject = { ...reps, ...asVals };
  const injectNames = Object.keys(allInject);
  if (injectNames.length > 0) {
    const binds = injectNames
      .map((n) => `const ${n} = __nudoReplaces[${JSON.stringify(n)}];`)
      .join("\n");
    js = `${binds}\n${js}`;
  }

  // 源文本一并传入：多声明符导出（`export const a = 1, b = 2`）的第 2+ 个
  // 声明符在转译产物里**丢了 export 前缀**（且与「独立声明 + 独立 export」
  // 逐字相同）⇒ 只能回源 AST 回收（Bug 280）。
  // 发射面已按**真实导出**加 `export ` 前缀（私有顶层函数不再带）⇒ 此处文本
  // 回收只得到真实静态导出；私有函数名由下方 hiddenFnNames 单独建非枚举槽。
  const { names, js: stripped } = stripStaticExportDecls(js, source);
  js = stripped;
  const dynExports: Record<string, unknown> = {};
  // ESM：显式导出（静态 decl 名 + __nudoExport 的 specifier/re-export/default）
  // 恒压过 export *。star 只填「从未显式导出」的名；star×star 仍按源序后者覆盖。
  const explicitExportNames = new Set<string>([...names, ...exportRewrite.exportedNames]);
  // 私有顶层函数**不是**模块导出，但 generalize / 调用点分析仍要能按名直接
  // 调用（callTranspiledExportFull 用 own-property 查表）。它们以**非枚举**
  // 槽先进返回对象——Object.keys(run) 恒等于真正的导出面（service
  // evalExportsToModuleExports 的枚举口径），直接属性访问照常可用。
  // 真实导出名（静态 / specifier）不进私有面 ⇒ 导出槽的插入序与旧实现一致。
  // 名单只能来自源 AST——转译产物已按真实导出判定发射 export 前缀，用它
  // 回收会再次把二者混同。
  const topLevelFnNames = sourceTopLevelFunctionNames(source);
  // 与显式导出同名的私有本地函数不建 hidden 槽（导出槽归导出值）；按名分析
  // 仍由 nudo.analysis 表读**本地绑定**（见下方 analysisSlots）。
  const hiddenFnNames = topLevelFnNames.filter(
    (n) => !explicitExportNames.has(n),
  );
  const bindings = new Map<string, unknown>();
  // Bug 276：模块**装载期**标志——模块体求值中为 true，模块装载完成后为
  // false（导出函数被调用时为 false）。缺失 require 的抛/不抛按此分（见
  // requireFromModules 注释）：装载期缺失 = 装载失败（引擎保持降级），
  // 调用期缺失 = 抛（原生 MODULE_NOT_FOUND ⇒ catch 臂是活代码）。
  let moduleLoading = true;
  const hostArgNames = [
    "__nudoModules",
    "__nudoBindImport",
    "__nudoBindNamespace",
    "__nudoRegisterImportRefresh",
    "__nudoReplaces",
    "__nudoRequire",
    "__nudoRequireOptional",
    "__nudoEnv",
    "__nudoExport",
    "__nudoExportLazy",
    "__nudoExportStar",
    "__nudoExports",
  ];
  const hostArgs = hostArgNames.map((n) => {
    if (n === "__nudoModules") return modules;
    if (n === "__nudoBindImport") {
      return (spec: string, name: string) => bindImport(modules, spec, name);
    }
    if (n === "__nudoBindNamespace") {
      return (spec: string) => bindNamespace(modules, spec);
    }
    if (n === "__nudoRegisterImportRefresh") {
      return (fn: () => void) => registerLiveImportRefresh(fn);
    }
    if (n === "__nudoReplaces") return allInject;
    if (n === "__nudoRequire") {
      // Bug 276：缺失模块按**装载期 / 调用期**分（见 requireFromModules 注释）
      return (spec: string) => requireFromModules(modules, spec, moduleLoading);
    }
    if (n === "__nudoRequireOptional") {
      return (specs: string[]) => requireOptionalFromModules(modules, specs);
    }
    // mock 与 env 同通道绑定（service eval-run 同口径）：check/generalize
    // 的 inject.mocks 若不进自由标识符作用域，函数体调用会 ReferenceError。
    if (n === "__nudoEnv") return { ...(opts.envGlobals ?? {}), ...(opts.mocks ?? {}) };
    if (n === "__nudoExport") {
      return (name: string, value: unknown) => {
        dynExports[name] = value;
        explicitExportNames.add(name);
      };
    }
    if (n === "__nudoExportLazy") {
      // ESM live binding（Bug ②）：导出槽挂 getter，读取时解析绑定当前值
      return (name: string, get: () => unknown) => {
        Object.defineProperty(dynExports, name, {
          enumerable: true,
          configurable: true,
          get,
        });
        explicitExportNames.add(name);
      };
    }
    if (n === "__nudoExportStar") {
      return (spec: string) => {
        const mod = modules?.[spec];
        if (mod && "named" in (mod as object)) {
          const namedTbl = (mod as AbsModuleExports).named;
          for (const k of Object.keys(namedTbl)) {
            if (explicitExportNames.has(k)) continue;
            // 描述符拷贝：来源 named 表的 live getter 原样传递（名集按源序
            // 当下固定——ESM star 名集是 link-time 属性）
            const d = Object.getOwnPropertyDescriptor(namedTbl, k);
            if (!d) continue;
            Object.defineProperty(
              dynExports,
              k,
              d.get
                ? { enumerable: true, configurable: true, get: d.get }
                : { enumerable: true, configurable: true, writable: true, value: d.value },
            );
          }
        }
      };
    }
    if (n === "__nudoExports") return dynExports;
    return rtAllBindings()[n];
  });

  // @nudo:env 全局 + @nudo:mock 绑定（与 __nudoEnv 合并表一致）。
  //
  // Bug 274：ENV_SHADOW_SKIP（「不遮蔽宿主内建」名单）此前作用在**合并表**上
  // ⇒ `@nudo:mock Math` / `JSON` / `Date` 被**静默丢弃**（no-op）——用户以为
  // mock 生效，实际跑的是宿主内建。口径：skip 名单**只作用于 env 全局**
  // ——mock 的值本身就是一个 Abs，没有宿主对象身份需要保全；遮蔽宿主全局
  // 正是 mock 的意图。
  //
  // let 而非 const：env 全局在原生是 globalThis 的可写属性，`process.exitCode = 1`
  // 这类成员写经 memberPath 写回链重绑根标识符（`process = $set(process, …)`）——
  // const 注入会把它变成原生 TypeError 并毒化整场求值（issue #148：
  // 返回值折 unknown + entry-may-throw）。
  const envTable = opts.envGlobals ?? {};
  const mockTable = opts.mocks ?? {};
  const envInjectNames = Object.keys(envTable).filter((k) => !ENV_SHADOW_SKIP.has(k));
  const mockInjectNames = Object.keys(mockTable);
  const injectCandidates = [...new Set([...envInjectNames, ...mockInjectNames])];
  if (injectCandidates.length > 0) {
    // Bug 273：注入的 `let <名> = …` 与**模块级同名绑定**重复声明 ⇒
    // new Function SyntaxError ⇒ 整文件求值失败（fail-closed unknown ⇒
    // L2 门禁绿灯 exit 0）。口径：**模块级绑定优先**——撞名的注入跳过
    // （import 绑定的 mock 已在 rewriteUserImports 里改写为读 mock 值，
    //  此处不再二次注入；用户自己声明的同名顶层绑定胜出）。
    const occupied = moduleLevelBindingNames(js);
    const injectable =
      occupied === null
        ? []
        : injectCandidates.filter((k) => !occupied.has(k));
    if (injectable.length > 0) {
      const envBinds = injectable
        .map((k) => `let ${k} = __nudoEnv[${JSON.stringify(k)}];`)
        .join("\n");
      js = `${envBinds}\n${js}`;
    }
  }

  // CJS 面：exports.X = v / module.exports 命名空间建模（此前 exports 未绑定
  // → ReferenceError → CJS 文件整体 eval-incapable）。exports = 命名空间 obj Abs
  // （$set 写槽）；module.exports 重赋值 → 单导出（default）。
  // 字符串/注释里的 exports. 不算 CJS 面。
  if (hasCjsExports) {
    // Bug 277：顶层 this === module.exports（Node CJS 语义）——本绑定与
    // exports 同一对象（$set 写槽就地改 ⇒ `this.x = v` 对 module.exports
    // 可见，与原生一致）。
    js = `let exports = $obj({});\nlet module = $obj({ exports });\nconst __nudoCjsOrig = exports;\nlet ${CJS_THIS_BIND} = exports;\n${js}`;
  } else if (usesCjsThis) {
    // 无 exports/module 面的源：顶层 this 仍按文件口味取值——纯 ESM ⇒
    // undefined（原生 ESM 顶层 this 就是 undefined ⇒ `this.x = v` 抛）；
    // 非 ESM（Node `.js` 默认 CJS）⇒ module.exports 的初始形态（空对象）
    // ⇒ `this.x = v` 不再定抛。
    js = `let ${CJS_THIS_BIND} = ${isEsmSource ? "$lit(void 0)" : "$obj({})"};\n${js}`;
  }

  // 动态导出（specifier/re-export/star/default）先展开，静态声明名后写。
  // 冲突语义：显式导出（静态 decl / specifier / 显式 re-export）恒压过 export *
  // （ESM 早错保证 decl/specifier 不重名，star×star 按源序后者覆盖——
  // 与 collectAbsExports 顺序口径一致）。
  const cjsMerge = hasCjsExports
    ? `(() => { const me = $get(module, "exports"); if (me !== __nudoCjsOrig && me && typeof me === "object" && "shape" in me) { return { default: me, [Symbol.for("nudo.cjsMain")]: true }; } const out = {}; if (__nudoCjsOrig && __nudoCjsOrig.shape && __nudoCjsOrig.shape.k === "obj") { for (const k of Object.keys(__nudoCjsOrig.shape.slots)) out[k] = __nudoCjsOrig.shape.slots[k].value; } return out; })()`
    : usesCjsThis
      // 只用顶层 this 的 CJS 源：顶层 this === module.exports ⇒ 其槽即导出面
      ? `(() => { const out = {}; if (${CJS_THIS_BIND} && ${CJS_THIS_BIND}.shape && ${CJS_THIS_BIND}.shape.k === "obj") { for (const k of Object.keys(${CJS_THIS_BIND}.shape.slots)) out[k] = ${CJS_THIS_BIND}.shape.slots[k].value; } return out; })()`
      : "{}";
  // ESM live binding（Bug ②）：导出表是间接引用——返回对象挂 getter：
  // - 动态导出（__nudoExportLazy 的 getter / star 拷贝的 getter）按描述符
  //   迁移（对象字面量展开会把 getter 求值成快照，liveness 断链）；
  // - 静态声明名 getter 读模块作用域当前值（`export let x` 被导出函数
  //   变异后，读取方拿到当前值而非装载完成时刻快照）。
  // 优先级与旧展开形态一致：dyn → cjs → 静态名（显式压过 star/default 合并）。
  // getter 带 converting setter：宿主侧对 run 表槽位再赋值（mock 桥替换、
  // 测试探针）首次写即降级为普通数据槽——对象保持可写，行为与旧快照面兼容。
  //
  // 分析面槽位表（Symbol，非枚举）：**所有**顶层函数本地名 → 读本地绑定的
  // thunk。与导出面解耦——同名 re-export / 别名覆盖本地名时 run[name] 是
  // 导出值，但按函数名分析（generalize / 调用点 / LSP）仍须拿本地绑定。
  // computed key 避免 `__proto__` 字面量走原型设置特例。
  const analysisSlots =
    topLevelFnNames.length === 0
      ? []
      : [
          `  Object.defineProperty(__nudoRet, Symbol.for(${JSON.stringify(ANALYSIS_SLOTS_KEY)}), {`,
          "    enumerable: false, configurable: true,",
          "    value: {",
          ...topLevelFnNames.map((n) => `      [${JSON.stringify(n)}]: () => ${n},`),
          "    },",
          "  });",
        ];
  // 私有顶层函数（hiddenFnNames）先以**非枚举**槽定义：按名分析可用，但
  // Object.keys(run)（模块导出面）看不到。真实导出槽在定义前先 delete 同名
  // 非枚举槽——属性重定义会保留原插入位置，delete 后重建才能让导出键序与
  // 旧实现（dyn → cjs → 静态名）一致。hidden setter 同样 delete 后重建
  // （Object.assign 的 CJS 合并键命中私有槽时，合并名必须是可枚举导出）。
  const hiddenSlots =
    hiddenFnNames.length === 0
      ? []
      : [
          "  const __nudoHidden = (__nudoK, __nudoGet) => Object.defineProperty(__nudoRet, __nudoK, {",
          "    enumerable: false, configurable: true,",
          "    get: __nudoGet,",
          "    set: (__nudoV) => {",
          "      delete __nudoRet[__nudoK];",
          "      Object.defineProperty(__nudoRet, __nudoK, { enumerable: true, configurable: true, writable: true, value: __nudoV });",
          "    },",
          "  });",
          ...hiddenFnNames.map((n) => `  __nudoHidden(${JSON.stringify(n)}, () => ${n});`),
        ];
  // 只有存在非枚举槽时才需要「先删后建」保序；无私有函数时不引入 delete 开销。
  const clearSlots =
    hiddenFnNames.length === 0 ? [] : ["    delete __nudoRet[__nudoK];"];
  const ret = [
    "return (() => {",
    "  const __nudoRet = {};",
    ...analysisSlots,
    ...hiddenSlots,
    "  const __nudoSlot = (__nudoK, __nudoGet) => {",
    ...clearSlots,
    "    Object.defineProperty(__nudoRet, __nudoK, {",
    "      enumerable: true, configurable: true,",
    "      get: __nudoGet,",
    "      set: (__nudoV) => Object.defineProperty(__nudoRet, __nudoK, { enumerable: true, configurable: true, writable: true, value: __nudoV }),",
    "    });",
    "  };",
    "  for (const __nudoK of Reflect.ownKeys(__nudoExports)) {",
    "    const __nudoD = Object.getOwnPropertyDescriptor(__nudoExports, __nudoK);",
    "    if (__nudoD && __nudoD.enumerable) {",
    "      if (__nudoD.get) __nudoSlot(__nudoK, __nudoD.get);",
    ...(hiddenFnNames.length === 0
      ? ["      else Object.defineProperty(__nudoRet, __nudoK, __nudoD);"]
      : [
          "      else {",
          "        delete __nudoRet[__nudoK];",
          "        Object.defineProperty(__nudoRet, __nudoK, __nudoD);",
          "      }",
        ]),
    "    }",
    "  }",
    `  Object.assign(__nudoRet, ${cjsMerge});`,
    ...names.map((n) => `  __nudoSlot(${JSON.stringify(n)}, () => ${n});`),
    "  return __nudoRet;",
    "})();",
  ].join("\n");
  // Bug 116：求值引擎模块体按 ESM 语义应为 strict——此前 new Function 默认
  // sloppy：静默赋值未声明变量（原生 ESM ReferenceError）、重复参数/八进制
  // 字面量/delete 变量等 sloppy 合法面不抛、函数 this 归一 globalThis（strict
  // 应保 undefined/null）。指令前缀必须是函数体首语句（envBinds/CJS prelude
  // 之前拼入）。注：宿主面折叠不覆盖 arguments.callee 读——$arguments 是纯
  // Abs 构造，该面由 $get 的 Arguments brand 毒丸接管（C1 提交另落）。
  // 修订（benchmark 回退）：strict 只对 ESM 面生效（sourceHasEsmSyntax——
  // 静态 import/export 必是 ESM）；无 ESM 语法的源按 Node `.js` 默认 CJS
  // （sloppy）口径。强制 strict 会让 CJS 里合法的 sloppy 语法（yargs 的
  // `arguments` 绑定/赋值等）在 new Function 编译期直接 SyntaxError
  // （"Unexpected eval or arguments in strict mode"）→ 整模块 fail-closed
  // 空导出，且求值失败不进 memo → 每次全量重转译（yargs check 5.5x）。
  // 源码自身的 "use strict" 指令前缀经 transpile 原样保留，不受此开关影响。
  const strictPrefix = isEsmSource ? `"use strict";\n` : "";
  const fn = compileRuntimeUnit<Record<string, unknown>>(
    `${strictPrefix}${js}\n${ret}`,
    hostArgNames,
    { dollarOnly: true },
  );
  setEvalBindingSink(bindings);
  // BUG-026：开新求值 epoch——同名类碰撞只在
  // 本 run 内判定（跨 run 重注册是常态，
  // last-wins 覆盖语义见 class-registry.ts）
  beginClassEpoch();
  try {
    const result = fn(...runtimeArgValues(true), ...hostArgs) as Record<string, unknown>;
    // 私有顶层函数进**绑定表**（LSP completion / collectAbsBindingsFromGraph）：
    // 它们既不在导出面（Object.keys）也不走 $recordBinding（只记录 const/let）。
    // 只补**非枚举**名——导出面同名 re-export / CJS 合并等枚举名不重复登记
    // （导出语义仍走导出槽；按名分析另走 ANALYSIS_SLOTS + preferLocal）。
    const analysis = (result as Record<PropertyKey, unknown>)[ANALYSIS_SLOTS];
    if (analysis !== null && typeof analysis === "object") {
      for (const [n, read] of Object.entries(analysis)) {
        if (Object.getOwnPropertyDescriptor(result, n)?.enumerable === true) continue;
        if (typeof read !== "function") continue;
        bindings.set(n, (read as () => unknown)());
      }
    }
    runBindings.set(result, bindings);
    return result;
  } finally {
    // 模块装载完成 ⇒ 之后的 require 缺失按**调用期**语义抛（Bug 276）
    moduleLoading = false;
    setEvalBindingSink(null);
    // 每次求值出口排空微队列：模块级 Promise.then 不得窜到后续文件的调用窗口
    drainPromiseMicros();
    // BUG-026：同名类碰撞观测——裸名键注册表消歧
    // 失败（不同形 spec 同名注册）排进回落观测面，
    // 不再静默 clobber（查找侧无法消歧：brand 名
    // 即查找键；同形重注册是重评估语义，不在面）
    noteDrainedClassCollisions();
  }
}

/** BUG-026/G3：排空同名类碰撞缓冲进回落观测面。run 顶层出口与
 *  入口调用出口（callTranspiledExportFull）共用——碰撞记录不得
 *  滞留缓冲到下一个无关宿主入口（NudoUnsupportedError 无 path/loc，
 *  滞留即误归属错文件；进程内再无 run 则永不现）。 */
function noteDrainedClassCollisions(): void {
  for (const c of drainClassCollisions()) {
    noteEvalFallback(
      new NudoUnsupportedError(
        "class-collision",
        undefined,
        `class '${c.name}' registered again with a different shape (${c.previous} -> ${c.next}); name-keyed lookup may resolve to either definition`,
      ),
    );
  }
}

/** evaluator 回落事件（观测单一埋点；reason: unsupported:* = 能力边界，internal = 引擎自身缺陷） */
export type EvalFallback = {
  reason: string;
  message: string;
  loc?: { line: number; column: number };
};

/** 回落事件 collector（作用域化：runWithCollectorScope 内各分析互不串台；
 *  无作用域 = fallback 模块级单变量，行为同今日。
 *  注意：_fb* 计数器刻意保持进程级累计（health 指标口径，与 collector 无关）。 */
const evalFallbackCollectorSlot = createScopedSlot<
  ((f: EvalFallback) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => evalFallbackCollectorSlot.runScoped(body));

export function setEvalFallbackCollector(
  collector: ((f: EvalFallback) => void) | null,
): void {
  evalFallbackCollectorSlot.set(collector);
}

/** 表达式级求值（scan 的 case 字面量实参等静态求值面）：编译单表达式经
 *  eval 运行时执行。bindings：表达式自由标识符 → Abs（调用方按绑定表注入）。
 *  编译失败抛错（调用方按需 catch）。 */
export function evalExprAbs(
  expr: import("@babel/types").Expression,
  bindings: Record<string, Abs> = {},
): Abs {
  // bindings 以编译单元形参注入 ⇒ 同名宿主内建（undefined/NaN/Infinity）被
  // **遮蔽**：转译必须发标识符读点（$absVal）而不是字面量折叠，否则注入值
  // 被静默丢弃。
  const shadowed = Object.keys(bindings).filter((n) => HOST_INTRINSIC_SET.has(n));
  const src = transpileExpression(expr, shadowed.length > 0 ? { shadowedIntrinsics: new Set(shadowed) } : {});
  const js = [
    runtimeImportOf("@nudojs/core/exec"),
    // Bug 116：case 实参等单表达式面同模块体 ESM 语义——strict 前缀
    `"use strict";`,
    `return (${src});`,
  ].join("\n");
  const cleaned = js.replace(RUNTIME_IMPORT_RE, "");
  const factory = compileRuntimeUnit<Abs>(cleaned, Object.keys(bindings));
  return factory(...runtimeArgValues(), ...Object.values(bindings));
}

/** 回落计数（D6-A：internal 可暴露为 health 指标，不静默吞） */
export type EvalFallbackStats = {
  internal: number;
  unsupported: number;
  moduleThrow: number;
  total: number;
};

let _fbInternal = 0;
let _fbUnsupported = 0;
let _fbModuleThrow = 0;

/** 始终累计（与 collector 无关）——health / 测试读同一口径 */
export function getEvalFallbackStats(): EvalFallbackStats {
  return {
    internal: _fbInternal,
    unsupported: _fbUnsupported,
    moduleThrow: _fbModuleThrow,
    total: _fbInternal + _fbUnsupported + _fbModuleThrow,
  };
}

/** 宿主入口 / health 按文件分析前重置 */
export function resetEvalFallbackStats(): void {
  _fbInternal = 0;
  _fbUnsupported = 0;
  _fbModuleThrow = 0;
}

/** 回落事件归类（unsupported:* 能力边界 / module-throw 程序自身抛 / internal 引擎缺陷） */
function evalFallbackOf(e: unknown): EvalFallback {
  return e instanceof NudoUnsupportedError
    ? { reason: `unsupported:${e.reason}`, message: e.message, ...(e.loc ? { loc: e.loc } : {}) }
    : isNudoThrow(e)
      ? // NudoThrow：程序自身的抛（如顶层 this 写 / strict 写 TypeError）——
        // 模块装载失败，不是 B 能力边界也不是 B 缺陷（catch 可吸收）
        { reason: "module-throw", message: e instanceof Error ? e.message : String(e) }
      : { reason: "internal", message: e instanceof Error ? e.message : String(e) };
}

/** 记录一次 B 回落（body-fn / tryRunTranspiled / call 边界兜底共用） */
export function noteEvalFallback(e: unknown): void {
  const f: EvalFallback = evalFallbackOf(e);
  if (f.reason === "internal") _fbInternal++;
  else if (f.reason === "module-throw") _fbModuleThrow++;
  else if (f.reason.startsWith("unsupported:")) _fbUnsupported++;
  const evalFallbackCollector = evalFallbackCollectorSlot.get();
  if (!evalFallbackCollector) return;
  try {
    evalFallbackCollector(f);
  } catch {
    /* collector 不得打断 */
  }
}

/**
 * B 单一入口：runTranspiled + 类型化回落观测。
 * unsupported:*（能力边界）/ internal（B 缺陷）都记录到收集器；
 * 返回 undefined 表示调用方应走解释路径。
 */
/** run 表是否来自 CJS `module.exports = X` 重赋值形态（供桥接层标 cjsMain）。 */
export function isCjsMainRun(run: Record<string, unknown>): boolean {
  return Boolean((run as Record<PropertyKey, unknown>)[Symbol.for("nudo.cjsMain")]);
}

export function tryRunTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> | undefined {
  try {
    return runTranspiled(source, opts);
  } catch (e) {
    noteEvalFallback(e);
    return undefined;
  }
}

/**
 * tryRunTranspiled 的**详细形态**：回落原因随失败一起返回。
 *
 * Bug 380：转译器拒绝构造 ⇒ tryRunTranspiled 返回 undefined ⇒ L2 证据面
 * （check-may-throw.ts）把「**没分析出** may-throw」与「**分析出没有**
 * may-throw」当成同一件事 ⇒ 门禁由红转绿。失败原因必须**可观测**，
 * 调用方才能 fail-closed（把「不可判定」显式交给门禁）。
 *
 * 不进 exec/index.ts 的公开面（模块内可见即可；公开面零新增）。
 */
export type TranspileAttempt = {
  /** 成功时的 run 表（导出槽 → 值） */
  run?: Record<string, unknown>;
  /** 失败时的回落原因（unsupported:* / module-throw / internal） */
  fallback?: EvalFallback;
};

export function tryRunTranspiledDetailed(
  source: string,
  opts: RunTranspiledOptions = {},
): TranspileAttempt {
  try {
    return { run: runTranspiled(source, opts) };
  } catch (e) {
    noteEvalFallback(e);
    return { fallback: evalFallbackOf(e) };
  }
}

export type TranspiledCallResult = {
  result: Abs;
  /** 非 never 表示函数可能 throw 该类型 */
  throws: Abs;
};

export function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/** 调用 runTranspiled 导出（捕获 $throw）。opts.phi：入口 Φ 种子
 *  （instantiate/symbolic 的约束入口——eval 侧路径条件收窄）。
 *  opts.shareArgs：evaluator 内部桥（跨模块 import / mock 文件桥，
 *  callTranspiledExportApply）传引用——被调方对容器实参的变异必须对
 *  caller 帧可见（与同文件闭包调用同语义）；宿主重放（case/记录/LSP）
 *  不传，保持 D1 防御副本。
 *  opts.preferLocal：**分析面**语义——按源码本地函数名解析
 *  （nudo.analysis 表优先）。默认 false = 导出语义（callTranspiledExportApply
 *  跨模块导出桥必须走导出槽；同名 re-export / CJS 合并值不得被本地函数顶替）。
 *  嵌套进入（导出桥 apply）继承外层预算；仅最外层宿主入口重置。
 *  #152 assume 前提不设选项位：播种统一走 withAssumePremises 动态域
 *  包裹（check.ts 的 runSeeded extent），单一机制无第二路径。 */
export function callTranspiledExportFull(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi; shareArgs?: boolean; preferLocal?: boolean },
): TranspiledCallResult {
  // collector 作用域（幂等）：同 runTranspiled——最外层宿主入口开 store，
  // 嵌套（同一次分析内的逐导出调用 / 导出桥）复用外层。
  return runWithCollectorScope(() => {
    enterEvalCallBudgetSession();
    // G3（BUG-026 epoch 作用域）：入口调用阶段自成求值单元——函数体内
    // 块级同名类正是在此注册（不在 runTranspiled 顶层）。开新 epoch：
    // ① 缓存命中（tryRunEval 不重跑 run）后的重执行不得与无关文件
    // 刚完成 fresh run 的同名类共享陈旧 epoch（跨文件同名类按设计走
    // last-wins 静默）；② 出口排水使碰撞在本次分析即可观测，不再滞留
    // 缓冲误归属到下一个无关 run。last-wins 解析语义不变（观测面修复）。
    beginClassEpoch();
    try {
      // Bug 456：调用**入口**刷新 ESM live import 绑定。此前只在 $call 出口
      // 刷新（调用返回后重读依赖当前导出值）⇒ 被调方在**本次调用内**读到的
      // import 绑定是上一次调用留下的旧值。ESM import 环（a ⇄ b）里先求值的
      // 一侧绑定到 unknown（对侧尚未求值），于是环内第一次调用恒得 unknown，
      // 第二次才开始正确——同一导出按调用次序给出不同结果（原生恒定值）。
      // 入口刷新 = 被调方读绑定前先对齐到依赖当前导出值（ESM live binding
      // 语义）。refresh 闭包纯读不发起新调用（无重入）；注册表空时零开销。
      refreshLiveImports();
      return callTranspiledExportFullInner(exports, name, args, opts);
    } finally {
      exitEvalCallBudgetSession();
      noteDrainedClassCollisions();
    }
  });
}

/**
 * 调用目标解析。默认 = **导出语义**：`exports[name]`（own-property；含
 * 无同名导出冲突时的私有 hidden 槽）。`preferLocal` = **分析面语义**：
 * 先查 nudo.analysis 表（源码本地绑定），再回落导出槽。
 *
 * run 表的字符串键是导出面——同名 re-export / CJS 合并会覆盖私有本地函数名。
 * 按函数名分析（generalize / 调用点 / LSP replay）必须显式 preferLocal；
 * 导出桥（callTranspiledExportApply）必须保持默认，否则跨模块 import 的
 * 被调方会被同名的本地私有函数顶替。
 */
function callTargetOf(
  exports: Record<string, unknown>,
  name: string,
  preferLocal: boolean,
): unknown {
  if (preferLocal) {
    const analysis = (exports as Record<PropertyKey, unknown>)[ANALYSIS_SLOTS];
    if (
      analysis !== null &&
      typeof analysis === "object" &&
      Object.hasOwn(analysis, name)
    ) {
      const read = (analysis as Record<string, unknown>)[name];
      // 生成表值恒为 thunk（读本地绑定，保持 live 语义）
      return typeof read === "function" ? (read as () => unknown)() : read;
    }
  }
  // own-property：name 为 toString/constructor 等 Object.prototype 成员且模块
  // 无同名自有导出时，裸读会把原型方法当导出调用（constructor 曾原样返回实参）
  return Object.hasOwn(exports, name) ? exports[name] : undefined;
}

function callTranspiledExportFullInner(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi; shareArgs?: boolean; preferLocal?: boolean },
): TranspiledCallResult {
  const fn = callTargetOf(exports, name, opts?.preferLocal === true);
  if (typeof fn === "function") {
    // 宿主裸值（raw string/array/number…）先经 asAbsVal 收成 Abs（与 $fork
    // 对缺参/宿主裸值同口径）：否则裸值流进代数算子（$not/$forOf/…）读
    // .shape.k 直接 TypeError，被记成 internal 回落 + throws TypeError
    // （症状 B：raw 数组实参 → `Cannot read properties of undefined
    // (reading 'k')`）。raw 字面量收成 exact lit，具体实参照常精确求值。
    // D1：宿主重放（case/记录/LSP）用副本——mutator 不得把入参态污染回
    // 调用方/记录。evaluator 内部桥（shareArgs，跨模块 import 调用）传
    // 引用：JS 引用语义下被调方变异必须写回 caller 帧（h.n = v 后 caller
    // 读 h.n 得 v，back === h 折 true）——复制会让 caller 绑定读到 stale
    // 值（假 exact），与同文件闭包调用（直达、无副本）语义分叉。
    const callArgs = args.map((a) => {
      if (!(a && typeof a === "object" && "shape" in (a as object))) return asAbsVal(a);
      return opts?.shareArgs ? (a as Abs) : $copy(a as Abs);
    });
    return runWithLoopExits(() => {
      try {
        const invoke = () =>
          withNewTargetReset(() => (fn as (...a: Abs[]) => unknown)(...callArgs));
        const r = opts?.phi ? withExecPhi(opts.phi, invoke) : invoke();
        // 微任务（then/catch 回调）在同步返回值算完后才跑
        drainPromiseMicros();
        // Bug 26：宿主裸值（裸全局标识符 return parseInt 等）先经 asAbsVal
        // 收成 Abs（与上方 D1 入参同口径）——宿主函数折一等 fn Abs，裸
        // 原始值折字面量，不再弃成 unknown
        if (!isAbsVal(r)) return joinControlExits(asAbsVal(r));
        // 抽象分支 early-return / throw 记入 exits，与正常出口 join
        return joinControlExits(r);
      } catch (e) {
        drainPromiseMicros();
        // C2.1：循环体 $loopReturn → 函数返回值（与 exits join）
        if (isNudoReturn(e)) {
          return joinControlExits(e.absValue);
        }
        if (isNudoThrow(e)) {
          // 全臂 throw：兄弟 throw 已在 throwExits；与早退 exits 一并考虑
          const result = joinLoopExits(never);
          const throws = joinThrowExits(e.absValue);
          return { result, throws };
        }
        // 原生 ReferenceError：class TDZ / 未声明引用——原生必抛，记入 throws
        if (e instanceof ReferenceError) {
          return {
            result: joinLoopExits(never),
            throws: joinThrowExits(errorTypeAbs("ReferenceError")),
          };
        }
        // 其余原生异常（TypeError/RangeError/栈溢出/引擎缺陷…）也必须进 throws 域：
        // 折成「… + throws=never」会假报「保证不抛」（L2 entry-may-throw 假阴性）。
        // result 保持 fail-closed unknown（不谎称 never）。
        // D6-A canary：与 tryRunTranspiled 同口径记 internal 回落（不静默吞）。
        noteEvalFallback(e);
        return {
          result: joinLoopExits(unknown),
          throws: joinThrowExits(throwPayloadOf(e)),
        };
      }
    });
  }
  if (isAbsVal(fn)) {
    // export const f = (x) => …：导出值是一等 fn Abs —— 按调用语义 apply
    if (fn.shape.k === "fn") {
      return runWithLoopExits(() => {
        try {
          const r = $call(fn, args);
          // 与 JS 函数分支同口径：同步返回值算完后排空微队列
          drainPromiseMicros();
          const joined = joinControlExits(r);
          // 观测结果回填 fn.returnType 槽（与类方法槽同口径，展示用
          // 不回写分析）——arity-only fn Abs 调用后携带真实返回
          refineFnReturnType(fn, joined.result);
          return joined;
        } catch (e) {
          drainPromiseMicros();
          if (isNudoReturn(e)) {
            return joinControlExits(e.absValue);
          }
          if (isNudoThrow(e)) {
            return { result: joinLoopExits(never), throws: joinThrowExits(e.absValue) };
          }
          // 同上：原生异常不得折成 throws=never（result 保持 fail-closed unknown）
          // D6-A canary：与 tryRunTranspiled 同口径记 internal 回落
          noteEvalFallback(e);
          return {
            result: joinLoopExits(unknown),
            throws: joinThrowExits(throwPayloadOf(e)),
          };
        }
      });
    }
    drainPromiseMicros();
    return { result: fn, throws: never };
  }
  drainPromiseMicros();
  return { result: unknown, throws: never };
}

function joinLoopExits(normal: Abs): Abs {
  const exits = takeLoopExits();
  if (exits.length === 0) return normal;
  return exits.reduce((acc, x) => joinAbs(acc, x), normal);
}

function joinThrowExits(base: Abs | undefined): Abs {
  const exits = takeThrowExits();
  let t = base;
  for (const x of exits) t = t ? joinAbs(t, x) : x;
  return t ?? never;
}

function joinControlExits(normal: Abs): { result: Abs; throws: Abs } {
  return { result: joinLoopExits(normal), throws: joinThrowExits(undefined) };
}

/** 调用 runTranspiled 导出（仅结果） */
export function callTranspiledExport(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
): Abs {
  return callTranspiledExportFull(exports, name, args).result;
}

/**
 * 包装 runTranspiled 导出为 Abs apply 钩子——throws 面经返回值通道强制保留
 * （H1 / DESIGN-003）。这是包装 `callTranspiledExportFull` 的**唯一入口**：
 * 返回 AbsApplyResult（`{abs, throws}`），$call 统一路由 throws。
 * 手拆 `.result` 会静默丢 throws 面（BUG-006 根因）。
 *
 * 桥是 evaluator 内部调用（caller 帧 → 跨模块 import）：实参传引用
 * （shareArgs），被调方 mutator 写回 caller 绑定——与同文件闭包调用同语义；
 * 宿主重放不走此工厂，保持 D1 防御副本。
 *
 * `exports` 可传惰性 getter（互递归模块桥：导出表在桥创建后才赋值）。
 *
 * **不传 preferLocal**：跨模块 import 桥必须调用**导出值**（同名 re-export /
 * CJS 合并不得被本地私有函数顶替）；按名分析由调用方显式 preferLocal。
 */
export function callTranspiledExportApply(
  exports: Record<string, unknown> | (() => Record<string, unknown>),
  name: string,
): (args: Abs[], thisVal?: Abs) => AbsApplyResult {
  const resolve = typeof exports === "function" ? exports : () => exports;
  return (args: Abs[]) => {
    const full = callTranspiledExportFull(resolve(), name, args, { shareArgs: true });
    return makeAbsApplyResult(full.result, full.throws);
  };
}
