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
import type { Abs } from "../abs.ts";
import { never, unknown } from "../abs.ts";
import type { AbsModuleExports } from "../abs-modules.ts";
import { transpile } from "./transpile.ts";
import { $call } from "./call.ts";
import { isNudoThrow } from "./runtime.ts";

export type RunTranspiledOptions = {
  /** 说明符 → 依赖导出（host 模块图或 runTranspiled 产物） */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  maxLoopIters?: number;
  /** analyze = 跳过效应性顶层语句 */
  mode?: "exec" | "analyze";
};

const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;

/** 相对 import → 从注入 modules 取绑定（Abs fn 包成 JS 可调用） */
function rewriteUserImports(js: string, modules: RunTranspiledOptions["modules"]): string {
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
          return `const ${bind} = __nudoBindImport(${JSON.stringify(spec)}, ${JSON.stringify(imported)});`;
        })
        .join("\n");
    },
  );
}

/** 分析模式：只丢掉**顶层（零缩进）**效应性语句；函数体保持不动 */
function stripEffectfulTopLevel(js: string): string {
  const lines = js.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // 仅处理顶层：行首无缩进
    const isTop = /^\S/.test(line) && line.trim().length > 0;
    const t = line.trim();
    if (isTop) {
      // 顶层调用 / fetch / console
      if (
        /^(console\.|fetch\s*\(|setTimeout\s*\(|setInterval\s*\()/.test(t) ||
        (/^[A-Za-z_$][\w$]*\s*\(/.test(t) &&
          !/^(const|let|var|function|export|import|return|if|for|while|switch|try|throw)\b/.test(t))
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
  return Object.keys(runtime).filter((k) => k.startsWith("$"));
}

function bindImport(
  modules: RunTranspiledOptions["modules"],
  spec: string,
  name: string,
): unknown {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return undefined;
  const named = (mod as AbsModuleExports).named;
  const v = named?.[name];
  if (v === undefined) {
    const rec = (mod as Record<string, unknown>)[name];
    if (typeof rec === "function") return rec;
    return undefined;
  }
  if (typeof v === "function") return v;
  const absFn = v as Abs;
  return (...args: Abs[]) => $call(absFn, args);
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
  });
  js = js.replace(RUNTIME_IMPORT_RE, "");
  js = rewriteUserImports(js, modules);
  if (opts.mode === "analyze") {
    js = stripEffectfulTopLevel(js);
  }

  const exportFns = [...js.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!);
  js = js.replace(/^export function /gm, "function ");
  const exportConsts = [...js.matchAll(/^export const (\w+)/gm)].map((m) => m[1]!);
  js = js.replace(/^export const /gm, "const ");

  const names = [...new Set([...exportFns, ...exportConsts])];
  const argNames = [...runtimeArgNames(), "__nudoModules", "__nudoBindImport"];
  const args = argNames.map((n) => {
    if (n === "__nudoModules") return modules;
    if (n === "__nudoBindImport") {
      return (spec: string, name: string) => bindImport(modules, spec, name);
    }
    return (runtime as Record<string, unknown>)[n];
  });

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
    try {
      const r = (fn as (...a: Abs[]) => unknown)(...args);
      if (!isAbsVal(r)) return { result: unknown, throws: never };
      return { result: r, throws: never };
    } catch (e) {
      if (isNudoThrow(e)) {
        return { result: never, throws: e.absValue };
      }
      return { result: unknown, throws: never };
    }
  }
  if (isAbsVal(fn)) {
    return { result: fn, throws: never };
  }
  return { result: unknown, throws: never };
}

/** 调用 runTranspiled 导出（仅结果） */
export function callTranspiledExport(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
): Abs {
  return callTranspiledExportFull(exports, name, args).result;
}
