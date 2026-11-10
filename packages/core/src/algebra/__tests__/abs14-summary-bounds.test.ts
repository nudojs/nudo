/**
 * ABS-14 PR2：界的「简单条件 + 单向依赖」负例门禁。
 *
 * 对应计划 §5 决策第 1 条：β 的界依赖 α 允许（α 在前），α 的界引用 β
 * 拒绝；未声明变元、复杂 app term 一律 fail-closed。本批界只存不读，
 * 不改变任何分析结果。
 */
import { describe, it, expect } from "vitest";
import { app, lit, v } from "../term.ts";
import type { Pred } from "../pred.ts";
import { checkSimpleBounds, collectSimpleBounds } from "../key/summary-bounds.ts";

const formals = ["A1", "B1"];

const typeofA: Pred = { op: "typeof", t: v("A1"), type: "number" };
const aPositive: Pred = { op: "gt", a: v("A1"), b: lit(0) };
const bPositive: Pred = { op: "gt", a: v("B1"), b: lit(0) };

describe("ABS-14 PR2 简单条件 + 单向依赖", () => {
  it("正例：自身变元的 typeof 与数值界", () => {
    expect(checkSimpleBounds(typeofA, formals, 0).ok).toBe(true);
    expect(checkSimpleBounds(aPositive, formals, 0).ok).toBe(true);
    expect(checkSimpleBounds(bPositive, formals, 1).ok).toBe(true);
  });

  it("正例：β 的界引用声明在前的 α（单向依赖允许）", () => {
    const p: Pred = { op: "gt", a: v("B1"), b: v("A1") };
    expect(checkSimpleBounds(p, formals, 1).ok).toBe(true);
  });

  it("负例：α 的界引用后面的 β ⇒ 反向依赖拒绝", () => {
    const p: Pred = { op: "gt", a: v("A1"), b: v("B1") };
    const r = checkSimpleBounds(p, formals, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("reverse");
  });

  it("负例：未声明变元拒绝", () => {
    const p: Pred = { op: "gt", a: v("GHOST"), b: lit(0) };
    const r = checkSimpleBounds(p, formals, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unbound");
  });

  it("负例：复杂 app term 拒绝（不引入算术求解）", () => {
    const p: Pred = {
      op: "gt",
      a: app("+", [v("A1"), lit(1)]),
      b: lit(0),
    };
    const r = checkSimpleBounds(p, formals, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("complex term");
  });

  it("负例：and / not 里的嵌套违规同样拒绝", () => {
    const p: Pred = {
      op: "and",
      args: [typeofA, { op: "not", arg: { op: "gt", a: v("A1"), b: v("B1") } }],
    };
    expect(checkSimpleBounds(p, formals, 0).ok).toBe(false);
  });

  it("collectSimpleBounds：and 拆分后只保留通过的项", () => {
    const p: Pred = {
      op: "and",
      args: [typeofA, { op: "gt", a: v("A1"), b: v("B1") }],
    };
    expect(collectSimpleBounds(p, formals, 0)).toEqual([typeofA]);
  });

  it("空条件与 true/false 不产生误拒", () => {
    expect(checkSimpleBounds({ op: "true" }, formals, 0).ok).toBe(true);
    expect(collectSimpleBounds({ op: "true" }, formals, 0)).toEqual([
      { op: "true" },
    ]);
  });
});
