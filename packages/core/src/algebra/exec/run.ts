/**
 * 进程内 B 路径执行：transpile 源码 → new Function 跑在 runtime 上。
 * 不写临时文件；相对 import 用注入的 AbsModuleExports / JS 导出绑定。
 *
 * mode:
 * - "exec"（默认）：执行全部顶层（含副作用）
 * - "analyze"：只保留函数声明与纯字面量 const；跳过顶层表达式/循环/if
 *   ——分析入口安全，不触发 fetch 等顶层副作用
 */

import { rtAllBindings } from "./rt.ts";
import { resetBCallBudget } from "./calls.ts";
import { withExecPhi } from "./runtime.ts";
import { setBBindingSink } from "./calls.ts";
import type { Abs } from "../abs.ts";
import type { Phi } from "../pred.ts";
import { never, unknown, abs } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import type { AbsModuleExports } from "../abs-modules.ts";
import { formatAbs } from "../format.ts";
import { transpile, transpileExpression, runtimeImportOf } from "./transpile.ts";
import { NudoUnsupportedError } from "./unsupported.ts";
import { errorTypeAbs } from "./may-throw.ts";
import { drainPromiseMicros } from "../builtins.ts";
import {
  isNudoThrow,
  isNudoReturn,
  $isForkExit,
  runWithLoopExits,
  takeLoopExits,
  takeThrowExits,
} from "./runtime.ts";
import { $call } from "./call.ts";

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

