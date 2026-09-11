/**
 * 契约解析：唯一形态
 *
 *   @nudo:requires <param> <constraint>   前置（调用点）
 *   @nudo:return <constraint>             后置（推断返回值）
 *
 * constraint 来自 *.nudo.js 导出的模板（number().gt(0) 等），
 * 由 /// @nudo:import { delay } from "./delay.nudo.js" 引入。
 *
 * 不支持在 requires 里写 `x > 0`（绑死参数名）。
 * 不用 JSDoc 的 @param/@return：那是类型注解；这里是契约门禁。
 */

import type { Pred } from "./pred.ts";
import { v as termVar } from "./term.ts";
import { parseSource } from "./parse-source.ts";
import {
  type NudoConstraint,
  isNudoConstraint,
  instantiateConstraint,
  number,
  string as stringC,
  boolean as booleanC,
  shape,
} from "./constraint.ts";

/** `/// @nudo:import { delay, percent } from "./delay.nudo.js"` */
export type NamedImport = { names: string[]; spec: string };

export function extractNudoImports(source: string): NamedImport[] {
  const out: NamedImport[] = [];
  // named: import { a, b as c } from "..."
  const named = /@nudo:import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(source))) {
    const names = m[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/).pop()!.trim());
    out.push({ names, spec: m[2]! });
  }
  // 兼容 namespace（仍支持）
  const ns = /@nudo:import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/g;
  while ((m = ns.exec(source))) {
    out.push({ names: [`*${m[1]}`], spec: m[2]! });
  }
  return out;
}

/**
 * 执行 *.nudo.js（真实 JS + 我们的构建器）。
 * 把 export const 改写成 const，末尾 return { names }。
 */
export function execNudoModule(src: string): Record<string, unknown> {
  const names = [...src.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]!);
  let body = src.replace(/export\s+const\b/g, "const");
  // 去掉 import { number } from "..." —— 用注入参数
  body = body.replace(/^\s*import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, "");
  body = body.replace(/^\s*import\s+\*\s+as\s+\w+\s+from\s*["'][^"']+["'];?\s*$/gm, "");
  body += `\nreturn { ${names.join(", ")} };`;
  const fn = new Function("number", "string", "boolean", "shape", body);
  return fn(number, stringC, booleanC, shape) as Record<string, unknown>;
}

export type RequiresResolveOpts = {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
};

/** 从导入收集 name → NudoConstraint */
function collectConstraints(
  source: string,
  opts: RequiresResolveOpts,
): Map<string, NudoConstraint> {
  const map = new Map<string, NudoConstraint>();
  const imports = extractNudoImports(source);
  for (const imp of imports) {
    if (!opts.loadModule || !opts.fromFile) continue;
    const src = opts.loadModule(imp.spec, opts.fromFile);
    if (!src) continue;
    let exports: Record<string, unknown>;
    try {
      exports = execNudoModule(src);
    } catch {
      continue;
    }
    for (const name of imp.names) {
      if (name.startsWith("*")) continue; // namespace 暂不展开
      const v = exports[name];
      if (isNudoConstraint(v)) map.set(name, v);
    }
  }
  return map;
}

/** 从源码抽函数上的 @nudo:requires 行 */
function extractRequiresLines(source: string, fnName: string): string[] {
  const fnRe = new RegExp(
    `(?:export\\s+default\\s+)?(?:function\\s+${fnName}\\b|const\\s+${fnName}\\s*=)`,
  );
  const m = source.match(fnRe);
  if (!m || m.index === undefined) return [];
  const before = source.slice(0, m.index);
  const lines = before.split("\n");
  const reqs: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "" || line === "*/") continue;
    if (line.startsWith("*") || line.startsWith("/*") || line.startsWith("//")) {
      const rm = line.match(/@nudo:requires\s+(.+)$/);
      if (rm) reqs.unshift(rm[1]!.trim().replace(/\*\/$/, "").trim());
      continue;
    }
    break;
  }
  return reqs;
}

/**
 * 解析 `ms delay` / `n percent` → [param, Pred]
 * 多条用 && 或换行连接。
 * 同时保留原始 NudoConstraint（shape 字段检查用）。
 */
export type RequiresEntry = {
  param: string;
  pred: Pred;
  constraint: NudoConstraint;
};

export function extractRequiresFromSource(
  source: string,
  fnName: string,
  opts: RequiresResolveOpts = {},
): RequiresEntry[] {
  const constraints = collectConstraints(source, opts);
  const out: RequiresEntry[] = [];
  for (const line of extractRequiresLines(source, fnName)) {
    // 支持 `ms delay && n percent` 或逗号
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(\w+)\s+(\w+)$/);
      if (!m) continue;
      const [, param, cName] = m;
      const c = constraints.get(cName!);
      if (!c) continue;
      out.push({
        param: param!,
        pred: instantiateConstraint(c, param!),
        constraint: c,
      });
    }
  }
  return out;
}

/** 把 requires 映射到参数下标 */
export function requiresToIndexed(
  source: string,
  fnName: string,
  paramNames: string[],
  opts: RequiresResolveOpts = {},
): Array<[number, Pred]> {
  const raw = extractRequiresFromSource(source, fnName, opts);
  const out: Array<[number, Pred]> = [];
  for (const item of raw) {
    const idx = paramNames.indexOf(item.param);
    if (idx >= 0) out.push([idx, item.pred]);
  }
  return out;
}

/** requires → 带约束模板的下标表（shape 检查用） */
export function requiresToIndexedFull(
  source: string,
  fnName: string,
  paramNames: string[],
  opts: RequiresResolveOpts = {},
): Array<[number, RequiresEntry]> {
  const raw = extractRequiresFromSource(source, fnName, opts);
  const out: Array<[number, RequiresEntry]> = [];
  for (const item of raw) {
    const idx = paramNames.indexOf(item.param);
    if (idx >= 0) out.push([idx, item]);
  }
  return out;
}

/** 从源码抽函数上的 @nudo:return 行 */
function extractReturnLines(source: string, fnName: string): string[] {
  const fnRe = new RegExp(
    `(?:export\\s+default\\s+)?(?:function\\s+${fnName}\\b|const\\s+${fnName}\\s*=)`,
  );
  const m = source.match(fnRe);
  if (!m || m.index === undefined) return [];
  const before = source.slice(0, m.index);
  const lines = before.split("\n");
  const rets: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "" || line === "*/") continue;
    if (line.startsWith("*") || line.startsWith("/*") || line.startsWith("//")) {
      const rm = line.match(/@nudo:return\s+(\w+)\s*$/);
      if (rm) rets.unshift(rm[1]!.trim());
      continue;
    }
    break;
  }
  return rets;
}

/**
 * 解析 `@nudo:return positive` → 后置契约。
 * 返回 undefined = 无声明（不猜后置）。
 */
export function extractReturnFromSource(
  source: string,
  fnName: string,
  opts: RequiresResolveOpts = {},
): { name: string; constraint: NudoConstraint } | undefined {
  const lines = extractReturnLines(source, fnName);
  if (lines.length === 0) return undefined;
  const constraints = collectConstraints(source, opts);
  const cName = lines[lines.length - 1]!;
  const c = constraints.get(cName);
  if (!c) return undefined;
  return { name: cName, constraint: c };
}
