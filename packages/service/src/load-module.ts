/**
 * 相对/绝对 specifier → 模块源码。
 * CLI / LSP / vite / check 共用同一扩展名表，避免门禁结果分叉。
 */

import { statSync, readFileSync } from "node:fs";
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

/**
 * 首个真实文件候选（跳过目录）；无命中返回 undefined。
 *
 * fs 错误分类（#135）：单次 statSync（顺带消灭 existsSync+statSync 的
 * TOCTOU 双调用）——「路径不存在」类（ENOENT / ENOTDIR / EISDIR，其中
 * ENOTDIR 常见于候选表 `p/index.js` 穿过文件段 p）按该候选 miss 继续；
 * 其余（EACCES / EIO / ESTALE / EMFILE / EROFS…）是真实读故障，抛
 * ModuleReadError 上抛。此前 existsSync 吞掉一切错误 + 外层 catch 吞
 * statSync 抛错，瞬态故障被折叠成「无此文件」，再被上游缓存钉死整场。
 */
export function resolveModuleFile(spec: string, fromFile: string): string | undefined {
  for (const cand of moduleResolveCandidates(spec, fromFile)) {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(cand);
    } catch (e) {
      const code = (e as { code?: string } | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") continue;
      throw new ModuleReadError(cand, e);
    }
    if (!st.isDirectory()) return cand;
  }
  return undefined;
}

/**
 * 路径 stat 或文件读失败（EACCES / EMFILE / ESTALE / EIO …）。
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
 * 契约：无候选文件 → undefined；stat/read 级真实 fs 错误 → 抛
 * ModuleReadError（调用方可据此区分「无侧车」与「侧车不可读」）。
 */
export function defaultLoadModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  // stat 级真实 fs 故障以 ModuleReadError 上抛（不得折叠成「无此文件」）
  const cand = resolveModuleFile(spec, fromFile);
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
