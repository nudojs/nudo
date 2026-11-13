/**
 * ABS-14 等价性门禁 · body 路径基线（门禁的**第一半**）。
 *
 * 口径来源：计划 §5「决策」第 3 条（2026-11-10 拍板）——
 * 「快路径 ≡ body 路径」逐字节一致是**开工前置**，先固化 body 基线，
 * 快路径同批接入同一夹具，diff 为空才允许启用任一保守通道。
 *
 * 纪律：
 * - 本模块只走 `PolyFn.instantiate` 的 body 路径：清空 generalize L0 与
 *   跨实例摘要后，在新实例上首跑；`summaryHits === 0` 是「确实跑了 body」
 *   的可观测证据。不读、不改引擎逻辑，也不引入第二条分析路径。
 * - `expectedPost` 是硬钉字符串。更新必须走独立 PR 并写明原因，
 *   **禁止**为了让快路径通过而顺手改宽 —— 那等于放松零误报门禁。
 * - 样本清单同样是门禁面：删样本会让门禁变薄，新增/删除都要显式改测试。
 */
import { abs as makeAbs, type Abs } from "../abs.ts";
import { lit, v } from "../term.ts";
import { formatAbs } from "../format/format.ts";
import { ge, pTrue, type Phi } from "../pred.ts";
import { anyVar, relationFn } from "../index.ts";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import { fnSummaryStats, resetFnSummaryCache } from "../key/fn-summary.ts";

const numVar = (id: string) => makeAbs({ k: "prim", type: "number" }, v(id), undefined, "path");
const strVar = (id: string) => makeAbs({ k: "prim", type: "string" }, v(id), undefined, "path");
const arrOf = (el: Abs) => makeAbs({ k: "arr", element: el }, undefined, undefined, "path");

export type Abs14BaselineCase = {
  id: string;
  fnName: string;
  source: string;
  /** 每次调用都新建 Abs，避免样本之间共享可变对象 */
  args: () => Abs[];
  /** body 路径 `formatAbs(post)` 的硬钉值 */
  expectedPost: string;
  covers: string;
};

export const ABS14_BASELINE_CASES: readonly Abs14BaselineCase[] = [
  {
    id: "arithmetic-return",
    fnName: "add",
    source: "export function add(x) { return x + 1; }",
    args: () => [numVar("q")],
    expectedPost: "number  = (q + 1)  #path",
    covers: "数值关系 term（简单条件候选）",
  },
  {
    id: "identity-alpha",
    fnName: "id",
    source: "export function id(x) { return x; }",
    args: () => [numVar("q")],
    expectedPost: "number  = q  #path",
    covers: "α 同构 / 变元名恢复",
  },
  {
    id: "array-element",
    fnName: "first",
    source: "export function first(xs) { return xs[0]; }",
    args: () => [arrOf(numVar("q"))],
    expectedPost: "number  = q  #path",
    covers: "数组元素域",
  },
  {
    id: "hof-map-beta",
    fnName: "processItems",
    source: "export function processItems(items, transform) { return items.map(transform); }",
    args: () => [arrOf(anyVar("A1")), relationFn([anyVar("A1")], anyVar("B1"))],
    expectedPost: "arr(B1)  #path",
    covers: "HOF β 链接（返回域带占位符）",
  },
  {
    id: "hof-map-number-to-string",
    fnName: "stringifyAll",
    source: "export function stringifyAll(items, f) { return items.map(f); }",
    args: () => [arrOf(numVar("q")), relationFn([numVar("q")], strVar("B1"))],
    expectedPost: "string[]  #path",
    covers: "回调返回域传播",
  },
  {
    id: "recursive-budget",
    fnName: "fact",
    source: "export function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }",
    args: () => [numVar("n")],
    expectedPost: "unknown  #opaque",
    covers: "预算截断 fail-closed（结果不写摘要）",
  },
  {
    id: "string-concat",
    fnName: "greet",
    source: 'export function greet(name) { return "hi " + name; }',
    args: () => [strVar("s")],
    expectedPost: "string  #path",
    covers: "原语返回 / 字符串拼接",
  },
];

export type BodyPathRun = {
  post: Abs;
  printed: string;
  /** 运行期间摘要层命中数；body 路径必须为 0 */
  summaryHits: number;
  /** 运行期间写入的摘要条数；预算截断 / unknown 允许为 0 */
  summaryStores: number;
};

/**
 * 门禁**见证 Φ**：与样本语义无关，但其 `predKey` 与形成摘要时用的 `pTrue`
 * 不同 ⇒ 第 2 层实例摘要（键含 Φ）必 miss，`diffAgainstBodyBaseline` 才会
 * 真正落到第 3 层函数级摘要上。
 *
 * 背景（2026-11-13 复审）：此前的门禁用同一份实参 + 同一 Φ 跑两遍，第二遍
 * 命中第 1 层 instMemo / 第 2 层 ABS-10 实例摘要，函数级快路径 `applied`
 * 恒为 0 —— 门禁测的是 memo 回读，不是被测特性。
 */
export const ABS14_GATE_PHI: Phi = ge(v("__abs14_gate"), lit(0));

/** 在干净缓存栈上跑一次 body 路径，返回可逐字节比较的显示串。 */
export function runBodyPath(c: Abs14BaselineCase, phi: Phi = pTrue): BodyPathRun {
  resetGeneralizeMemo();
  resetFnSummaryCache();
  const g = generalizeFromAst(c.fnName, c.source);
  if (!g) throw new Error(`[abs14 baseline] generalizeFromAst returned undefined: ${c.id}`);
  const post = g.instantiate(c.args(), phi);
  const stats = fnSummaryStats();
  return {
    post,
    printed: formatAbs(post),
    summaryHits: stats.hits,
    summaryStores: stats.stores,
  };
}

export type EquivalenceDiff = {
  id: string;
  body: string;
  fast: string;
  equal: boolean;
};

/**
 * 快路径落地时接入同一个夹具：`diffAgainstBodyBaseline(fastPathPost)`，
 * 逐条 `equal === true` 才允许启用三条保守通道。
 *
 * 2026-11-13 修订（门禁真正覆盖被测特性）：
 * - **body 侧**在同一条目上用 `ABS14_GATE_PHI` 跑（pinned body 用 `pTrue`
 *   单独跑一次保持既有硬钉）；
 * - **fast 侧**回调收到同一个见证 Φ，必须自行绕开第 1/2 层（新 PolyFn 实例 +
 *   与形成时不同的 Φ），否则测到的是 memo 回读；
 * - `equal` 同时钉住三件事：fast(见证 Φ) ≡ body(见证 Φ)、body(pTrue) ≡
 *   基线硬钉值、body(pTrue) 的摘要命中为 0（防止引擎或基线悄悄漂移）。
 */
export function diffAgainstBodyBaseline(
  fastPathPost: (c: Abs14BaselineCase, phi: Phi) => Abs,
): EquivalenceDiff[] {
  return ABS14_BASELINE_CASES.map((c) => {
    const pinned = runBodyPath(c);
    const body = runBodyPath(c, ABS14_GATE_PHI);
    const fast = formatAbs(fastPathPost(c, ABS14_GATE_PHI));
    return {
      id: c.id,
      body: body.printed,
      fast,
      equal:
        body.printed === fast &&
        pinned.printed === c.expectedPost &&
        pinned.summaryHits === 0,
    };
  });
}
