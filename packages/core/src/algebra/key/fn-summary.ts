/**
 * ABS-10：函数**后置摘要**缓存（跨 PolyFn 实例复用）。
 *
 * 形态（保守起点，计划 §ABS-10 风险段）：
 * - 摘要 = 一次 body 求值的**后置 Abs** + α 变元顺序；前置键 = 函数身份
 *   （源码指纹 + 名字 + 依赖/侧车指纹）× 实例键（α-规范化实参 + Φ）。
 * - 只有**纯上下文**才进缓存：`refine` / `inject` / 自定义 budget 会改变
 *   body 语义，且闭包身份不可哈希 ⇒ 这些场景直接走 body（不进不出）。
 * - 缓存键含 `absKeyWithConf`（实例键本身来自 `instantiateMemoKey`）⇒
 *   conf 不跨级共享（ABS-05 的口径）。
 * - 与 pureMemo / checkMemo / PolyFn 分层：本缓存只存后置 Abs，不存检查
 *   报告 / 源码 / 依赖图；PolyFn 实例自己的 instMemo 仍是第一层（命中
 *   更快），本层只在**新实例**上命中。
 * - 有界：4096 条（按插入序淘汰最旧）。
 */
import type { Abs } from "../abs.ts";

export type FnSummaryEntry = { post: Abs; varOrder: string[] };

const MAX_SUMMARIES = 4096;
const store = new Map<string, FnSummaryEntry>();
let hits = 0;
let misses = 0;
let stores = 0;

/** 读摘要（命中计数用于可观测性 / 测试）。 */
export function fnSummaryGet(key: string): FnSummaryEntry | undefined {
  const hit = store.get(key);
  if (hit === undefined) {
    misses++;
    return undefined;
  }
  hits++;
  // LRU：命中移到队尾
  store.delete(key);
  store.set(key, hit);
  return hit;
}

/** 写摘要（有界：超限淘汰最旧）。 */
export function fnSummarySet(key: string, post: Abs, varOrder: string[]): void {
  stores++;
  store.delete(key);
  store.set(key, { post, varOrder });
  while (store.size > MAX_SUMMARIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function resetFnSummaryCache(): void {
  store.clear();
  hits = 0;
  misses = 0;
  stores = 0;
}

export function fnSummaryStats(): {
  size: number;
  hits: number;
  misses: number;
  stores: number;
} {
  return { size: store.size, hits, misses, stores };
}
