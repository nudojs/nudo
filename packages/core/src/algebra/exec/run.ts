/**
 * 进程内 B 路径执行：transpile 源码 → new Function 跑在 runtime 上。
 * 不写临时文件；相对 import 用注入的 AbsModuleExports / JS 导出绑定。
 *
 * mode:
 * - "exec"（默认）：执行全部顶层（含副作用）
 * - "analyze"：只保留函数声明与纯字面量 const；跳过顶层表达式/循环/if
 *   ——分析入口安全，不触发 fetch 等顶层副作用
 */

import * as runtime from "./runtime.ts";
import * as classRt from "./class.ts";
import * as callsRt from "./calls.ts";
import type { Abs } from "../abs.ts";
import { never, unknown } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import type { AbsModuleExports } from "../abs-modules.ts";
import { transpile } from "./transpile.ts";
import { $call } from "./call.ts";
import { isNudoThrow, isNudoReturn, runWithLoopExits, takeLoopExits, takeThrowExits } from "./runtime.ts";

const rtAll = { ...runtime, ...classRt, ...callsRt } as Record<string, unknown>;
// ensure control-flow helpers are present even if a re-export layer omits them
rtAll.isNudoReturn = isNudoReturn;
rtAll.isNudoThrow = isNudoThrow;
rtAll.runWithLoopExits = runWithLoopExits;
rtAll.takeLoopExits = takeLoopExits;

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
};

const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;

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
      // 其它未知全局调用（未走 $callNamed 的）
      const callMatch = t.match(/^([A-Za-z_$][\w$]*)\s*\(/);
      if (
        callMatch &&
        !callMatch[1]!.startsWith("$") &&
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
        let depth = t.includes("{") ? 1 : 0;
        while (i < lines.length && depth > 0) {
          const l = lines[i]!;
          depth += (l.match(/\{/g) || []).length;
          depth -= (l.match(/\}/g) || []).length;
          i++;
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
  return Object.keys(rtAll).filter((k) => k.startsWith("$"));
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

/** `import * as ns`：整命名空间（named + default 槽）→ Abs 对象 */
function bindNamespace(modules: RunTranspiledOptions["modules"], spec: string): Abs {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (mod.named) {
    const { $obj } = rtAll as { $obj: (s: Record<string, Abs>) => Abs };
    const slots: Record<string, Abs> = {};
    for (const [k, v] of Object.entries(mod.named)) slots[k] = v;
    if (mod.default) slots["default"] = mod.default;
    return $obj(slots);
  }
  return unknown;
}

/** CJS require：modules[spec] → 可 $get 的 namespace Abs */
function requireFromModules(
  modules: RunTranspiledOptions["modules"],
  spec: string,
): unknown {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (mod.named) {
    const { $obj } = rtAll as { $obj: (s: Record<string, Abs>) => Abs };
    const slots: Record<string, Abs> = {};
    for (const [k, v] of Object.entries(mod.named)) slots[k] = v;
    if (mod.default) slots["default"] = mod.default;
    return $obj(slots);
  }
  return mod;
}

/**
 * 执行一段 B 路径程序，返回顶层 `export function` / `export const`。
 */
export function runTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> {
  const modules = opts.modules ?? {};
  let js = transpile(source, {
    runtimeImport: "@nudojs/core/exec",
    maxLoopIters: opts.maxLoopIters,
    source,
    replacements: opts.replacementTargets,
    asOverrides: opts.asOverrideTargets,
  });
  js = js.replace(RUNTIME_IMPORT_RE, "");
  js = rewriteUserImports(js);
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
  const argNames = [
    ...runtimeArgNames(),
    "__nudoModules",
    "__nudoBindImport",
    "__nudoBindNamespace",
    "__nudoReplaces",
    "__nudoRequire",
    "__nudoEnv",
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
    return rtAll[n];
  });

  // @nudo:env 全局绑定
  if (opts.envGlobals && Object.keys(opts.envGlobals).length > 0) {
    const envBinds = Object.keys(opts.envGlobals)
      .map((k) => `const ${k} = __nudoEnv[${JSON.stringify(k)}];`)
      .join("\n");
    js = `${envBinds}\n${js}`;
  }

  const ret = names.length > 0 ? `return { ${names.join(", ")} };` : "return {};";
  const fn = new Function(...argNames, `${js}\n${ret}`);
  return fn(...args) as Record<string, unknown>;
}

export type TranspiledCallResult = {
  result: Abs;
  /** 非 never 表示函数可能 throw 该类型 */
  throws: Abs;
};

function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/** 调用 runTranspiled 导出（捕获 $throw） */
export function callTranspiledExportFull(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
): TranspiledCallResult {
  const fn = exports[name];
  if (typeof fn === "function") {
    return runWithLoopExits(() => {
      try {
        const r = (fn as (...a: Abs[]) => unknown)(...args);
        if (!isAbsVal(r)) return joinControlExits(unknown);
        // 抽象分支 early-return / throw 记入 exits，与正常出口 join
        return joinControlExits(r);
      } catch (e) {
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
