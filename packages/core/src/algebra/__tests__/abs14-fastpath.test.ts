/**
 * ABS-14 PR3：函数级带界摘要快路径的等价性与 fail-closed 行为。
 *
 * 门禁口径（2026-11-13 修订）：
 * - **等价门禁真的落到第 3 层**：`fastPathPost` 用新 PolyFn 实例 + 与形成时
 *   不同的见证 Φ（`ABS14_GATE_PHI`）⇒ 第 1 层 instMemo / 第 2 层实例摘要必
 *   miss，`applied` 必须增长；此前同实参同 Φ 跑两遍只测到 memo 回读。
 * - 对抗样本逐条钉住三类已修复缺陷：实参按位置对齐（不置换）、形成时完整 Φ
 *   必须被当前 Φ 蕴含（不被 app term 合取支绕过）、实参必须同构（同 kind
 *   异形不复用）。
 * - 任一条件不满足必须回退 body，不得静默放宽。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { abs as makeAbs, type Abs } from "../abs.ts";
import { app, lit, v } from "../term.ts";
import { and, eq, ge, pTrue, type Phi } from "../pred.ts";
import { formatAbs } from "../format/format.ts";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import {
  fnSummaryFnLevelStats,
  resetFnSummaryCache,
  type FnSummaryEntry,
} from "../key/fn-summary.ts";
import {
  ABS14_DEFAULT_CHANNELS,
  fnLevelFields,
  setAbs14FastPathChannels,
  tryFnLevelFastPath,
} from "../key/summary-fastpath.ts";
import {
  ABS14_BASELINE_CASES,
  ABS14_GATE_PHI,
  diffAgainstBodyBaseline,
  type Abs14BaselineCase,
} from "./abs14-equivalence-baseline.ts";

const numVar = (id: string, pred?: Phi): Abs =>
  makeAbs({ k: "prim", type: "number" }, v(id), pred, "path");
const strVar = (id: string): Abs =>
  makeAbs({ k: "prim", type: "string" }, v(id), undefined, "path");
const numLit = (n: number): Abs =>
  makeAbs({ k: "prim", type: "number" }, lit(n), undefined, "exact");
const strLit = (s: string): Abs =>
  makeAbs({ k: "prim", type: "string" }, lit(s), undefined, "exact");

function objVar(id: string, slots: Record<string, Abs>): Abs {
  const table: Record<string, { value: Abs }> = {};
  for (const [k, a] of Object.entries(slots)) table[k] = { value: a };
  return makeAbs({ k: "obj", slots: table, open: false }, v(id), undefined, "path");
}

function tupleVar(id: string, elements: Abs[]): Abs {
  return makeAbs({ k: "tuple", elements }, v(id), undefined, "path");
}

function mustGeneralize(name: string, src: string, label?: string) {
  const g = generalizeFromAst(name, src, label === undefined ? undefined : { label });
  if (!g) throw new Error(`generalizeFromAst returned undefined: ${name}`);
  return g;
}

/** 干净栈上的一次真 body 运行（清 L0 + 摘要 + instMemo）。 */
function bodyPost(name: string, src: string, args: () => Abs[], phi: Phi): string {
  resetGeneralizeMemo();
  resetFnSummaryCache();
  return formatAbs(mustGeneralize(name, src, "clean").instantiate(args(), phi));
}

/**
 * 等价门禁的快路径侧：**清空缓存栈**后先形成函数级摘要，再换新实例 + 见证 Φ
 * 让第 1/2 层必 miss，第 3 层命中（`applied` 必须在用例里核实）。
 *
 * 不能沿用 body 侧留下的缓存：body(见证 Φ) 会把同一实例键写进第 2 层，
 * 第 3 层就永远不会被问到（这正是 2026-11-13 复审发现的门禁空转）。
 */
function fastPathPost(c: Abs14BaselineCase, phi: Phi): Abs {
  resetGeneralizeMemo(); // L0 + instMemo + 摘要一起清
  const g0 = mustGeneralize(c.fnName, c.source);
  g0.instantiate(c.args());
  const g1 = mustGeneralize(c.fnName, c.source, "fast");
  return g1.instantiate(c.args(), phi);
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
  setAbs14FastPathChannels(ABS14_DEFAULT_CHANNELS);
});

