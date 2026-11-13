/**
 * ABS-14 遗留缺陷（2026-11-11）修复的**集成验证**：
 * `TypeParam.bounds` 此前恒空，因为 `entryReqs[].pred` 用实参名（`x`），
 * 而 `collectSimpleBounds` 拿 α 名（`A1`）校验 ⇒ 每个 var 都判 unbound。
 *
 * 本夹具钉住：
 * - 带契约时 `bounds` 真的填上，且落在 **α 空间**（与 `TypeParam.id` 同域）；
 * - 多形参界各归其位；无契约不发明界；
 * - `entryReqs` / `display` 保持实参名空间原貌（零行为变化）；
 * - 简单条件 + 单向依赖校验在重锚后仍生效（反向 / binder / app 一律丢）；
 * - 界是良构元数据：`implies` 可直接判定，作为条目 `pre` 时门槛行为正确。
 *   **当前无产品消费方**（write-only）——快路径的门槛是形成时的完整 Φ。
 *
 * 设计边界（不在此打通，也不该打通）：`opts.refine` 会让 `summaryScope`
 * 返回 undefined（ABS-10：refine 改变 body 语义且闭包身份不可哈希），所以
 * 带契约的函数不写函数级摘要 —— 入口契约界是 `PolyFn` 的一等元数据，
 * 快路径的界另来自调用点 `phi`（`fnLevelFields`）。两者不同源、不合并。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import { abs as makeAbs, type Abs } from "../abs.ts";
import { app, lit, v } from "../term.ts";
import {
  implies,
  pTrue,
  predToString,
  type Phi,
  type Pred,
} from "../pred.ts";
import { alignSimpleBounds } from "../key/summary-bounds.ts";
import { resetFnSummaryCache, type FnSummaryEntry } from "../key/fn-summary.ts";
import { fnLevelFields, tryFnLevelFastPath } from "../key/summary-fastpath.ts";

// ---------------------------------------------------------------------------
// 契约构造（沿用 generalize.test.ts / core-bug-082 的既有写法）
// ---------------------------------------------------------------------------

const CONTRACT_SRC = `
/// @nudo:import { positive } from "./x.nudo.js"
/**
 * @nudo:contract x positive
 */
