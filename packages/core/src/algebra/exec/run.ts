/**
 * 进程内 求值引擎执行：transpile 源码 → new Function 跑在 runtime 上。
 * 不写临时文件；相对 import 用注入的 AbsModuleExports / JS 导出绑定。
 *
 * mode:
 * - "exec"（默认）：执行全部顶层（含副作用）
 * - "analyze"：只保留函数声明与纯字面量 const；跳过顶层表达式/循环/if
 *   ——分析入口安全，不触发 fetch 等顶层副作用
 */

import { rtAllBindings } from "./rt.ts";
import { parse as babelParse } from "@babel/parser";
import {
  enterEvalCallBudgetSession,
  exitEvalCallBudgetSession,
  setEvalBindingSink,
} from "./calls.ts";
import { withExecPhi, $copy } from "./runtime.ts";
import type { Abs } from "../abs.ts";
import type { Phi } from "../pred.ts";
import { never, unknown } from "../abs.ts";
import { makeAbsApplyResult, type AbsApplyResult } from "../abs-fn.ts";
import { joinAbs } from "../objects.ts";
import { type AbsModuleExports, namespaceAbsOf } from "../abs-modules.ts";
import { formatAbs } from "../format.ts";
import { transpile, transpileExpression, runtimeImportOf } from "./transpile.ts";
import { ENV_SHADOW_SKIP_GLOBALS, HOST_INTRINSIC_SET } from "./transpile/intrinsics.ts";
import { NudoUnsupportedError } from "./unsupported.ts";
import { drainClassCollisions, beginClassEpoch } from "./class-registry.ts";
import { stripStaticExportDecls } from "./export-names.ts";
import { errorTypeAbs, throwPayloadOf } from "./may-throw.ts";
import { drainPromiseMicros } from "../builtins.ts";
import { sourceHasCjsExports } from "../code-text.ts";
import { isNudoThrow, isNudoReturn, $isForkExit, runWithLoopExits, takeLoopExits, takeThrowExits, asAbsVal, withNewTargetReset } from "./runtime.ts";
import { $call } from "./call.ts";
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
  /** @nudo:replace 匹配表：传给 transpile */
  replacementTargets?: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  /** @nudo:as 注入值：varName → Abs */
  asOverrides?: Record<string, Abs>;
  /** @nudo:as 语句范围表 */
  asOverrideTargets?: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  /** @nudo:env 全局 Abs（JSON/Math/console…）→ 作用域绑定 */
  envGlobals?: Record<string, Abs>;
  /** @nudo:mock 注入值：name → Abs（mockDirectivesToAbsSeeds 产物） */
  mocks?: Record<string, Abs>;
  /** 宽松全局（调用点发现 exec 采集：未声明全局调用保守 unknown 不中断） */
  lenientGlobals?: boolean;
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

export const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;

/** 相对 import → 从注入 modules 取绑定（Abs fn 包成 JS 可调用） */
function rewriteUserImports(js: string): string {
  // namespace：transpile 会写成 `import { * as ns } from "…"`
  js = js.replace(
    /^import\s*\{\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, local: string, spec: string) =>
      `let ${local} = __nudoBindNamespace(${JSON.stringify(spec)});`,
  );
  // 无绑定副作用 import → 仅触发模块求值
  js = js.replace(
    /^import\s*["']([^"']+)["'];\s*$/gm,
    (_all, spec: string) => `void __nudoBindNamespace(${JSON.stringify(spec)});`,
  );
  return js.replace(
    /^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, names: string, spec: string) => {
      const parts = names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return parts
        .map((p) => {
          const [imported, local] = p.split(/\s+as\s+/).map((x) => x.trim());
          const bind = local ?? imported;
          return `let ${bind} = __nudoBindImport(${JSON.stringify(spec)}, ${JSON.stringify(imported)});`;
        })
        .join("\n");
    },
  );
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
  // __nudoRecordAssign 是簿记（rewrite/插桩产物），非副作用，保留
  return (
    !name.startsWith("$") &&
    name !== "__nudoExport" &&
    name !== "__nudoExportStar" &&
    name !== "__nudoRecordBinding" &&
    name !== "__nudoRecordAssign" &&
    !declared.has(name)
  );
}

/** 成员链最左根标识符名（非标识符根返回 undefined） */
function memberChainRoot(member: import("@babel/types").MemberExpression): string | undefined {
  let node: import("@babel/types").Expression | import("@babel/types").Super = member.object;
  while (node.type === "MemberExpression") node = node.object;
  return node.type === "Identifier" ? node.name : undefined;
}

function runtimeArgNames(): string[] {
  return Object.keys(rtAllBindings()).filter((k) => k.startsWith("$"));
}

