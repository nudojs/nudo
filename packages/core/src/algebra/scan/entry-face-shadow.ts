/**
 * 入口面影子双读 / 可切换普查面（ADR 0001 阶段 1 · 切片 1 + 切片 2）。
 *
 * 两层开关（阶段 1 切片 3 起 `entryFaceEnabled` **默认开启**）：
 * - `shadowEnabled`（切片 1）：记录旧扫描面与 `SemanticIndex.entries` 的分歧，
 *   也是 service 侧只读快照的唯一开关；默认关闭 ⇒ service 每次分析不建索引。
 * - `entryFaceEnabled`（切片 2 引入、切片 3 默认开启）：`check` 的 `names` 由
 *   `SemanticIndex.entries` 解析；`false` 即回退旧面（§7 的开关式 fallback）。
 *   切换口径是 `entries ∪ 旧面缺口`（不丢任何旧入口），索引为空时
 *   fail-closed 回退旧面。
 *
 * 纪律：
 * - `resolveEntryFace` 在 `entryFaceEnabled === false` 时直接返回同一个数组
 *   引用（零分配、不建索引）；service 侧 `semanticIndexShadowActive()` 关闭时
 *   同样只做一次布尔判断 ⇒ 默认路径不因只读对照多一次 AST 遍历。
 * - **不设白名单**：分歧一律如实记录（§10 决议 4）。
 * - 索引面状态经 `semanticIndexEntryFaceSegment()` 进入 check memo 与 service
 *   文件级 / 函数级缓存键 ⇒ 开关翻转不会回放另一档结论（§7 键纪律）。
 * - 本模块不参与求值；Abs 仍是唯一类型表示（kernel-merge.md「绑定索引层」）。
 */
import type { File } from "@babel/types";
import { buildSemanticIndex } from "./semantic-index.ts";

export interface EntryFaceDiff {
  /** 索引登记了、旧扫描面没有的入口。 */
  readonly added: readonly string[];
  /** 旧扫描面有、索引没登记的入口（索引缺口，需阶段 1 后续补齐）。 */
  readonly missing: readonly string[];
}

function diffOf(indexed: readonly string[], oldNames: readonly string[]): EntryFaceDiff {
  const oldSet = new Set(oldNames);
  const indexedSet = new Set(indexed);
  return {
    added: indexed.filter((n) => !oldSet.has(n)),
    missing: oldNames.filter((n) => !indexedSet.has(n)),
  };
}

export function compareEntryFaces(file: File, oldNames: readonly string[]): EntryFaceDiff {
  return diffOf(buildSemanticIndex(file).entries, oldNames);
}

let shadowEnabled = false;
let entryFaceEnabled = true;
let lastDiff: EntryFaceDiff | undefined;

/** 切片 1 开关；`false` 时清空已记录的分歧。 */
export function setSemanticIndexShadow(on: boolean): void {
  shadowEnabled = on;
  if (!on) lastDiff = undefined;
}

/** 切片 2 开关 / 切片 3 的 fallback：`false` 回退旧面，默认 `true`。 */
export function setSemanticIndexEntryFace(on: boolean): void {
  entryFaceEnabled = on;
}

/** service 侧只读快照开关：只看 `shadowEnabled`，不含 entryFace。 */
export function semanticIndexShadowActive(): boolean {
  return shadowEnabled;
}

/** 缓存键维度：索引面 / 旧面两档结论互不回放（`checkMemoKey` / service 键）。 */
export function semanticIndexEntryFaceSegment(): "idx1" | "idx0" {
  return entryFaceEnabled ? "idx1" : "idx0";
}

/** 消费式读取（取后清空），便于一次分析一次断言。 */
export function takeSemanticIndexShadow(): EntryFaceDiff | undefined {
  const diff = lastDiff;
  lastDiff = undefined;
  return diff;
}

/** `check` 名表拼装处的接线点之一：旧面为准时只记录分歧，不改写 names。 */
export function recordSemanticIndexShadow(file: File, oldNames: readonly string[]): void {
  if (!shadowEnabled) return;
  lastDiff = diffOf(buildSemanticIndex(file).entries, oldNames);
}

/**
 * `check` 名表拼装处的接线点之二：切片 2 的可切换普查面。
 *
 * - 关闭（fallback）：原样返回 `oldNames`（同一引用，零开销）。
 * - 开启（默认）：返回 `entries ∪ missing`，并如实记录分歧；索引为空时回退旧面。
 *   `missing` 补齐是迁移期安全网：阶段 3 删旧前，切换不得让任何旧入口消失。
 */
export function resolveEntryFace(file: File, oldNames: string[]): string[] {
  if (!entryFaceEnabled) return oldNames;
  const indexed = buildSemanticIndex(file).entries;
  const diff = diffOf(indexed, oldNames);
  if (indexed.length === 0 && oldNames.length > 0) return oldNames;
  return diff.missing.length === 0
    ? [...indexed]
    : [...indexed, ...diff.missing];
}
