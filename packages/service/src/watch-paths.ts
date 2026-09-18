/**
 * CLI watch 路径门禁：推断目标之外，侧车契约、项目配置、path-based
 * `@nudo:env` 模板变更也必须让分析 memo 失效。
 */
import { isNudoTargetPath } from "./target-path.ts";
import { isEnvTemplatePath } from "./env-path-deps.ts";

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
  const norm = path.replace(/\\/g, "/");
  // node_modules 里的 package.json 不是项目配置（避免 npm install 全量失效风暴）
  if (/\/node_modules\//.test(`/${norm}`)) return false;
  const base = norm.split("/").pop() ?? path;
  return PROJECT_CONFIG_BASENAMES.has(base.toLowerCase());
}

/** Watch accept gate: analysis targets + sidecar/config/env-template invalidators */
export function isWatchRelevantPath(path: string): boolean {
  return (
    isNudoTargetPath(path) ||
    isSidecarPath(path) ||
    isProjectConfigPath(path) ||
    isEnvTemplatePath(path)
  );
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
