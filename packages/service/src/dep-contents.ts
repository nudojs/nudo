/**
 * check/iface 磁盘缓存键的依赖内容采集。
 * 走 core `loadModuleDepsFingerprint`：覆盖 ESM from / require / dynamic import /
 * `@nudo:import` / ambient 侧车闭包——不只 `@nudo:import` 注释。
 *
 * 内容必须优先取 loadModule 解析结果（fingerprint.contents），不得回读磁盘：
 * LSP buffer-aware loadModule 与自定义 loader 的内容可能与磁盘不一致，
 * 回读会让缓存键分叉（buffer 编辑后仍命中磁盘旧内容）。
 */

import { loadModuleDepsFingerprint } from "@nudojs/core";

export type DepContent = { path: string; content: string | null };

export function collectLoadDepContents(
  filePath: string,
  source: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
): { depContents: DepContent[]; truncated: boolean } {
  const fp = loadModuleDepsFingerprint(source, loadModule, filePath);
  // Prefer loadModule-resolved content; path is absolute here —
  // checkCacheKey / ifaceCacheKey relativize via projectDir.
  const depContents: DepContent[] =
    fp.contents.length > 0
      ? fp.contents
      : fp.paths.map((path) => ({ path, content: null }));
  return { depContents, truncated: fp.truncated };
}