/** 分析模式：strip 顶层危险副作用与未知全局调用；保留本地函数调用（诊断依赖） */
function stripEffectfulTopLevel(js: string): string {
  // 本文件内可解析的绑定名（函数/类/const/let/var/import）
  const declared = new Set<string>();
  for (const m of js.matchAll(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) {
    declared.add(m[1]!);
  }
  for (const m of js.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    declared.add(m[1]!);
  }
  for (const m of js.matchAll(/^import\s*\{([^}]+)\}\s*from/gm)) {
    for (const part of m[1]!.split(",")) {
      const local = part.split(/\s+as\s+/).pop()?.trim();
      if (local) declared.add(local);
    }
  }
  for (const m of js.matchAll(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/gm)) {
    declared.add(m[1]!);
  }
  for (const m of js.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s*,/gm)) {
    declared.add(m[1]!);
  }

  const lines = js.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const isTop = /^\S/.test(line) && line.trim().length > 0;
    const t = line.trim();
    if (isTop) {
      // 顶层危险全局：fetch / 定时器 / console
      if (/^(console\.|fetch\s*\(|setTimeout\s*\(|setInterval\s*\()/.test(t)) {
        while (i < lines.length && !lines[i]!.trim().endsWith(";") && !lines[i]!.trim().endsWith("}")) i++;
        i++;
        continue;
      }
      // 顶层调用：$callNamed("localFn", …) 仅当 localFn 已声明时保留
      //（诊断需要执行本地顶层调用）；未知全局 strip
      const namedCall = t.match(/^\$callNamed\(\s*"([^"]+)"/);
      if (namedCall && !declared.has(namedCall[1]!)) {
        while (i < lines.length && !lines[i]!.trim().endsWith(";") && !lines[i]!.trim().endsWith("}")) i++;
        i++;
        continue;
      }
      // 其它未知全局调用（未走 $callNamed 的）；__nudoExport/__nudoExportStar/
      // __nudoRecordBinding/__nudoRecordAssign 是簿记（rewrite/插桩产物），
      // 非副作用，保留
      const callMatch = t.match(/^([A-Za-z_$][\w$]*)\s*\(/);
      if (
        callMatch &&
        !callMatch[1]!.startsWith("$") &&
        callMatch[1] !== "__nudoExport" &&
        callMatch[1] !== "__nudoExportStar" &&
        callMatch[1] !== "__nudoRecordBinding" &&
        callMatch[1] !== "__nudoRecordAssign" &&
        !declared.has(callMatch[1]!) &&
        !/^(const|let|var|function|export|import|return|if|for|while|switch|try|throw|class)\b/.test(t)
      ) {
        while (i < lines.length && !lines[i]!.trim().endsWith(";") && !lines[i]!.trim().endsWith("}")) i++;
        i++;
        continue;
      }
      // 顶层控制流
      if (/^(if\s*\(|for\s*\(|while\s*\(|\$fork\s*\(|\$for\s*\(|\$while)/.test(t)) {
        i++;
        if (/^\$/.test(t)) {
          // 运行时调用形态（$for/$fork/$while）：按括号平衡跳过整条调用
          // （此前按大括号计数——$for( 首行无 { → 只删首行，参数悬空
          // SyntaxError，analyze 模式顶层循环静默回落）
          let depth = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
          while (i < lines.length && depth > 0) {
            const l = lines[i]!;
            depth += (l.match(/\(/g) || []).length;
            depth -= (l.match(/\)/g) || []).length;
            i++;
          }
        } else {
          let depth = t.includes("{") ? 1 : 0;
          while (i < lines.length && depth > 0) {
            const l = lines[i]!;
            depth += (l.match(/\{/g) || []).length;
            depth -= (l.match(/\}/g) || []).length;
            i++;
          }
        }
        continue;
      }
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
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
  if (!mod) return undefined;
  const absCallable = (v: Abs): unknown => {
    // fn Abs → JS 可调用；class/其它 Abs 原样（供 $new / $get）
    if (v && typeof v === "object" && "shape" in v) {
      if ((v as Abs).shape.k === "fn") return (...args: Abs[]) => $call(v, args);
      return v;
    }
    return v;
  };
  if (name === "default") {
    const d = (mod as AbsModuleExports).default;
    if (d === undefined) return undefined;
    if (typeof d === "function") return d;
    return absCallable(d as Abs);
  }
  const named = (mod as AbsModuleExports).named;
  const v = named?.[name];
  if (v === undefined) {
    const rec = (mod as Record<string, unknown>)[name];
    if (typeof rec === "function") return rec;
    return undefined;
  }
  if (typeof v === "function") return v;
  return absCallable(v as Abs);
}

/**
 * 命名空间 Abs（import * as ns / CJS require 绑定）：
 * open + path——导出收集可能不全（CJS 收集失败等），缺失成员是分析
 * 视图不完整，不得按「运行时缺失」判定（不可调用判定会假抛 TypeError）。
 */
function namespaceAbsOf(mod: AbsModuleExports): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(mod.named)) slots[k] = { value: v };
  if (mod.default) slots["default"] = { value: mod.default };
  return abs({ k: "obj", slots, open: true }, undefined, undefined, "path");
}

/** `import * as ns`：整命名空间（named + default 槽）→ Abs 对象 */
function bindNamespace(modules: RunTranspiledOptions["modules"], spec: string): Abs {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (mod.named) return namespaceAbsOf(mod);
  return unknown;
}

/** CJS require：modules[spec] → 可 $get 的 namespace Abs */
function requireFromModules(
  modules: RunTranspiledOptions["modules"],
  spec: string,
): unknown {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (mod.named) return namespaceAbsOf(mod);
  return mod;
}

/** 导出语句后处理：specifier / re-export / star / default → __nudoExport 调用。
 *  静态声明导出（export function/const/let）走既有正则扫描 + 返回对象；
 *  冲突语义：显式导出压过 export *（ESM 早错保证 decl/specifier 不重名，
 *  star×star 按源序后者覆盖——与 collectAbsExports 顺序口径一致）。 */
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
  // export default <expr>;（transpile 保证函数/类默认已展开成命名 + 标识符形态）
  return js.replace(
    /^export default (.+);\s*$/gm,
    (_all, expr: string) => `__nudoExport("default", ${expr});`,
  );
}

/** runTranspiled 顶层绑定表（checkSource varAbs 通道；WeakMap 不碰返回面） */
const runBindings = new WeakMap<object, Map<string, unknown>>();

export function bindingsOf(run: Record<string, unknown>): Map<string, unknown> | undefined {
  return runBindings.get(run);
}

/**
 * 执行一段 B 路径程序，返回顶层 `export function` / `export const`。
 */
export function runTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> {
  resetBCallBudget(); // 宿主入口重置（与 ast-eval resetAbsCallBudget 同口径）
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

  const exportFns = [...js.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!);
  js = js.replace(/^export function /gm, "function ");
  const exportConsts = [...js.matchAll(/^export (?:const|let) (\w+)/gm)].map((m) => m[1]!);
  js = js.replace(/^export (?:const|let) /gm, "let ");

  const names = [...new Set([...exportFns, ...exportConsts])];
  const dynExports: Record<string, unknown> = {};
  const bindings = new Map<string, unknown>();
  const argNames = [
    ...runtimeArgNames(),
    "__nudoModules",
    "__nudoBindImport",
    "__nudoBindNamespace",
    "__nudoReplaces",
    "__nudoRequire",
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
    if (n === "__nudoEnv") return opts.envGlobals ?? {};
    if (n === "__nudoExport") {
      return (name: string, value: unknown) => {
        dynExports[name] = value;
      };
    }
    if (n === "__nudoExportStar") {
      return (spec: string) => {
        const mod = modules?.[spec];
        if (mod && "named" in (mod as object)) {
          for (const [k, v] of Object.entries((mod as AbsModuleExports).named)) {
            dynExports[k] = v;
          }
        }
      };
    }
    if (n === "__nudoExports") return dynExports;
    return rtAllBindings()[n];
  });

  // @nudo:env 全局绑定
  if (opts.envGlobals && Object.keys(opts.envGlobals).length > 0) {
    const envBinds = Object.keys(opts.envGlobals)
      .map((k) => `const ${k} = __nudoEnv[${JSON.stringify(k)}];`)
      .join("\n");
    js = `${envBinds}\n${js}`;
  }

  // CJS 面：exports.X = v / module.exports 命名空间建模（此前 exports 未绑定
  // → ReferenceError → CJS 文件整体 B-incapable）。exports = 命名空间 obj Abs
  // （$set 写槽）；module.exports 重赋值 → 单导出（default）。
  const hasCjsExports = /\b(?:exports|module)\s*(?:\.|\[)/.test(source);
  if (hasCjsExports) {
    js = `let exports = $obj({});\nlet module = $obj({ exports });\nconst __nudoCjsOrig = exports;\n${js}`;
  }

  // 动态导出（specifier/re-export/star/default）先展开，静态声明名后写：
  // 显式导出压过 export *（ESM 语义；decl/specifier 重名是 ESM 早错）。
  const cjsMerge = hasCjsExports
    ? `(() => { const me = $get(module, "exports"); if (me !== __nudoCjsOrig && me && typeof me === "object" && "shape" in me) { return { default: me }; } const out = {}; if (__nudoCjsOrig && __nudoCjsOrig.shape && __nudoCjsOrig.shape.k === "obj") { for (const k of Object.keys(__nudoCjsOrig.shape.slots)) out[k] = __nudoCjsOrig.shape.slots[k].value; } return out; })()`
    : "{}";
  const ret = `return { ...__nudoExports, ...${cjsMerge}, ${names.join(", ")} };`;
  const fn = new Function(...argNames, `${js}\n${ret}`);
  setBBindingSink(bindings);
  try {
    const result = fn(...args) as Record<string, unknown>;
    runBindings.set(result, bindings);
    return result;
  } finally {
    setBBindingSink(null);
  }
}

/** B-path 回落事件（观测单一埋点；reason: unsupported:* = 能力边界，internal = B 自身缺陷） */
export type BPathFallback = {
  reason: string;
  message: string;
  loc?: { line: number; column: number };
};

let bFallbackCollector: ((f: BPathFallback) => void) | null = null;

export function setBPathFallbackCollector(
  collector: ((f: BPathFallback) => void) | null,
): void {
  bFallbackCollector = collector;
}

/** 表达式级求值（scan 的 case 字面量实参等静态求值面）：编译单表达式经
 *  B 运行时执行。bindings：表达式自由标识符 → Abs（调用方按绑定表注入）。
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

/** 记录一次 B 回落（body-fn 等非 runTranspiled 入口共用） */
export function noteBPathFallback(e: unknown): void {
  if (!bFallbackCollector) return;
  const f: BPathFallback = e instanceof NudoUnsupportedError
    ? { reason: `unsupported:${e.reason}`, message: e.message, ...(e.loc ? { loc: e.loc } : {}) }
    : isNudoThrow(e)
      ? // NudoThrow：程序自身的抛（如顶层 this 写 / strict 写 TypeError）——
        // 模块装载失败，不是 B 能力边界也不是 B 缺陷（catch 可吸收）
        { reason: "module-throw", message: e instanceof Error ? e.message : String(e) }
      : { reason: "internal", message: e instanceof Error ? e.message : String(e) };
  try {
    bFallbackCollector(f);
  } catch {
    /* collector 不得打断 */
  }
}

/**
 * B 单一入口：runTranspiled + 类型化回落观测。
 * unsupported:*（能力边界）/ internal（B 缺陷）都记录到收集器；
 * 返回 undefined 表示调用方应走解释路径。
 */
export function tryRunTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> | undefined {
  try {
    return runTranspiled(source, opts);
  } catch (e) {
    noteBPathFallback(e);
    return undefined;
  }
}

export type TranspiledCallResult = {
  result: Abs;
  /** 非 never 表示函数可能 throw 该类型 */
  throws: Abs;
};

function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/** 调用 runTranspiled 导出（捕获 $throw）。opts.phi：入口 Φ 种子
 *  （instantiate/symbolic 的约束入口——B 侧路径条件收窄）。 */
export function callTranspiledExportFull(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi },
): TranspiledCallResult {
  const fn = exports[name];
  if (typeof fn === "function") {
    resetBCallBudget(); // 每次具名调用独立预算（不跨调用累积 totalCalls）
    return runWithLoopExits(() => {
      try {
        const invoke = () => (fn as (...a: Abs[]) => unknown)(...args);
        const r = opts?.phi ? withExecPhi(opts.phi, invoke) : invoke();
        // 微任务（then/catch 回调）在同步返回值算完后才跑
        drainPromiseMicros();
        if (!isAbsVal(r)) return joinControlExits(unknown);
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
        return joinControlExits(unknown);
      }
    });
  }
  if (isAbsVal(fn)) {
    // export const f = (x) => …：导出值是一等 fn Abs —— 按调用语义 apply
    if (fn.shape.k === "fn") {
      return runWithLoopExits(() => {
        try {
          const r = $call(fn, args);
          return joinControlExits(r);
        } catch (e) {
          if (isNudoReturn(e)) {
            return joinControlExits(e.absValue);
          }
          if (isNudoThrow(e)) {
            return { result: joinLoopExits(never), throws: joinThrowExits(e.absValue) };
          }
          return joinControlExits(unknown);
        }
      });
    }
    return { result: fn, throws: never };
  }
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
