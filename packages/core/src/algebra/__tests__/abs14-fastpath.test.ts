/**
 * ABS-14 PR3：函数级带界摘要快路径的等价性与 fail-closed 行为。
 *
 * 门禁口径：快路径 ≡ body 路径逐字节一致；任一条件不满足必须回退 body，
 * 不得静默放宽。另两条通道（body 不可用 / 预算截断）默认关闭，因为它们会
 * 把 fail-closed 的 unknown 换掉，需独立验证后才允许开启。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { abs as makeAbs } from "../abs.ts";
import { app, lit, v } from "../term.ts";
import { formatAbs } from "../format/format.ts";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import {
  fnSummaryFnLevelStats,
  resetFnSummaryCache,
  type FnSummaryEntry,
} from "../key/fn-summary.ts";
import {
  getAbs14FastPathChannels,
  setAbs14FastPathChannels,
  tryFnLevelFastPath,
} from "../key/summary-fastpath.ts";
import { pTrue, type Pred } from "../pred.ts";
import {
  ABS14_BASELINE_CASES,
  diffAgainstBodyBaseline,
  type Abs14BaselineCase,
} from "./abs14-equivalence-baseline.ts";

const numVar = (id: string) =>
  makeAbs({ k: "prim", type: "number" }, v(id), undefined, "path");

function mustGeneralize(name: string, src: string, label?: string) {
  const g = generalizeFromAst(name, src, label === undefined ? undefined : { label });
  if (!g) throw new Error(`generalizeFromAst returned undefined: ${name}`);
  return g;
}

/** 先跑一次形成函数级摘要，再在新 PolyFn 实例上调用（跨模块复用通道）。 */
function fastPathPost(c: Abs14BaselineCase) {
  const g0 = mustGeneralize(c.fnName, c.source);
  g0.instantiate(c.args());
  const g1 = mustGeneralize(c.fnName, c.source, "fast");
  return g1.instantiate(c.args());
}

beforeEach(() => {
  resetGeneralizeMemo();
  resetFnSummaryCache();
  setAbs14FastPathChannels({
    crossModule: true,
    bodyUnavailable: false,
    budgetTruncated: false,
  });
});

afterEach(() => {
  setAbs14FastPathChannels({
    crossModule: true,
    bodyUnavailable: false,
    budgetTruncated: false,
  });
});

describe("ABS-14 PR3 快路径 ≡ body 路径", () => {
  it("等价门禁：7 个基线样本逐条 equal", () => {
    const diffs = diffAgainstBodyBaseline(fastPathPost);
    expect(diffs.filter((d) => !d.equal)).toEqual([]);
  });

  it("端到端：实例摘要 miss 时第三层命中，结果逐字节等于 body", () => {
    const src = "export function add(x) { return x + 1; }";
    const g0 = mustGeneralize("add", src);
    g0.instantiate([numVar("q")]);
    const before = fnSummaryFnLevelStats().hits;

    // 不同变元名 + 不同 Φ ⇒ 实例键不同，但形状签名与 formals 可映射
    const phi2: Pred = { op: "typeof", t: v("p"), type: "number" };
    const g1 = mustGeneralize("add", src, "other");
    const fast = formatAbs(g1.instantiate([numVar("p")], phi2));
    const after = fnSummaryFnLevelStats().hits;

    resetGeneralizeMemo();
    const g2 = mustGeneralize("add", src);
    const body = formatAbs(g2.instantiate([numVar("p")], phi2));

    expect(fast).toBe(body);
    expect(after).toBeGreaterThan(before);
  });

  it("界不成立 ⇒ 回退（不静默放宽）", () => {
    const entry: FnSummaryEntry = {
      post: makeAbs(
        { k: "prim", type: "number" },
        app("+", [v("q"), lit(1)]),
        undefined,
        "path",
      ),
      varOrder: ["q"],
      formals: ["q"],
      bounds: [{ op: "gt", a: v("q"), b: lit(0) }],
      shapeSig: "prim:number",
    };
    expect(tryFnLevelFastPath(entry, [numVar("q")], pTrue, ["q"])).toEqual({
      miss: "bounds",
    });
  });

  it("formals 无法映射 ⇒ 回退", () => {
    const entry: FnSummaryEntry = {
      post: numVar("q"),
      varOrder: ["q"],
      formals: ["q"],
      shapeSig: "prim:number",
    };
    const noVarTerm = makeAbs(
      { k: "prim", type: "number" },
      undefined,
      undefined,
      "path",
    );
    expect(tryFnLevelFastPath(entry, [noVarTerm], pTrue, ["q"])).toEqual({
      miss: "unmapped",
    });
  });

  it("形状签名不同 ⇒ 回退", () => {
    const entry: FnSummaryEntry = {
      post: numVar("q"),
      varOrder: ["q"],
      formals: ["q"],
      shapeSig: "arr",
    };
    expect(tryFnLevelFastPath(entry, [numVar("q")], pTrue, ["q"])).toEqual({
      miss: "shape",
    });
  });

  it("默认只启用跨模块复用通道", () => {
    expect(getAbs14FastPathChannels()).toEqual({
      crossModule: true,
      bodyUnavailable: false,
      budgetTruncated: false,
    });
  });

  it("关闭跨模块通道后仍逐字节等价（主路径不变）", () => {
    setAbs14FastPathChannels({ crossModule: false });
    const diffs = diffAgainstBodyBaseline(fastPathPost);
    expect(diffs.filter((d) => !d.equal)).toEqual([]);
  });

  it("基线样本清单未被本批悄悄缩减", () => {
    expect(ABS14_BASELINE_CASES.length).toBe(7);
  });
});
