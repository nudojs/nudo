/**
 * 相对/绝对 specifier → 模块源码。
 * CLI / LSP / vite / check 共用同一扩展名表，避免门禁结果分叉。
 */

import { existsSync, statSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

export type LoadModule = (spec: string, fromFile: string) => string | undefined;

/** 统一扩展名表（文件后缀与 index 入口同序展开）。 */
export const MODULE_RESOLVE_EXTS = [".js", ".mjs", ".ts"] as const;

/**
 * 统一候选表：spec + 引用方文件 → 依次尝试的路径。
 * 所有相对 import/require 解析（load / 模块图 / 脏图边 / env 装载）必须走这里。
 */
export function moduleResolveCandidates(spec: string, fromFile: string): string[] {
  const p = resolve(dirname(resolve(fromFile)), spec);
  return [
    p,
    ...MODULE_RESOLVE_EXTS.map((e) => `${p}${e}`),
    ...MODULE_RESOLVE_EXTS.map((e) => join(p, `index${e}`)),
  ];
}

/** 首个真实文件候选（跳过目录）；无命中返回 undefined。 */
export function resolveModuleFile(spec: string, fromFile: string): string | undefined {
  for (const cand of moduleResolveCandidates(spec, fromFile)) {
    if (existsSync(cand) && !statSync(cand).isDirectory()) return cand;
  }
  return undefined;
}

/** 默认 loadModule：支持 .js/.mjs/.ts 与 index 入口 */
export function defaultLoadModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  try {
    const cand = resolveModuleFile(spec, fromFile);
    return cand ? readFileSync(cand, "utf-8") : undefined;
  } catch {
    return undefined;
  }
}
