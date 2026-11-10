/**
 * ABS-10：函数**后置摘要**缓存（跨 PolyFn 实例复用）。
 * ABS-14 PR1：条目扩展为可承载「每个函数一份的带界摘要」—— 仍是**同一个
 * Map、同一套淘汰与失效钩子**，不新增第二个跨实例摘要缓存。
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
 *
 * PR1 边界：`formals` / `bounds` / `pre` / `eff` 全是**可选、只存不读**的
 * additive 字段；`fnSummarySet` 第 4 参可选，现有调用与默认输出逐字节不变。
 * 函数级条目用 `fn\0<scope>` 键与实例级条目共存于同一 Map，读写走独立计数，
 * `fnSummaryStats()` 的返回形状不变。
 */
import type { Abs } from "../abs.ts";
import type { Pred } from "../pred.ts";

/** ABS-14：函数级摘要的可选字段（PR1 只定义形状，PR2/PR3 才填与读）。 */
export type FnSummaryFields = {
  /** 形参占位符 id（按声明序；α–α 只允许单向依赖） */
  formals?: readonly string[];
  /** 使用条件：只用现有 Pred 词汇的简单条件 */
  bounds?: readonly Pred[];
  /** 入口条件摘要 */
  pre?: Pred;
  /** 副作用标签（可观测面，不参与判定） */
  eff?: readonly string[];
  /** ABS-14 PR3：形成摘要时实参的顶层形状签名（命中前的必要条件） */
  shapeSig?: string;
};

export type FnSummaryEntry = { post: Abs; varOrder: string[] } & FnSummaryFields;

const MAX_SUMMARIES = 4096;
const store = new Map<string, FnSummaryEntry>();
let hits = 0;
let misses = 0;
let stores = 0;
let fnLevelHits = 0;
let fnLevelMisses = 0;
let fnLevelStores = 0;

const fnLevelKey = (scope: string) => `fn\0${scope}`;

function evict(): void {
  while (store.size > MAX_SUMMARIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** 读实例级摘要（命中计数用于可观测性 / 测试）。 */
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

/** 写实例级摘要（第 4 参为 ABS-14 additive 字段，可省略）。 */
export function fnSummarySet(
  key: string,
  post: Abs,
  varOrder: string[],
  extra?: FnSummaryFields,
): void {
  stores++;
  store.delete(key);
  store.set(key, { post, varOrder, ...extra });
  evict();
}

/** ABS-14：读「每个函数一份」的带界摘要（同一 Map，独立计数）。 */
export function fnSummaryGetFnLevel(scope: string): FnSummaryEntry | undefined {
  const key = fnLevelKey(scope);
  const hit = store.get(key);
  if (hit === undefined) {
    fnLevelMisses++;
    return undefined;
  }
  fnLevelHits++;
  store.delete(key);
  store.set(key, hit);
  return hit;
}

/** ABS-14：写函数级摘要（覆盖式：每函数一份）。 */
export function fnSummarySetFnLevel(
  scope: string,
  post: Abs,
  varOrder: string[],
  extra?: FnSummaryFields,
): void {
  fnLevelStores++;
  const key = fnLevelKey(scope);
  store.delete(key);
  store.set(key, { post, varOrder, ...extra });
  evict();
}

export function resetFnSummaryCache(): void {
  store.clear();
  hits = 0;
  misses = 0;
  stores = 0;
  fnLevelHits = 0;
  fnLevelMisses = 0;
  fnLevelStores = 0;
}

export function fnSummaryStats(): {
  size: number;
  hits: number;
  misses: number;
  stores: number;
} {
  // ABS-14：size 仍是**实例级**摘要口径（函数级条目走 fnSummaryFnLevelStats），
  // 否则 ABS-10 的「α-同构共享同一条目」断言会被新条目数量带偏。
  let size = 0;
  for (const k of store.keys()) if (!k.startsWith("fn\0")) size++;
  return { size, hits, misses, stores };
}

/** ABS-14：函数级摘要的独立可观测计数（不进 `fnSummaryStats()` 口径）。 */
export function fnSummaryFnLevelStats(): {
  hits: number;
  misses: number;
  stores: number;
} {
  return { hits: fnLevelHits, misses: fnLevelMisses, stores: fnLevelStores };
}
