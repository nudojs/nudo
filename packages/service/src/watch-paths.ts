/**
 * CLI watch 路径门禁：推断目标之外，侧车契约与项目配置变更也必须让
 * 分析 memo 失效（侧车进 fingerprint/ambient 绑定；配置改 analysis/env）。
 */
import { isNudoTargetPath } from "./target-path.ts";

const PROJECT_CONFIG_BASENAMES = new Set([
  "package.json",
  "nudo.json",
  "nudo.config.js",
  "nudo.config.mjs",
  "nudo.config.ts",
  ".nudorc",
  ".nudorc.json",
]);

/** Formal sidecar contracts only — drafts never ambient-bind and need not reanalyze */
export function isSidecarPath(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  if (lower.includes(".nudo.draft.")) return false;
  return lower.endsWith(".nudo.js") || lower.endsWith(".nudo.mjs") || lower.endsWith(".nudo.ts");
}

export function isProjectConfigPath(path: string): boolean {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return PROJECT_CONFIG_BASENAMES.has(base.toLowerCase());
}

/** Watch accept gate: analysis targets + sidecar/config invalidators */
export function isWatchRelevantPath(path: string): boolean {
  return isNudoTargetPath(path) || isSidecarPath(path) || isProjectConfigPath(path);
}

/** `lib.nudo.js|ts` → candidate ambient sources next to it */
export function ambientSourcesOfSidecar(sidecarPath: string): string[] {
  const norm = sidecarPath.replace(/\\/g, "/");
  const m = norm.match(/^(.*)\.nudo\.(js|ts)$/i);
  if (!m || norm.toLowerCase().includes(".nudo.draft.")) return [];
  const base = m[1]!;
  const ext = m[2]!.toLowerCase();
  return ext === "js" ? [`${base}.js`, `${base}.mjs`] : [`${base}.ts`, `${base}.mts`];
}
