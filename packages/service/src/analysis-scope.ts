/**
 * 分析范围判定（A1/A2，design-analysis-scope.md）。
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
} from "./evaluator/config.ts";
import { isNudoTargetPath } from "./target-path.ts";

export function hasNudoDirectives(source: string): boolean {
  return /@nudo:(case|mock|pure|skip|sample|refine|interface|import|env|mock-module|as|replace)\b/.test(source);
}

function hasExport(source: string): boolean {
  return /\bexport\b|\bmodule\.exports\b|\bexports\./.test(source);
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

/** 无 projectDir 时的 exclude 片段匹配（双星段或裸段名） */
function simpleExcludeHit(pattern: string, path: string): boolean {
  const bare = pattern.replace(/^\*\*/, "").replace(/^\//, "").replace(/\/\*\*$/, "").replace(/^\*\//, "");
  if (!bare || bare.includes("*")) {
    // 退化为：node_modules / dist / coverage 路径段
    return /\/(node_modules|dist|coverage)\//.test("/" + path + "/");
  }
  return path.includes(`/${bare}/`) || path.endsWith(`/${bare}`);
}
