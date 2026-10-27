/**
 * 整文件 CheckReport memo（LSP/CI 重复 check → O(1)）。
 *
 * 从 check.ts 拆出的缓存基建：键指纹 / 依赖索引 / 定向逐出 / LRU。
 * check.ts 通过 re-export 保持 resetCheckSourceMemo /
 * evictCheckSourceMemoForPaths 对外形状不变。
 */

import type { CheckReport } from "./check-report.ts";
import type { Abs } from "./abs.ts";
import type { AbsCallRecord } from "./ast-records.ts";
import { formatAbs } from "./format.ts";
import { hashSource, resetHashSourceCache } from "./hash-source.ts";
import { resetSidecarLoadFailureCache } from "./interface.ts";
import {
  stablePathKey,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { runTranspiledOptionsMemoKey } from "./exec/run.ts";
import type { CheckOptions } from "./check-types.ts";
import { DependencyMemo } from "./memo-store.ts";
import { loadModuleId, moduleMapId } from "./memo-identity.ts";

export const MAX_CHECK_MEMO = 256;
const checkReportMemo = new DependencyMemo<CheckReport>(MAX_CHECK_MEMO);

export function resetCheckSourceMemo(): void {
  checkReportMemo.reset();
  resetHashSourceCache();
  // 侧车加载失败去重表（#64）与 check memo 同生命周期：测试/会话清空时一并丢弃，
  // 否则同一侧车失败在后续分析里被吞掉。
  resetSidecarLoadFailureCache();
}

/**
 * ⚠ `checkDepsFingerprint` 已删除（Bug 1139 修复线引入的副作用）：
 * 指纹的 **ambient 侧车探测**必须与「分析读」区分（`autoBind:false` 下
 * 不可读的 ambient 侧车**不得**让门禁变红）⇒ 探测要走**未经降级闸**的
 * 推测性 loader，并受 `sidecarAutoBindAllowed` 约束 ⇒ 调用点必须直接调
 * `loadModuleDepsFingerprint`（带上 ambient 选项）⇒ 本包装器（无法传
 * ambient 选项）失去唯一用途 ⇒ 删。
 *
 * `loadModuleDepsFingerprint` 见 `load-deps-fp.ts`。
 */

/** `*.nudo.js` 变更后定向逐出依赖它的整文件 check 缓存。查找与索引同走 stablePathKey */
export function evictCheckSourceMemoForPaths(paths: string[]): number {
  return checkReportMemo.evictForPaths(paths);
}

export function cloneCheckReport(r: CheckReport): CheckReport {
  return {
    file: r.file,
    issues: r.issues.map((i) => ({ ...i })),
    ok: r.ok,
    signatures: r.signatures.map((s) => ({
      ...s,
      params: [...s.params],
      ...(s.paramTypes ? { paramTypes: [...s.paramTypes] } : {}),
    })),
    summary: { ...r.summary },
    ...(r.budget ? { budget: { ...r.budget } } : {}),
  };
}

export function checkMemoKey(
  filePath: string,
  source: string,
  identityOpts: CheckOptions,
  deps: LoadDepsFingerprint,
  sidecarFp?: string,
): string {
  // identity must stay the caller's raw loadModule or every checkSource
  // allocates a new loadModuleId and memo never hits.
  // autoBind 必须进键：执法档翻转后不得回放另一档报告（disk 键已含）。
  return [
    hashSource(source),
    // filePath 过 stablePathKey 归一（与依赖索引/逐出同口径）：同一文件的
    // 裸路径与 file:// URL 两种形态不得各占一条 memo 条目（命中率损耗）。
    stablePathKey(filePath),
    `${loadModuleId(identityOpts.loadModule)}:${identityOpts.fromFile ?? ""}`,
    deps.fp,
    sidecarFp ?? "-",
    identityOpts.autoBind === false ? "ab0" : "ab1",
    identityOpts.projectDir ?? "-",
    identityOpts.entryThrows ?? "error",
    (identityOpts.ignoreThrows ?? []).join(",") || "-",
    moduleMapId(identityOpts.modules),
    // inject 用内容指纹（CLI 每次新建同内容对象时身份键会 miss）
    runTranspiledOptionsMemoKey(identityOpts.inject),
    // skips 必须进键：同 source 不同 skip 表（host 解析差异 / 测试注入）
    // 不得回放另一档报告。
    skipsKey(identityOpts.skips),
    // Bug 366：`from`（--from 的跨文件调用点证据）必须进键——同 source 不同
    // 证据不得互为陈旧命中：无证据那档会把有证据的 drift 吞掉，有证据那档
    // 会把 drift 回放进无证据的检查（假阳）。
    fromKey(identityOpts.from),
  ].join("|");
}

/** skip 表稳定键：名字 + 声明返回（null = 未声明）；排序保证与插入序无关 */
function skipsKey(skips: ReadonlyMap<string, Abs | null> | undefined): string {
  if (!skips || skips.size === 0) return "-";
  return [...skips.entries()]
    .map(([name, abs]) => `${name}:${abs ? formatAbs(abs) : "-"}`)
    .sort()
    .join(",");
}

/**
 * `from` 证据稳定键（Bug 366）：被调名 + 实参域 + 结果域。
 * 排序保证与插入序无关；内容指纹保证同内容的新数组不再 miss 键。
 */
function fromKey(from: readonly AbsCallRecord[] | undefined): string {
  if (!from || from.length === 0) return "-";
  return from
    .map(
      (r) =>
        `${r.fnName}:${r.args.map((a) => formatAbs(a)).join(",")}:${formatAbs(r.result)}`,
    )
    .sort()
    .join(";");
}

export function checkMemoGet(key: string): CheckReport | null {
  const hit = checkReportMemo.lookup(key);
  return hit.hit ? hit.value : null;
}

export function checkMemoSet(key: string, value: CheckReport, depPaths: string[]): void {
  checkReportMemo.set(key, value, depPaths);
}
