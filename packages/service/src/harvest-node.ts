/**
 * 预置 Node API env：从 @types/node 的 .d.ts harvest。
 * 与 packages/env 的手写 env 并行；此路径自动、可刷新。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { harvestDts, type HarvestedEnv } from "@nudojs/harvester";
import { collectDtsFiles, resolvePackageRoot } from "./harvest-package.ts";

export type NodeEnvResult =
  | { ok: true; env: HarvestedEnv; root: string; files: number }
  | { ok: false; error: string };

/** harvest @types/node（限制文件数 + 时间预算，避免拖垮启动） */
export function harvestNodeTypes(
  fromDir?: string,
  maxFiles = 12,
  maxMs = 2500,
): NodeEnvResult {
  // @types/node 在 node_modules/@types/node
  const root =
    resolvePackageRoot("@types/node", fromDir) ??
    resolvePackageRoot("node", fromDir);
  if (!root || !existsSync(root)) {
    return { ok: false, error: "@types/node not found" };
  }
  // 优先 index.d.ts 等入口
  const dts = collectDtsFiles(root, maxFiles);
  if (dts.length === 0) {
    return { ok: false, error: `no .d.ts under ${root}` };
  }
  const env = harvestDts(dts, { maxMs });
  return { ok: true, env, root, files: env.stats.files };
}

/** 把 harvest 结果压成「模块名 → 导出名列表」摘要，便于日志/测试 */
export function summarizeNodeEnv(env: HarvestedEnv): {
  modules: string[];
  globals: string[];
  symbolCount: number;
} {
  return {
    modules: Object.keys(env.modules).sort(),
    globals: Object.keys(env.globals).sort().slice(0, 50),
    symbolCount: env.stats.symbols,
  };
}
