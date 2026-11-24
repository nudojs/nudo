/**
 * 入口面解析（ADR 0001 阶段 3 收口）。
 *
 * 迁移期开关（`setSemanticIndexShadow` / `setSemanticIndexEntryFace` /
 * `recordServiceEntryFace`）已删除：索引是唯一入口面，缺失的旧普查名在
 * `resolveEntryFace` 内补齐，不再保留可回退的第二档结论。
 */
import type { File } from "@babel/types";
import { buildSemanticIndex } from "./semantic-index.ts";

/**
 * `check` 名表：`SemanticIndex.entries ∪ 旧普查缺口`。
 *
 * `missing` 补齐是安全网（索引尚未覆盖的入口不得消失）；索引为空且旧面
 * 非空时 fail-closed 返回旧面。
 */
export function resolveEntryFace(file: File, oldNames: readonly string[]): string[] {
  const indexed = buildSemanticIndex(file).entries;
  if (indexed.length === 0 && oldNames.length > 0) return [...oldNames];
  const indexedSet = new Set(indexed);
  const missing = oldNames.filter((n) => !indexedSet.has(n));
  return missing.length === 0 ? [...indexed] : [...indexed, ...missing];
}
