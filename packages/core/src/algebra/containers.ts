/**
 * 容器字面量策略 —— 单一真理源。
 *
 * 数组字面量的 shape 由唯一求值引擎（B 路径 runtime：transpile 目标算子
 * $arr/$concat）经本策略产生；不存在第二条引擎需要对齐。
 *
 * 不变式（>cap 降级语义）：
 * - 元素数 ≤ cap → tuple，conf=exact（逐元素精确，map/reduce 可展开）
 * - 元素数 > cap → arr，元素 = 逐位 join，conf=widenedArrayConf()
 *   （字面量路径已知但元素被合并，不再逐位确定）
 *
 * 空数组字面量同样归本策略管辖：`$arr([])` → 0 元 tuple（exact）。
 * 策略调整只改本文件。
 */

import type { Confidence } from "./abs.ts";

/** 数组字面量保持 tuple 的最大元素数（含边界） */
export const TUPLE_LITERAL_CAP = 8;

/** 字面量 tuple 元素数上限（>cap 降为 arr） */
export function tupleLiteralCap(): number {
  return TUPLE_LITERAL_CAP;
}

/** n 元素数组字面量是否应降级为 arr（元素逐位 join） */
export function shouldWidenArrayLiteral(n: number): boolean {
  return n > TUPLE_LITERAL_CAP;
}

/**
 * tuple 物化的最大长度：new Array(n) / a[i]=v / a.length=n 超过此值就
 * 不逐槽物化（原生是稀疏数组，物化 n 个槽会 OOM——a[4294967294]=1 曾把
 * 差分 harness 打到 exit 137），就地降 arr 保 sound。
 */
export const TUPLE_MATERIALIZE_CAP = 4096;

/** 降级后的 conf：路径已知但元素合并，不再逐位确定 */
export function widenedArrayConf(): Confidence {
  return "path";
}