function scale(x) { return x + 1; }
`;
const contractLoadModule = () => `export const positive = number().gt(0);`;

const MULTI_SRC = `export function f(x, y) { return x + y; }\n`;
const MULTI_SIDECAR =
  `export const f = fn({ x: number().gt(0), y: number().gt(1) }, number());\n`;

const contractFn = () =>
  generalizeFromAst("scale", CONTRACT_SRC, {
    refine: { loadModule: contractLoadModule, fromFile: "/t/a.js" },
  });

const multiFn = () =>
  generalizeFromAst("f", MULTI_SRC, {
    refine: { loadModule: () => MULTI_SIDECAR, fromFile: "/t/f.js" },
  });

const noContractFn = () =>
  generalizeFromAst("bare", "export function bare(x) { return x + 1; }\n");

beforeEach(() => {
  resetGeneralizeMemo();
  resetFnSummaryCache();
});

// ---------------------------------------------------------------------------
// 端到端：bounds 真的从入口契约落到 α 空间
// ---------------------------------------------------------------------------

describe("ABS-14 TypeParam.bounds 端到端（变量空间对齐）", () => {
  it("带契约：bounds 非空且落在 α 空间（不再是 x 空间）", () => {
    const g = contractFn();
    expect(g).toBeDefined();
    if (!g) return;
    const tp = g.typeParams[0]!;
    expect(tp.id).toBe("A1");
    expect(tp.bounds).toBeDefined();
    const printed = tp.bounds!.map(predToString);
    expect(printed).toEqual([
      'typeof A1 = "number"',
      "A1 > 0",
    ]);
    // 关键回归钉：修好前这里恒为 undefined（全被判 unbound 丢弃）
    expect(tp.bounds!.length).toBe(2);
    for (const b of tp.bounds!) {
      expect(JSON.stringify(b)).not.toMatch(/"id":"x"/);
    }
  });

  it("entryReqs / display 保持实参名空间原貌（零行为变化）", () => {
    const g = contractFn();
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.typeParams[0]!.bounds).toBeDefined();
    expect(predToString(g.entryReqs![0]!.pred)).toContain("x > 0");
    expect(g.display).toContain("x > 0");
    // 重锚只产出另存的界，不回写 entryReqs
    expect(JSON.stringify(g.entryReqs![0]!.pred)).toContain('"id":"x"');
  });

  it("多形参：界各归其位（A1 ← x，A2 ← y）", () => {
    const g = multiFn();
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.params).toEqual(["x", "y"]);
    expect(g.typeParams.map((t) => t.id)).toEqual(["A1", "A2"]);
    expect(g.typeParams[0]!.bounds?.map(predToString)).toEqual([
      'typeof A1 = "number"',
      "A1 > 0",
    ]);
    expect(g.typeParams[1]!.bounds?.map(predToString)).toEqual([
      'typeof A2 = "number"',
      "A2 > 1",
    ]);
    expect(g.entryReqs?.map((r) => predToString(r.pred))).toEqual([
      'typeof x = "number" ∧ x > 0',
      'typeof y = "number" ∧ y > 1',
    ]);
  });

  it("无契约：bounds 为空（不发明界）", () => {
    const g = noContractFn();
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.entryReqs).toBeUndefined();
    expect(g.typeParams[0]!.bounds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 纯函数：重锚后校验纪律不放松
// ---------------------------------------------------------------------------

describe("ABS-14 alignSimpleBounds 重锚 + 校验", () => {
  const typeofX: Pred = { op: "typeof", t: v("x"), type: "number" };

  it("正例：typeof / 数值界重锚为 α 名", () => {
    expect(
      alignSimpleBounds(typeofX, ["x"], ["A1"], 0).map(predToString),
    ).toEqual(['typeof A1 = "number"']);
    expect(
      alignSimpleBounds(
        { op: "gt", a: v("x"), b: lit(0) },
        ["x"],
        ["A1"],
        0,
      ).map(predToString),
    ).toEqual(["A1 > 0"]);
  });

  it("正例：β 的界引用声明在前的 α（单向依赖允许）", () => {
    expect(
      alignSimpleBounds(
        { op: "gt", a: v("y"), b: v("x") },
        ["x", "y"],
        ["A1", "A2"],
        1,
      ).map(predToString),
    ).toEqual(["A2 > A1"]);
  });

  it("and 拆分：只保留通过的简单界", () => {
    const p: Pred = {
      op: "and",
      args: [typeofX, { op: "gt", a: v("x"), b: v("y") }],
    };
    // x 的界引用后面的 y ⇒ 重锚后 A2 属反向依赖 ⇒ 丢弃
    expect(alignSimpleBounds(p, ["x", "y"], ["A1", "A2"], 0).map(predToString)).toEqual([
      'typeof A1 = "number"',
    ]);
  });

  it("负例：反向依赖 / 未声明 binder 名 / app term 一律丢弃", () => {
    expect(
      alignSimpleBounds(
        { op: "gt", a: v("x"), b: v("y") },
        ["x", "y"],
        ["A1", "A2"],
        0,
      ),
    ).toEqual([]);
    // binder 名不在 params→ids 映射里，保持原样 ⇒ unbound ⇒ 丢弃（不猜）
    expect(
      alignSimpleBounds(
        { op: "typeof", t: v("bind:A"), type: "number" },
        ["x"],
        ["A1"],
        0,
      ),
    ).toEqual([]);
    expect(
      alignSimpleBounds(
        { op: "gt", a: app("+", [v("x"), lit(1)]), b: lit(0) },
        ["x"],
        ["A1"],
        0,
      ),
    ).toEqual([]);
  });

  it("纯函数：不修改传入的 Pred（entryReqs / Φ 原貌保证）", () => {
    const p: Pred = {
      op: "and",
      args: [typeofX, { op: "gt", a: v("x"), b: lit(0) }],
    };
    const snapshot = JSON.stringify(p);
    alignSimpleBounds(p, ["x"], ["A1"], 0);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 元数据可用性：界是良构的 α 空间 Pred（**当前无产品消费方**）
//
// 2026-11-13 订正：`TypeParam.bounds` 是 write-only 元数据，产品路径没有读者 ——
// 快路径的门槛是 `FnSummaryEntry.pre`（形成时的完整 Φ），不是这里的简单界。
// 本节只证明（a）界能被 `implies` 直接判定，（b）把它作为条目 `pre` 时门槛
// 行为正确（即数据形态可被未来消费方直接使用），不再宣称产品已接线。
// ---------------------------------------------------------------------------

describe("ABS-14 界的元数据形态（write-only，无产品消费方）", () => {
  const numVar = (id: string): Abs =>
    makeAbs({ k: "prim", type: "number" }, v(id), undefined, "path");

  it("implies 能判定 α 空间界（满足 / 不满足）", () => {
    const g = contractFn();
    expect(g).toBeDefined();
    if (!g) return;
    const bounds = g.typeParams[0]!.bounds!;
    const satisfied: Phi = {
      op: "and",
      args: [
        { op: "typeof", t: v("A1"), type: "number" },
        { op: "gt", a: v("A1"), b: lit(0) },
      ],
    };
    for (const b of bounds) expect(implies(satisfied, b)).toBe(true);
    expect(implies(pTrue, bounds[0]!)).toBe(false);
  });

  it("作为条目 `pre` 时门槛行为正确：蕴含才命中，否则 fail-closed", () => {
    const g = contractFn();
    expect(g).toBeDefined();
    if (!g) return;
    const bounds = g.typeParams[0]!.bounds!;
    const pre: Pred = { op: "and", args: [...bounds] };
    const args = [numVar("A1")];
    const order = ["A1"];
    const entry: FnSummaryEntry = {
      post: numVar("A1"),
      varOrder: [...order],
      ...fnLevelFields(args, pTrue, order),
      pre,
    };
    const satisfied: Phi = {
      op: "and",
      args: [
        { op: "typeof", t: v("A1"), type: "number" },
        { op: "gt", a: v("A1"), b: lit(0) },
      ],
    };
    expect("post" in tryFnLevelFastPath(entry, args, satisfied)).toBe(true);
    expect(tryFnLevelFastPath(entry, args, pTrue)).toEqual({ miss: "pre" });
  });
});
