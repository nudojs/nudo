/**
 * 相对/绝对 specifier → 模块源码。
 * CLI / LSP / vite / check 共用同一扩展名表，避免门禁结果分叉。
 */

import { existsSync, statSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

export type LoadModule = (spec: string, fromFile: string) => string | undefined;

/** 默认 loadModule：支持 .js/.mjs/.ts 与 index 入口 */
export function defaultLoadModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  try {
    const base = dirname(resolve(fromFile));
    const p = resolve(base, spec);
    for (const cand of [
      p,
      `${p}.js`,
      `${p}.mjs`,
      `${p}.ts`,
      join(p, "index.js"),
      join(p, "index.mjs"),
      join(p, "index.ts"),
    ]) {
      if (existsSync(cand) && !statSync(cand).isDirectory()) {
        return readFileSync(cand, "utf-8");
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