describe("ABS-14 PR3 快路径 ≡ body 路径", () => {
  it("等价门禁：7 个基线样本逐条 equal", () => {
    const diffs = diffAgainstBodyBaseline(fastPathPost);
    expect(diffs.filter((d) => !d.equal)).toEqual([]);
  });

  it("门禁真的落到第 3 层：全变量实参样本必须被采纳", () => {
    // 逐次测量：`runBodyPath` 会 reset 计数器，跨整轮取 delta 会被清掉
    let applied = 0;
    const diffs = diffAgainstBodyBaseline((c, phi) => {
      const before = fnSummaryFnLevelStats().applied;
      const post = fastPathPost(c, phi);
      applied += fnSummaryFnLevelStats().applied - before;
      return post;
    });
    expect(diffs.filter((d) => !d.equal)).toEqual([]);
    // arithmetic-return / identity-alpha / string-concat 三个样本的实参全是
    // 顶层 var（recursive-budget 不写摘要；其余样本实参不是 var ⇒ fail-closed）
    expect(applied).toBeGreaterThanOrEqual(3);
  });

  it("端到端：实例摘要 miss 时第三层命中，结果逐字节等于 body", () => {
    const src = "export function add(x) { return x + 1; }";
    const g0 = mustGeneralize("add", src);
    g0.instantiate([numVar("q")]);
    const before = fnSummaryFnLevelStats();

    // 不同变元名 + 不同 Φ ⇒ 实例键不同，但实参同构、完整前置(pTrue)可被蕴含
    const phi2: Phi = { op: "typeof", t: v("p"), type: "number" };
    const g1 = mustGeneralize("add", src, "other");
    const fast = formatAbs(g1.instantiate([numVar("p")], phi2));
    const after = fnSummaryFnLevelStats();

    expect(after.applied - before.applied).toBe(1);

    resetGeneralizeMemo(); // 连摘要一起清 ⇒ 真 body
    const body = formatAbs(mustGeneralize("add", src).instantiate([numVar("p")], phi2));

    expect(fast).toBe(body);
  });

  it("关闭跨模块通道后仍逐字节等价（主路径不变）", () => {
    setAbs14FastPathChannels({ crossModule: false });
    let applied = 0;
    const diffs = diffAgainstBodyBaseline((c, phi) => {
      const before = fnSummaryFnLevelStats().applied;
      const post = fastPathPost(c, phi);
      applied += fnSummaryFnLevelStats().applied - before;
      return post;
    });
    expect(applied).toBe(0);
    expect(diffs.filter((d) => !d.equal)).toEqual([]);
  });

  it("基线样本清单未被本批悄悄缩减", () => {
    expect(ABS14_BASELINE_CASES.length).toBe(7);
  });
});

describe("ABS-14 命中门禁（构造条目逐条钉）", () => {
  const args = () => [numVar("q")];
  const baseEntry = (overrides: Partial<FnSummaryEntry> = {}): FnSummaryEntry => ({
    post: numVar("q"),
    varOrder: ["q"],
    ...fnLevelFields(args(), pTrue, ["q"]),
    ...overrides,
  });

  it("完整前置不被当前 Φ 蕴含 ⇒ 回退（不查简单界就放行）", () => {
    const entry = baseEntry({
      pre: ge(v("q"), lit(0)),
      bounds: [ge(v("q"), lit(0))],
    });
    expect(tryFnLevelFastPath(entry, args(), pTrue)).toEqual({ miss: "pre" });
    expect(
      "post" in tryFnLevelFastPath(entry, args(), and(pTrue, ge(v("q"), lit(0)))),
    ).toBe(true);
  });

  it("缺完整前置 / 缺实参同构键 ⇒ fail-closed（不猜）", () => {
    const noPre = baseEntry({ pre: undefined });
    expect(tryFnLevelFastPath(noPre, args(), pTrue)).toEqual({ miss: "no-pre" });
    const noKeys = baseEntry({ argKeys: undefined });
    expect(tryFnLevelFastPath(noKeys, args(), pTrue)).toEqual({ miss: "no-arg-keys" });
    const noFormals = baseEntry({ formals: undefined });
    expect(tryFnLevelFastPath(noFormals, args(), pTrue)).toEqual({ miss: "no-formals" });
  });

  it("实参不同构 ⇒ 回退（同 kind 异形不得复用）", () => {
    const entry = baseEntry(); // 形成时 arg = prim:number
    expect(tryFnLevelFastPath(entry, [strVar("q")], pTrue)).toEqual({ miss: "args" });
    expect("post" in tryFnLevelFastPath(entry, args(), pTrue)).toBe(true);
  });

  it("formals 无法映射 ⇒ 回退", () => {
    const entry = baseEntry();
    const noVarTerm = makeAbs({ k: "prim", type: "number" }, undefined, undefined, "path");
    expect(tryFnLevelFastPath(entry, [noVarTerm], pTrue)).toEqual({ miss: "unmapped" });
  });

  it("formal 数不符 ⇒ 回退", () => {
    const entry = baseEntry({ formals: ["q", "r"], argKeys: ["a", "b"] });
    expect(tryFnLevelFastPath(entry, args(), pTrue)).toEqual({ miss: "formal-arity" });
  });

  it("post 自由变元超出 formals ⇒ 回退（不泄漏形成期的其它变元）", () => {
    const entry = baseEntry({ post: numVar("z") });
    expect(tryFnLevelFastPath(entry, args(), pTrue)).toEqual({ miss: "free-var" });
  });

  it("零实参函数：常量摘要可命中，但 post 有自由变元 ⇒ 回退", () => {
    const constant: FnSummaryEntry = {
      post: makeAbs({ k: "prim", type: "number" }, lit(1), undefined, "exact"),
      varOrder: [],
      formals: [],
      argKeys: [],
      pre: pTrue,
    };
    expect("post" in tryFnLevelFastPath(constant, [], pTrue)).toBe(true);
    expect(tryFnLevelFastPath({ ...constant, post: numVar("z") }, [], pTrue)).toEqual({
      miss: "free-var",
    });
  });
});