function bindImport(
  modules: RunTranspiledOptions["modules"],
  spec: string,
  name: string,
): unknown {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  const absCallable = (v: Abs): unknown => {
    // fn Abs → JS 可调用；class/其它 Abs 原样（供 $new / $get）
    if (v && typeof v === "object" && "shape" in v) {
      if ((v as Abs).shape.k === "fn") {
        // 挂 __nudoAbsFn：$new 收到 wrapper 时回 Abs 派发——否则 wrapper 是
        // 箭头（hostFnCtorFacet → 不可构造），imported 构造函数被误判
        // Bug 9 假抛（`new G()` 原生合法）。
        const w = (...args: Abs[]) => $call(v, args);
        (w as { __nudoAbsFn?: Abs }).__nudoAbsFn = v;
        return w;
      }
      return v;
    }
    return v;
  };
  if (name === "default") {
    const d = (mod as AbsModuleExports).default;
    if (d === undefined) return unknown;
    if (typeof d === "function") return d;
    return absCallable(d as Abs);
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
  return absCallable(v as Abs);
}

/** `import * as ns`：整命名空间（named + default 槽）→ Abs 对象 */
function bindNamespace(modules: RunTranspiledOptions["modules"], spec: string): Abs {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (mod.named) return namespaceAbsOf(mod);
  return unknown;
}

/**
 * CJS require：modules[spec] → 可 $get 的 namespace Abs；缺失/非字符串 → unknown（不炸）。
 * `module.exports = X` 重赋值形态（cjsMain）：原生 require 返回 X 本身
 * （ms 等单函数导出包可直接调用），返回 default 而非命名空间对象——
 * Bug 10 的 obj-callee 定抛暴露了旧口径的形状失真（namespace obj 不可调）。
 */
function requireFromModules(
  modules: RunTranspiledOptions["modules"],
  spec: string,
): unknown {
  if (typeof spec !== "string") return unknown;
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (mod.cjsMain) {
    const d = (mod as AbsModuleExports).default;
    if (d !== undefined) return d;
  }
  if (mod.named) return namespaceAbsOf(mod);
  return mod;
}

/**
 * 可选 require（try/catch 双侧字面量）：优先成功侧——第一个能解析的 spec；
 * 全不能解析 → unknown（诚实降级，不假装某模块）。
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
    if (mod.named) return namespaceAbsOf(mod);
    return mod;
  }
  return unknown;
}

/** 导出语句后处理：specifier / re-export / star / default → __nudoExport 调用。
 *  静态声明导出（export function/const/let）走既有正则扫描 + 返回对象；
 *  冲突语义：显式导出（decl / specifier / 显式 re-export）压过 export *
 *  （ESM 早错保证 decl/specifier 不重名，star×star 按源序后者覆盖——
 *  与 collectAbsExports 顺序口径一致）。 */
function rewriteExportStatements(js: string): string {
  // export { x as y } from "spec"：绑定经 modules 表注入
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
          return `__nudoExport(${JSON.stringify(exp)}, __nudoBindImport(${JSON.stringify(spec)}, ${JSON.stringify(local)}));`;
        })
        .join("\n"),
  );
  // export * as ns from "spec"：命名空间 re-export（与 importLocalBindings 的
  // namespace open-obj 口径一致——__nudoBindNamespace → namespaceAbsOf）
  js = js.replace(
    /^export\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["'];\s*$/gm,
    (_all, ns: string, spec: string) =>
      `__nudoExport(${JSON.stringify(ns)}, __nudoBindNamespace(${JSON.stringify(spec)}));`,
  );
  // export * from "spec"：并入 named（不含 default，ESM 语义）
  js = js.replace(
    /^export\s*\*\s*from\s*["']([^"']+)["'];\s*$/gm,
    (_all, spec: string) => `__nudoExportStar(${JSON.stringify(spec)});`,
  );
  // export { a, b as c }：本地绑定重命名导出
  js = js.replace(
    /^export\s*\{([^}]*)\};\s*$/gm,
    (_all, names: string) =>
      names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => {
          const [local, exported] = p.split(/\s+as\s+/).map((x) => x.trim().replace(/^"|"$/g, ""));
          return `__nudoExport(${JSON.stringify(exported ?? local)}, ${local});`;
        })
        .join("\n"),
  );
  // export default <expr>;（transpile 保证函数/类默认已展开成命名 + 标识符形态）。
  // 表达式默认值（块体箭头/含方法对象）转译产物跨多行——`.` 不匹配换行的
  // 单行正则会整条漏改写（default 槽静默丢失）。按语句边界切分：从
  // `export default ` 起做括号深度扫描（跳过字符串字面量），深度归零且剩余
  // 仅 `;` 即语句完结。
  return rewriteExportDefaults(js);
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
 * env 全局注入时**不得**遮蔽的宿主内建名 = `HOST_INTRINSIC_SET`（与转译折叠同源）。
 *
 * 注入形式是模块级 `const <name> = __nudoEnv["<name>"]`，会遮蔽宿主全局。
 * 转译产物对这三个名字发**无标识符**源（`void 0` / `0/0` / `1/0` → `$lit`），
 * 但产物里仍有依赖宿主 `undefined` 身份的省略哨兵（`$fork` 缺 else 臂的第三参
 * 省略），且用户源里裸标识符一经遮蔽也会把 Abs 送进 `$lit`/调用位。
 *
 * 典型故障（已修）：env 把 `undefined` 绑成 Abs 后，`$fork(test, cons, undefined)`
 * 的第三参从「省略」变成 truthy 非函数 → 调用炸 → fail-closed unknown，
 * 循环内提前 return 整条折 unknown；`NaN` 绑 `prim.num()` 时 `$lit(NaN)` 丢
 * NaN 字面量身份，`0 === NaN` 从恒 false 退化成 boolean。
 *
 * 转译器已自行处理这三个名字，注入 const 无收益 → 跳过（等同未声明）。
 *
 * 宿主命名空间名（Math/JSON/…）若注入会遮蔽 namespaceNameOf 的对象身份路由
 * → 区间透传/内建语义回退（issue #87）→ 一并跳过（ENV_SHADOW_SKIP_GLOBALS）。
 */
