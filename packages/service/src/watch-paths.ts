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

/**
 * 正式侧车后缀 —— isSidecarPath 门禁与 ambientSourcesOfSidecar 反查的
 * 共同事实源（两处各自手写会漂移，BUG-011）。draft 后缀（.nudo.draft.*）
 * 不是正式侧车，单独判定。
 */
const FORMAL_SIDECAR_SUFFIXES = [".nudo.js", ".nudo.mjs", ".nudo.ts"] as const;

type FormalSidecarSuffix = (typeof FORMAL_SIDECAR_SUFFIXES)[number];

/**
 * 侧车后缀 → 它可伴随的 ambient 源模块后缀（与 core sidecarPathOf 的约定
 * 一致：js 族源码 ↔ .nudo.js（.nudo.mjs 为其 ESM 变体），ts 族 ↔ .nudo.ts）。
 * 键类型钉死为 FormalSidecarSuffix：给 FORMAL_SIDECAR_SUFFIXES 加后缀而漏配
 * fan-out 会直接编译失败。
 */
const SIDECAR_AMBIENT_SUFFIXES: Record<FormalSidecarSuffix, readonly string[]> = {
  ".nudo.js": [".js", ".mjs"],
  ".nudo.mjs": [".js", ".mjs"],
  ".nudo.ts": [".ts", ".mts"],
};

/** 大小写不敏感尾缀匹配（只在尾部 lower，避免 Unicode 大小写变换改变长度） */
function matchFormalSidecarSuffix(path: string): FormalSidecarSuffix | undefined {
  for (const suffix of FORMAL_SIDECAR_SUFFIXES) {
    if (path.slice(-suffix.length).toLowerCase() === suffix) return suffix;
  }
  return undefined;
}

/** Formal sidecar contracts only — drafts never ambient-bind and need not reanalyze */
export function isSidecarPath(path: string): boolean {
  const lower = path.toLowerCase().replace(/\\/g, "/");
  if (lower.includes(".nudo.draft.")) return false;
  return matchFormalSidecarSuffix(lower) !== undefined;
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

/** `lib.nudo.{js,mjs,ts}` → candidate ambient sources next to it */
export function ambientSourcesOfSidecar(sidecarPath: string): string[] {
  const norm = sidecarPath.replace(/\\/g, "/");
  if (norm.toLowerCase().includes(".nudo.draft.")) return [];
  // 后缀集合来自 FORMAL_SIDECAR_SUFFIXES（与 isSidecarPath 同源，不另写正则）
  const suffix = matchFormalSidecarSuffix(norm);
  if (!suffix) return [];
  const base = norm.slice(0, norm.length - suffix.length);
  return SIDECAR_AMBIENT_SUFFIXES[suffix].map((ext) => `${base}${ext}`);
}
