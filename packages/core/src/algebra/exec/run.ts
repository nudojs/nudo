/**
 * 进程内 B 路径执行：transpile 源码 → new Function 跑在 runtime 上。
 * 不写临时文件；相对 import 用注入的 AbsModuleExports / JS 导出绑定。
 */

import * as runtime from "./runtime.ts";
import type { Abs } from "../abs.ts";
import type { AbsModuleExports } from "../abs-modules.ts";
import { transpile } from "./transpile.ts";
import { $call } from "./call.ts";
import { unknown } from "../abs.ts";

export type RunTranspiledOptions = {
  /** 说明符 → 依赖导出（host 模块图或 runTranspiled 产物） */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  maxLoopIters?: number;
};

const RUNTIME_IMPORT_RE = /^import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*$/m;

/** 相对 import → 从注入 modules 取绑定（Abs fn 包成 JS 可调用） */
function rewriteUserImports(
  js: string,
  modules: RunTranspiledOptions["modules"],
): string {
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

function runtimeArgNames(): string[] {
  return Object.keys(runtime).filter((k) => k.startsWith("$"));
}

/** 把 modules[name] 绑成可调用 JS 函数或常量 Abs */
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
  // Abs absFunction → JS 包装
  const absFn = v as Abs;
  return (...args: Abs[]) => $call(absFn, args);
}

/**
 * 执行一段 B 路径程序，返回顶层 `export function` / `export const`。
 * 导出的 function 是 JS `(…Abs) => Abs`；const 是 Abs 值。
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

/** 调用 runTranspiled 导出 */
export function callTranspiledExport(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
): Abs {
  const fn = exports[name];
  if (typeof fn === "function") {
    try {
      return (fn as (...a: Abs[]) => Abs)(...args);
    } catch {
      return unknown;
    }
  }
  if (fn && typeof fn === "object" && "shape" in (fn as object) && "conf" in (fn as object)) {
    return fn as Abs;
  }
  return unknown;
}