const ENV_SHADOW_SKIP = ENV_SHADOW_SKIP_GLOBALS;

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
      return runTranspiledInner(source, opts);
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
  let js = transpile(source, {
    runtimeImport: "@nudojs/core/exec",
    maxLoopIters: opts.maxLoopIters,
    source,
    replacements: opts.replacementTargets,
    asOverrides: opts.asOverrideTargets,
    lenientGlobals: opts.lenientGlobals,
  });
  js = js.replace(RUNTIME_IMPORT_RE, "");
  js = rewriteUserImports(js);
  js = rewriteExportStatements(js);
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

  const { names, js: stripped } = stripStaticExportDecls(js);
  js = stripped;
  const dynExports: Record<string, unknown> = {};
  // ESM：显式导出（静态 decl 名 + __nudoExport 的 specifier/re-export）恒压过
  // export *。star 只填「从未显式导出」的名；star×star 仍按源序后者覆盖。
  const explicitExportNames = new Set<string>(names);
  const bindings = new Map<string, unknown>();
  const argNames = [
    ...runtimeArgNames(),
    "__nudoModules",
    "__nudoBindImport",
    "__nudoBindNamespace",
    "__nudoReplaces",
    "__nudoRequire",
    "__nudoRequireOptional",
    "__nudoEnv",
    "__nudoExport",
    "__nudoExportStar",
    "__nudoExports",
  ];
  const args = argNames.map((n) => {
    if (n === "__nudoModules") return modules;
    if (n === "__nudoBindImport") {
      return (spec: string, name: string) => bindImport(modules, spec, name);
    }
    if (n === "__nudoBindNamespace") {
      return (spec: string) => bindNamespace(modules, spec);
    }
    if (n === "__nudoReplaces") return allInject;
    if (n === "__nudoRequire") {
      return (spec: string) => requireFromModules(modules, spec);
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
    if (n === "__nudoExportStar") {
      return (spec: string) => {
        const mod = modules?.[spec];
        if (mod && "named" in (mod as object)) {
          for (const [k, v] of Object.entries((mod as AbsModuleExports).named)) {
            if (!explicitExportNames.has(k)) dynExports[k] = v;
          }
        }
      };
    }
    if (n === "__nudoExports") return dynExports;
    return rtAllBindings()[n];
  });

  // @nudo:env 全局 + @nudo:mock 绑定（与 __nudoEnv 合并表一致）
  const envAndMocks = { ...(opts.envGlobals ?? {}), ...(opts.mocks ?? {}) };
  const envInjectNames = Object.keys(envAndMocks).filter(
    (k) => !ENV_SHADOW_SKIP.has(k),
  );
  if (envInjectNames.length > 0) {
    const envBinds = envInjectNames
      .map((k) => `const ${k} = __nudoEnv[${JSON.stringify(k)}];`)
      .join("\n");
    js = `${envBinds}\n${js}`;
  }

  // CJS 面：exports.X = v / module.exports 命名空间建模（此前 exports 未绑定
  // → ReferenceError → CJS 文件整体 eval-incapable）。exports = 命名空间 obj Abs
  // （$set 写槽）；module.exports 重赋值 → 单导出（default）。
  // 字符串/注释里的 exports. 不算 CJS 面。
  const hasCjsExports = sourceHasCjsExports(source);
  if (hasCjsExports) {
    js = `let exports = $obj({});\nlet module = $obj({ exports });\nconst __nudoCjsOrig = exports;\n${js}`;
  }

  // 动态导出（specifier/re-export/star/default）先展开，静态声明名后写。
  // 冲突语义：显式导出（静态 decl / specifier / 显式 re-export）恒压过 export *
  // （ESM 早错保证 decl/specifier 不重名，star×star 按源序后者覆盖——
  // 与 collectAbsExports 顺序口径一致）。
  const cjsMerge = hasCjsExports
    ? `(() => { const me = $get(module, "exports"); if (me !== __nudoCjsOrig && me && typeof me === "object" && "shape" in me) { return { default: me, [Symbol.for("nudo.cjsMain")]: true }; } const out = {}; if (__nudoCjsOrig && __nudoCjsOrig.shape && __nudoCjsOrig.shape.k === "obj") { for (const k of Object.keys(__nudoCjsOrig.shape.slots)) out[k] = __nudoCjsOrig.shape.slots[k].value; } return out; })()`
    : "{}";
  const ret = `return { ...__nudoExports, ...${cjsMerge}, ${names.join(", ")} };`;
  const fn = new Function(...argNames, `${js}\n${ret}`);
  setEvalBindingSink(bindings);
  // BUG-026：开新求值 epoch——同名类碰撞只在
  // 本 run 内判定（跨 run 重注册是常态，
  // last-wins 覆盖语义见 class-registry.ts）
  beginClassEpoch();
  try {
    const result = fn(...args) as Record<string, unknown>;
    runBindings.set(result, bindings);
    return result;
  } finally {
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
  const src = transpileExpression(expr, {});
  const js = [
    runtimeImportOf("@nudojs/core/exec"),
    `return (${src});`,
  ].join("\n");
  const cleaned = js.replace(RUNTIME_IMPORT_RE, "");
  const names = [...Object.keys(rtAllBindings()), ...Object.keys(bindings)];
  const factory = new Function(...names, cleaned) as (...vals: unknown[]) => Abs;
  return factory(...Object.values(rtAllBindings()), ...Object.values(bindings));
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

/** 记录一次 B 回落（body-fn / tryRunTranspiled / call 边界兜底共用） */
export function noteEvalFallback(e: unknown): void {
  const f: EvalFallback = e instanceof NudoUnsupportedError
    ? { reason: `unsupported:${e.reason}`, message: e.message, ...(e.loc ? { loc: e.loc } : {}) }
    : isNudoThrow(e)
      ? // NudoThrow：程序自身的抛（如顶层 this 写 / strict 写 TypeError）——
        // 模块装载失败，不是 B 能力边界也不是 B 缺陷（catch 可吸收）
        { reason: "module-throw", message: e instanceof Error ? e.message : String(e) }
      : { reason: "internal", message: e instanceof Error ? e.message : String(e) };
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
 *  嵌套进入（导出桥 apply）继承外层预算；仅最外层宿主入口重置。 */
export function callTranspiledExportFull(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi },
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
      return callTranspiledExportFullInner(exports, name, args, opts);
    } finally {
      exitEvalCallBudgetSession();
      noteDrainedClassCollisions();
    }
  });
}

