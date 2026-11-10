/**
 * ABS-14 降级通道（body 不可用 / 预算截断）的**独立验证**。
 *
 * 这两条通道把 body 路径 fail-closed 的 `unknown #opaque` 换成同函数之前
 * 真实 body 求值写下的摘要结论。因为当前 body 路径本就没有结论，等价门禁的
 * 对象相应细化为「≡ 同函数 body 可用时的真实结论」（计划 §5 决策第 3 条）。
 *
 * 本夹具逐条钉住：
 * - 替换结果 ≡ `runBodyPath` 的真实 body 结论（逐字节）；
 * - 只有 `unknown #opaque` 会被碰，已有结论不许被覆盖；
 * - 无摘要 / 形状不符 / 界不成立 / formal 数不符 / 变元未映射 ⇒ 一律
 *   fail-closed，绝不静默放宽；
 * - 预算截断样本在通道开启下仍是 `unknown #opaque` 且不写摘要（无假绿）；
 * - 三条通道默认全启用。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, type Abs } from "../abs.ts";
import { v } from "../term.ts";
import { pTrue } from "../pred.ts";
import { formatAbs } from "../format/format.ts";
import {
  ABS14_BASELINE_CASES,
  runBodyPath,
  type Abs14BaselineCase,
} from "./abs14-equivalence-baseline.ts";
import {
  fnLevelFields,
  getAbs14FastPathChannels,
  tryDegradedChannel,
  shapeSigOf,
} from "../key/summary-fastpath.ts";
import type { FnSummaryEntry } from "../key/fn-summary.ts";

const numVar = (id: string): Abs =>
  makeAbs({ k: "prim", type: "number" }, v(id), undefined, "path");
const opaque = (): Abs => makeAbs({ k: "unknown" }, undefined, undefined, "opaque");

const caseOf = (id: string): Abs14BaselineCase => {
  const c = ABS14_BASELINE_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`[abs14 degraded] missing baseline case: ${id}`);
  return c;
};

/** 摘要条目来自一次**真实 body 求值**，不是手工编造的 post。 */
const bodyRun = runBodyPath(caseOf("arithmetic-return"));
const args = (): Abs[] => [numVar("q")];
const order = ["q"];

function entry(overrides: Partial<FnSummaryEntry> = {}): FnSummaryEntry {
  return {
    post: bodyRun.post,
    varOrder: [...order],
    ...fnLevelFields(args(), pTrue, order),
    ...overrides,
  };
}

describe("ABS-14 降级通道独立验证", () => {
  it("三条保守通道默认全部启用", () => {
    expect(getAbs14FastPathChannels()).toEqual({
      crossModule: true,
      bodyUnavailable: true,
      budgetTruncated: true,
    });
  });

  it("替换结论 ≡ 同函数 body 可用时的真实结论（逐字节）", () => {
    const r = tryDegradedChannel(opaque(), entry(), args(), pTrue, order);
    expect("miss" in r).toBe(false);
    if ("miss" in r) return;
    expect(formatAbs(r.post)).toBe(bodyRun.printed);
    expect(bodyRun.printed).toBe(caseOf("arithmetic-return").expectedPost);
  });

  it("纯函数：重复调用结果一致（冷/暖缓存不产生分歧）", () => {
    const a = tryDegradedChannel(opaque(), entry(), args(), pTrue, order);
    const b = tryDegradedChannel(opaque(), entry(), args(), pTrue, order);
    expect(a).toEqual(b);
  });

  it("不是 unknown #opaque 时不碰（已有结论不许被覆盖）", () => {
    expect(tryDegradedChannel(bodyRun.post, entry(), args(), pTrue, order)).toEqual({
      miss: "not-degraded",
    });
  });

  it("无摘要 ⇒ 保持无信息（不编造、不放宽）", () => {
    expect(tryDegradedChannel(opaque(), undefined, args(), pTrue, order)).toEqual({
      miss: "no-summary",
    });
  });

  it("形状签名不符 ⇒ fail-closed", () => {
    const e = entry({ shapeSig: "prim:string" });
    expect(shapeSigOf(args())).toBe("prim:number");
    expect(tryDegradedChannel(opaque(), e, args(), pTrue, order)).toEqual({
      miss: "shape",
    });
  });

  it("界不被当前 Φ 蕴含 ⇒ fail-closed", () => {
    const e = entry({
      bounds: [{ op: "ge", a: v("q"), b: { op: "lit", value: 10 } }],
    });
    expect(tryDegradedChannel(opaque(), e, args(), pTrue, order)).toEqual({
      miss: "bounds",
    });
  });

  it("formal 数不符 / 变元未映射 ⇒ fail-closed", () => {
    expect(
      tryDegradedChannel(opaque(), entry({ formals: ["q", "r"] }), args(), pTrue, order),
    ).toEqual({ miss: "formal-arity" });
    expect(tryDegradedChannel(opaque(), entry(), args(), pTrue, ["z"])).toEqual({
      miss: "unmapped",
    });
  });

  it("预算截断样本在通道开启下仍是 unknown #opaque，且不写摘要（无假绿）", () => {
    const r = runBodyPath(caseOf("recursive-budget"));
    expect(r.printed).toBe("unknown  #opaque");
    expect(r.summaryHits).toBe(0);
    expect(r.summaryStores).toBe(0);
  });
});