describe("ABS-14 回归：三类已修复缺陷（2026-11-13）", () => {
  it("实参按**位置**对齐：形成 f(z, y) 后 f(p, q) 不置换实参", () => {
    const src = "export function sub(a, b) { return a - b; }";
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const g = mustGeneralize("sub", src);
    // 实参名升序 ≠ 位置序：old 实现把 formals 存成字典序 [y,z]，按位置配对即置换
    g.instantiate([numVar("z"), numVar("y")]);

    const before = fnSummaryFnLevelStats().applied;
    const fast = formatAbs(g.instantiate([numVar("p"), numVar("q")]));
    expect(fnSummaryFnLevelStats().applied - before).toBe(1);

    expect(fast).toBe(bodyPost("sub", src, () => [numVar("p"), numVar("q")], pTrue));
    expect(fast).toBe("number  = (p - q)  #path");
  });

  it("形成时 Φ 的 app term 合取支不会被丢掉：弱 Φ 下回退 body", () => {
    const src =
      "export function branch(x) { if (x % 2 === 0) return 'even'; return 'odd'; }";
    const even: Phi = eq(app("%", [v("A1"), lit(2)]), lit(0));
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const g = mustGeneralize("branch", src);
    expect(formatAbs(g.instantiate([numVar("A1", even)], even))).toBe('"even"  #exact');

    const before = fnSummaryFnLevelStats().applied;
    const weak = g.instantiate([numVar("A1")], pTrue); // 不蕴含 x%2==0
    expect(fnSummaryFnLevelStats().applied - before).toBe(0);

    expect(formatAbs(weak)).toBe(bodyPost("branch", src, () => [numVar("A1")], pTrue));
    expect(formatAbs(weak)).toBe('"even" | "odd"  #exact');
  });

  it("同 kind 异形不复用：obj 槽集 / 元组长度不同 ⇒ 回退 body", () => {
    resetGeneralizeMemo();
    resetFnSummaryCache();
    const g = mustGeneralize("getX", "export function getX(o) { return o.x; }");
    g.instantiate([objVar("A1", { x: numLit(1) })]);

    const before = fnSummaryFnLevelStats().applied;
    const fast = formatAbs(g.instantiate([objVar("B1", { y: strLit("s") })]));
    expect(fnSummaryFnLevelStats().applied - before).toBe(0);
    expect(fast).toBe(
      bodyPost(
        "getX",
        "export function getX(o) { return o.x; }",
        () => [objVar("B1", { y: strLit("s") })],
        pTrue,
      ),
    );

    resetGeneralizeMemo();
    resetFnSummaryCache();
    const g3 = mustGeneralize("third", "export function third(xs) { return xs[2]; }");
    g3.instantiate([tupleVar("A1", [numLit(1), numLit(2)])]);
    const before3 = fnSummaryFnLevelStats().applied;
    const fast3 = formatAbs(
      g3.instantiate([tupleVar("B1", [numLit(1), numLit(2), numLit(3)])]),
    );
    expect(fnSummaryFnLevelStats().applied - before3).toBe(0);
    expect(fast3).toBe(
      bodyPost(
        "third",
        "export function third(xs) { return xs[2]; }",
        () => [tupleVar("B1", [numLit(1), numLit(2), numLit(3)])],
        pTrue,
      ),
    );
  });

  it("见证 Φ 本身不改变结果（门禁基线有效性前提）", () => {
    const diffs = diffAgainstBodyBaseline((c, phi) => fastPathPost(c, phi));
    expect(diffs.every((d) => d.body === d.fast)).toBe(true);
  });
});