function callTranspiledExportFullInner(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi },
): TranspiledCallResult {
  // own-property：name 为 toString/constructor 等 Object.prototype 成员且模块
  // 无同名自有导出时，裸读会把原型方法当导出调用（constructor 曾原样返回实参）
  const fn = Object.hasOwn(exports, name) ? exports[name] : undefined;
  if (typeof fn === "function") {
    // D1：重跑/导入调用用副本——mutator 不得把入参态污染回调用方/记录。
    // 宿主裸值（raw string/array/number…）先经 asAbsVal 收成 Abs（与 $fork
    // 对缺参/宿主裸值同口径）：否则裸值流进代数算子（$not/$forOf/…）读
    // .shape.k 直接 TypeError，被记成 internal 回落 + throws TypeError
    // （症状 B：raw 数组实参 → `Cannot read properties of undefined
    // (reading 'k')`）。raw 字面量收成 exact lit，具体实参照常精确求值。
    const callArgs = args.map((a) =>
      a && typeof a === "object" && "shape" in (a as object) ? $copy(a) : asAbsVal(a),
    );
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
          return joinControlExits(r);
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
 * `exports` 可传惰性 getter（互递归模块桥：导出表在桥创建后才赋值）。
 */
export function callTranspiledExportApply(
  exports: Record<string, unknown> | (() => Record<string, unknown>),
  name: string,
): (args: Abs[], thisVal?: Abs) => AbsApplyResult {
  const resolve = typeof exports === "function" ? exports : () => exports;
  return (args: Abs[]) => {
    const full = callTranspiledExportFull(resolve(), name, args);
    return makeAbsApplyResult(full.result, full.throws);
  };
}
