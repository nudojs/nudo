/**
 * 分析范围判定（design-cli-semantics.md §7）。
 * CLI 显式路径不受 mode 限制；本模块供 LSP/watch 自动验证使用。
 */

import { dirname, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import { sidecarPathOf } from "@nudojs/core";
import {
  analysisConfig,
  DEFAULT_ANALYSIS_EXCLUDE,
  findProjectConfig,
  matchesEmitAllowlist,
  type AnalysisConfig,
  type DiagnosticsLevel,
} from "./evaluator/config.ts";
import { compileAnyMatcher, compilePattern } from "./glob.ts";
import { isNudoTargetPath } from "./target-path.ts";
import { stripCommentsAndStrings, stripStringsKeepComments } from "@nudojs/core/internal";

/**
 * 默认安全排除（node_modules / dist / coverage）——对归一化完整路径始终
 * 叠加，自定义 `nudo.analysis.exclude` 不再顶掉这组保护（与
 * analysisConfig 无自定义时的回落默认同源，见 evaluator/config.ts）。
 */
const DEFAULT_EXCLUDE_MATCH = compileAnyMatcher(DEFAULT_ANALYSIS_EXCLUDE);

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
  // 指令合法住在注释里，字符串/模板里的同形文本不算——先剥字符串再测
  return /@nudo:(case|mock|pure|skip|sample|contract|import|env|mock-module|as|replace)\b/.test(
    stripStringsKeepComments(source),
  );
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

  // exclude：默认安全排除（node_modules/dist/coverage）始终叠加；自定义
  // 模式用共享 glob 编译器（./glob.ts）匹配，见 excludeHit。
  const norm = filePath.replace(/\\/g, "/");
  if (DEFAULT_EXCLUDE_MATCH(norm)) return false;
  if (cfg.exclude.length > 0 && cfg.exclude.some((p) => excludeHit(p, projectDir, filePath, norm))) {
    return false;
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
 * exclude 模式命中判定（共享 glob 编译器 ./glob.ts；`nudo.analysis.exclude`
 * 不含这组语义时就只是不命中，**不静默退化**成别的默认）：
 * - 无通配符（`*` / `?`）→ **字面量子串**：完整路径或相对路径任一命中
 *   （`src/generated` 命中 `…/src/generated/…` 与 `…/generated` 结尾）。
 * - 通配符模式 → 锚定 glob（`**` 段零或多段、`*`/`?` 不跨 `/`）：
 *   优先对 projectDir 相对路径匹配（`src/generated/**` 这类相对子树模式），
 *   另对归一化完整路径匹配（`**` 前缀 + `*.spec.js` 这类模式与绝对路径
 *   模式两种口径都能命中）。
 *   无 projectDir 时只剩完整路径口径——纯相对前缀模式自然不命中，按其
 *   字面量/glob 语义如实求值（本函数无诊断管道，不新增警告通道）。
 * - 相对路径逃出 projectDir（`..` 前缀）不参与相对口径（与
 *   matchesEmitAllowlist 同守卫）；完整路径口径仍可命中。
 */
function excludeHit(
  pattern: string,
  projectDir: string | undefined,
  filePath: string,
  norm: string,
): boolean {
  const match = compilePattern(pattern);
  if (match(norm)) return true;
  if (!projectDir) return false;
  const rel = relative(projectDir, filePath).split(sep).join("/");
  return rel.startsWith("..") ? false : match(rel);
}
