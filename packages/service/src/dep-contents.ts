/**
 * check/iface 磁盘缓存键的依赖内容采集。
 * 走 core `loadModuleDepsFingerprint`：覆盖 ESM from / require / dynamic import /
 * `@nudo:import` / ambient 侧车闭包——不只 `@nudo:import` 注释。
 */

import { readFileSync } from "node:fs";
import { loadModuleDepsFingerprint } from "@nudojs/core";

export type DepContent = { path: string; content: string | null };

export function collectLoadDepContents(
  filePath: string,
  source: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
): { depContents: DepContent[]; truncated: boolean } {
  const fp = loadModuleDepsFingerprint(source, loadModule, filePath);
  const depContents: DepContent[] = fp.paths.map((path) => {
    let content: string | null = null;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      content = null;
    }
    // 键用相对化路径由 checkCacheKey 负责；这里保留绝对路径供 sha 分段
    return { path, content };
  });
  return { depContents, truncated: fp.truncated };
}
