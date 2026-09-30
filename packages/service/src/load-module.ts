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

/**
 * 文件已解析但读失败（EACCES / EMFILE / EISDIR-race …）。
 * 与「无此文件」（loadModule 返回 undefined）必须区分：侧车 auto-bind 在
 * 读失败时静默失效会让约束回落 any，且没有任何 nudo:interface-load。
 */
export class ModuleReadError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(path: string, cause: unknown) {
    const code = (cause as { code?: string } | undefined)?.code ?? "EREAD";
    super(`cannot read module '${path}': ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ModuleReadError";
    this.code = code;
    this.path = path;
  }
}

/**
 * 默认 loadModule：支持 .js/.mjs/.ts 与 index 入口。
 * 契约：无候选文件 → undefined；文件存在但读失败 → 抛 ModuleReadError
 * （调用方可据此区分「无侧车」与「侧车不可读」）。
 */
export function defaultLoadModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  let cand: string | undefined;
  try {
    cand = resolveModuleFile(spec, fromFile);
  } catch {
    return undefined;
  }
  if (!cand) return undefined;
  try {
    return readFileSync(cand, "utf-8");
  } catch (e) {
    // ENOENT：resolve 与 read 之间的竞态删文件，按「无此文件」处理
    if ((e as { code?: string } | undefined)?.code === "ENOENT") return undefined;
    throw new ModuleReadError(cand, e);
  }
}

/** loadModule 容错包装：读失败当 miss，避免 I/O 错误炸穿指纹/图遍历。 */
export function safeLoadModule(
  loadModule: (spec: string, fromFile: string) => string | undefined,
  spec: string,
  fromFile: string,
): string | undefined {
  try {
    return loadModule(spec, fromFile);
  } catch {
    return undefined;
  }
}
