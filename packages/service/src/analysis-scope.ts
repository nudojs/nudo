/**
 * 分析范围判定（design-cli-semantics.md §7）。
 * CLI 显式路径不受 mode 限制；本模块供 LSP/watch 自动验证使用。
 */

import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { sidecarPathOf } from "@nudojs/core";
import {
  analysisConfig,
  findProjectConfig,
  matchesEmitAllowlist,
  type AnalysisConfig,
  type DiagnosticsLevel,
} from "./evaluator/config.ts";
import { isNudoTargetPath } from "./target-path.ts";

/** 默认档下应静音的 evaluator warning 码（噪声控制，A3） */
const NOISY_WARNING_CODES = new Set([
  "nudo:unknown-recv",
  "nudo:builtin-unknown",
  "nudo:no-signature",
]);

/**
 * 按 analysis.diagnostics 档过滤 evaluator/check **显示路径**诊断。
 * - off：显示层全静音（与 errors 档区分）。check 门禁（CLI `nudo check` /
 *   checkSource）独立于本过滤，不受 off 影响。
 * - errors：只发 severity=error
 * - default：error + warning（静音 NOISY_WARNING_CODES）
 * - verbose：全量
 */
export function filterDiagnosticsByLevel<T extends { severity: string; code?: string }>(
  diags: T[],
  level: DiagnosticsLevel,
): T[] {
  if (level === "verbose") return diags;
  // off ≢ errors：显示路径真正静音；check gate 另走 checkSource
  if (level === "off") return [];
  if (level === "errors") return diags.filter((d) => d.severity === "error");
  // default
  return diags.filter((d) => {
    if (d.severity === "error") return true;
    if (d.severity === "info") return false;
    if (d.severity === "warning" && d.code && NOISY_WARNING_CODES.has(d.code)) return false;
    return d.severity === "warning";
  });
}

export function diagnosticsLevelForFile(filePath: string): DiagnosticsLevel {
  return analysisConfig(findProjectConfig(dirname(filePath))?.config).diagnostics;
}

export function hasNudoDirectives(source: string): boolean {
  return /@nudo:(case|mock|pure|skip|sample|contract|import|env|mock-module|as|replace)\b/.test(source);
}

/** 去掉注释与字符串字面量，避免 `// export …` 等散文触发 exports 门禁 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
}

function hasExport(source: string): boolean {
  // 与 core localNamedExports 的 CJS 面对齐：exports.x / exports["x"] /
  // module.exports.x / module.exports["x"] / Object.assign(exports
  // 先剥注释/字符串：`// export` 不是导出。
  const s = stripCommentsAndStrings(source);
  return (
    /(^|[\s;}])export\b/.test(s) ||
    /\bmodule\.exports\b/.test(s) ||
    /\bexports\s*[.[]/.test(s) ||
    /Object\.assign\s*\(\s*(module\.)?exports\b/.test(s)
  );
}

/**
 * 是否应对该文件跑分析（自动路径，如 LSP validate）。
 * - 非 target 路径 → false
 * - exclude 命中 / include 未命中 → false
 * - mode=directives → 仅有指令
 * - mode=exports → 指令 | export | 同名侧车
 * - mode=all → true
 */
export function shouldAnalyzeFile(
  filePath: string,
  source: string | undefined,
  config?: AnalysisConfig,
): boolean {
  if (!isNudoTargetPath(filePath)) return false;
  const proj = findProjectConfig(dirname(filePath));
  const cfg = config ?? analysisConfig(proj?.config);
  const projectDir = proj?.projectDir;

  if (cfg.exclude.length > 0 && projectDir) {
    if (matchesEmitAllowlist(filePath, projectDir, cfg.exclude)) return false;
  } else if (cfg.exclude.length > 0 && !projectDir) {
    const norm = filePath.replace(/\\/g, "/");
    if (cfg.exclude.some((p) => simpleExcludeHit(p, norm))) return false;
  }
  // include 空 = 不过滤（目标扩展名已由 isNudoTargetPath 保证）
  if (cfg.include.length > 0 && projectDir) {
    if (!matchesEmitAllowlist(filePath, projectDir, cfg.include)) return false;
  }

  if (cfg.mode === "all") return true;

  const text = source;
  if (text !== undefined && hasNudoDirectives(text)) return true;
  if (cfg.mode === "directives") return false;

  // exports：export 关键字或旁路侧车存在
  if (text !== undefined && hasExport(text)) return true;
  try {
    if (existsSync(sidecarPathOf(filePath))) return true;
  } catch {
    // ignore
  }
  return false;
}

/**
 * 无 projectDir 时的 exclude 片段匹配（双星段或裸段名）。
 *
 * **限制（不假装自定义 glob 生效）**：package.json 自定义 `nudo.analysis.exclude`
 * 含 `*`/`**` 时无法相对 projectDir 解析，退化为最小安全默认——只拦
 * node_modules / dist / coverage 路径段；字面量路径片段仍按 contains 匹配。
 * 完整自定义 exclude 需要 findProjectConfig 命中带 `nudo` 键的 package.json
 * （从而拿到 projectDir + matchesEmitAllowlist）。
 */
function simpleExcludeHit(pattern: string, path: string): boolean {
  const bare = pattern.replace(/^\*\*/, "").replace(/^\//, "").replace(/\/\*\*$/, "").replace(/^\*\//, "");
  if (!bare || bare.includes("*")) {
    // 退化为：node_modules / dist / coverage 路径段（自定义 glob 不可用）
    return /\/(node_modules|dist|coverage)\//.test("/" + path + "/");
  }
  return path.includes(`/${bare}/`) || path.endsWith(`/${bare}`);
}
