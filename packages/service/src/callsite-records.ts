/**
 * 使用点记录采集（agent 面 `--from` 等价通道；族 25 Bug 994）。
 *
 * 口径与 CLI `nudo contract --from` **同源**：顶层调用表达式 ⇒ `call@`
 * 记录（采集入口复用 service 的 `collectCallRecords`——CLI 侧同一入口）。
 * 文件与目录都可传（目录 ⇒ 递归收 nudo 分析目标）。
 *
 * 与 CLI 的差异（有意）：CLI 把路径错误汇进 `PathError` 面并以 exit 1 收场；
 * 这里把「记录」与「路径错误」**分开返回**，由调用方（agent 工具）显式呈现
 * ——「现场文件读失败」与「现场文件里没有调用」必须可区分（CLI Bug 466 同径）。
 */
import { readFileSync, statSync, readdirSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { collectCallRecords } from "./analyzer-orchestrate-calls.ts";
import { shouldAnalyzeFile } from "./analysis-scope.ts";
import { isNudoTargetPath } from "./target-path.ts";
import type { CallRecord } from "./evaluator/call-record.ts";

/** 采集结果：记录 + 路径错误（两者必须分开呈现）。 */
export type CallsiteRecords = {
  /** call@ 记录（顶层调用表达式） */
  records: CallRecord[];
  /** 路径错误：文件不存在 / 读失败 / 目录里没有可分析的文件 / 文件里没有调用点 */
  errors: Array<{ path: string; message: string }>;
};

/** 目录扫描时跳过的目录名（与产品默认排除一致）。 */
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

/** 递归收集目录下的 nudo 分析目标（确定性排序）。 */
function collectSiteFiles(dir: string, out: string[]): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectSiteFiles(p, out);
    } else if (e.isFile() && isNudoTargetPath(p)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 采集使用点记录（`--from` 等价通道）。
 *
 * - 显式文件：直接采集（不按项目分析范围过滤——调用点文件未必是分析目标）。
 * - 目录：递归收 nudo 分析目标（`shouldAnalyzeFile` 口径：exclude/include/mode）。
 * - 路径错误**不抛异常**：并入 `errors` 由调用方呈现。
 */
export function collectCallsiteRecords(sites: string[]): CallsiteRecords {
  const records: CallRecord[] = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const site of sites) {
    const sitePath = resolve(site);
    const st = statSync(sitePath, { throwIfNoEntry: false });
    if (!st) {
      errors.push({ path: sitePath, message: "no such file or directory" });
      continue;
    }
    if (st.isDirectory()) {
      const files = collectSiteFiles(sitePath, []);
      if (files.length === 0) {
        errors.push({ path: sitePath, message: "no analyzable target files" });
        continue;
      }
      for (const f of files) {
        let source: string;
        try {
          source = readFileSync(f, "utf-8");
        } catch (err) {
          errors.push({ path: f, message: (err as Error).message });
          continue;
        }
        if (!shouldAnalyzeFile(f, source)) continue;
        const recs = collectCallRecords(f, source);
        if (recs.length === 0) {
          errors.push({ path: f, message: "no call sites found" });
          continue;
        }
        records.push(...recs);
      }
      continue;
    }
    let source: string;
    try {
      source = readFileSync(sitePath, "utf-8");
    } catch (err) {
      errors.push({ path: sitePath, message: (err as Error).message });
      continue;
    }
    const recs = collectCallRecords(sitePath, source);
    if (recs.length === 0) {
      errors.push({ path: sitePath, message: "no call sites found" });
      continue;
    }
    records.push(...recs);
  }
  return { records, errors };
}
