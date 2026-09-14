/**
 * 精化契约解析：唯一形态
 *
 *   @nudo:refine <param> <constraint>    参数精化（挂入口 Abs，参与运算）
 *   @nudo:refine return <constraint>     返回精化（推断返回值 ⊭ 时红）
 *
 * 不叫 requires：那只是「校验挡板」。
 * refine 表示约束是类型的一部分——Abs = shape × term × **pred** × conf，
 * pred 会流入代数（x>0 ⇒ x+1>1），不只是调用点挡一下。
 *
 * constraint 来自 *.nudo.js 导出的模板（number().gt(0) 等），
 * 由 /// @nudo:import { delay } from "./delay.nudo.js" 引入。
 * 不支持写 `x > 0`（绑死参数名）。
 * 不用 JSDoc @param/@return：那是类型注解语法。
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
  array,
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
  const ns = /@nudo:import\s+\*\s+as\s+(\w+)\s+from\s*["']([^"']+)["']/g;
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
  const fn = new Function("number", "string", "boolean", "shape", "array", body);
  return fn(number, stringC, booleanC, shape, array) as Record<string, unknown>;
}

export type RefineResolveOpts = {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
};

/** *.nudo.js 构建器执行结果（同内容只 new Function 一次） */
const nudoModuleExecCache = new Map<string, Record<string, unknown>>();
const MAX_NUDO_MODULE_EXEC = 64;

function execNudoModuleCached(src: string): Record<string, unknown> {
  const hit = nudoModuleExecCache.get(src);
  if (hit !== undefined) {
    nudoModuleExecCache.delete(src);
    nudoModuleExecCache.set(src, hit);
    return hit;
  }
  const out = execNudoModule(src);
  if (nudoModuleExecCache.size >= MAX_NUDO_MODULE_EXEC) {
    const oldest = nudoModuleExecCache.keys().next().value;
    if (oldest !== undefined) nudoModuleExecCache.delete(oldest);
  }
  nudoModuleExecCache.set(src, out);
  return out;
}

export function resetNudoModuleExecCache(): void {
  nudoModuleExecCache.clear();
}

/** 从导入收集 name → NudoConstraint */
function collectConstraints(
  source: string,
  opts: RefineResolveOpts,
): Map<string, NudoConstraint> {
  const map = new Map<string, NudoConstraint>();
  const imports = extractNudoImports(source);
  for (const imp of imports) {
    if (!opts.loadModule || !opts.fromFile) continue;
    const src = opts.loadModule(imp.spec, opts.fromFile);
    if (!src) continue;
    let exports: Record<string, unknown>;
    try {
      exports = execNudoModuleCached(src);
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

/** 从源码抽函数上的 @nudo:refine 行 */
function extractRefineLines(source: string, fnName: string): string[] {
  // `export function f` / `export async function f` / `export const f =`
  // 前缀必须一并匹配：否则 match 落在行中，before 以 `export …` 结尾，
  // 反向注释扫描立即 break，@nudo:refine 整体丢失（导出函数的 refine
  // 全部静默失效）。
  const fnRe = new RegExp(
    `(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s+${fnName}\\b|const\\s+${fnName}\\s*=)`,
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
      const rm = line.match(/@nudo:refine\s+(.+)$/);
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
export type RefineEntry = {
  param: string;
  pred: Pred;
  constraint: NudoConstraint;
};

export function extractRefinesFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): RefineEntry[] {
  // 快路径：整文件无 @nudo:refine 时免 regex 扫全文（after-edit 批量 check）
  if (!source.includes("@nudo:refine")) return [];
  const constraints = collectConstraints(source, opts);
  const out: RefineEntry[] = [];
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(\w+)\s+(\w+)$/);
      if (!m) continue;
      const [, param, cName] = m;
      // return 是后置目标，不进参数精化
      if (param === "return") continue;
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

/** refine 参数 → 带约束模板的下标表（shape 检查用） */
export function refineToIndexedFull(
  source: string,
  fnName: string,
  paramNames: string[],
  opts: RefineResolveOpts = {},
): Array<[number, RefineEntry]> {
  const raw = extractRefinesFromSource(source, fnName, opts);
  const out: Array<[number, RefineEntry]> = [];
  for (const item of raw) {
    const idx = paramNames.indexOf(item.param);
    if (idx >= 0) out.push([idx, item]);
  }
  return out;
}

/**
 * 解析 `@nudo:refine return positive` → 返回精化。
 * 返回 undefined = 无声明（不猜后置）。
 */
export function extractRefineReturnFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): { name: string; constraint: NudoConstraint } | undefined {
  if (!source.includes("@nudo:refine")) return undefined;
  const constraints = collectConstraints(source, opts);
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^return\s+(\w+)$/);
      if (!m) continue;
      const cName = m[1]!;
      const c = constraints.get(cName);
      if (!c) continue;
      return { name: cName, constraint: c };
    }
  }
  return undefined;
}
