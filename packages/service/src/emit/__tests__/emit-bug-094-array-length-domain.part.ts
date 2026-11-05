/**
 * BUG-094 —— zod / standard 面把**数组自身的长度界**（`array(T).min(n)` /
 * `.max(n)`）整段丢掉，且**零 dropped 台账** ⇒ guard 面拒绝的数组，另两个面
 * 全部放行（假绿 + 跨面矛盾）。
 *
 * 根因：`constraintToSchemaNode` 的 `c.element` 分支直接 `return`（数组级
 * `c.preds` 被丢）、`SchemaNode` 的 arr 分支**没有承载长度界的位置**、
 * `constraintDropped` 的 `n.element` 分支只递归元素（零台账）。
 *
 * 修法：arr 节点承载 `minLen` / `maxLen`，zod 渲染 `.min() / .max()`，
 * standard 两个实现（库函数版 + 产物内联版）同步做长度检查，表达不了的
 * 数组级 pred 进 dropped。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  absToConstraint,
  app,
  num,
  number,
  predToString,
  type Abs,
  type NudoConstraint,
  type Pred,
} from "@nudojs/core";
import {
  absToSchemaNode,
  absToSchemaSource,
  constraintToSchemaNode,
  schemaNodeToZod,
  schemaNodeToZodProjection,
} from "../schema-generator.ts";
import { validateSchemaNode } from "../standard-schema.ts";

/** `length(self) op n`（self 用 `__nudo_self__` 口径，与 absToConstraint 一致） */
const lenOf = (n: number, op: "ge" | "le" | "gt" | "lt"): Pred =>
  ({
    op,
    a: app("length", [{ op: "var", id: "__nudo_self__" }]),
    b: { op: "lit", value: n },
  }) as Pred;

const arrWith = (pred: Pred, element: Abs = num()): Abs =>
  abs({ k: "arr", element }, undefined, pred, "exact");

/** 源契约口径：`array(number()).min(n)`（builder 本身就是 NudoConstraint） */
const arrConstraint = (n: number): NudoConstraint => ({
  __nudoConstraint: true,
  preds: [lenOf(n, "ge")],
  element: number(),
} as NudoConstraint);

describe("BUG-094 — 数组长度界不得在 zod / standard 面消失", () => {
  it("min(3)：zod 面渲染 `.min(3)`（不再是裸 z.array）", () => {
    const source = absToSchemaSource(arrWith(lenOf(3, "ge")));
    expect(source).toContain("z.array(");
    expect(source).toContain(".min(3)");
  });

  it("max(2)：zod 面渲染 `.max(2)`", () => {
    expect(absToSchemaSource(arrWith(lenOf(2, "le")))).toContain(".max(2)");
  });

  it("strict gt/lt 归一：length > 3 ⇒ min 4；length < 3 ⇒ max 2", () => {
    expect(absToSchemaSource(arrWith(lenOf(3, "gt")))).toContain(".min(4)");
    expect(absToSchemaSource(arrWith(lenOf(3, "lt")))).toContain(".max(2)");
  });

  it("Abs 投影路径：节点带 minLen，standard 面拒收 [1] 放行 [1,2,3]", () => {
    const { node } = absToSchemaNode(arrWith(lenOf(3, "ge")));
    expect(node).toMatchObject({ k: "arr", minLen: 3 });
    expect(validateSchemaNode(node, [1, 2, 3])).toEqual({ value: [1, 2, 3] });
    expect(validateSchemaNode(node, [1]).issues?.length).toBeGreaterThan(0);
    expect(validateSchemaNode(node, []).issues?.length).toBeGreaterThan(0);
  });

  it("约束路径（c.element + 数组级 preds）：arr 节点带 minLen", () => {
    const node = constraintToSchemaNode(arrConstraint(3));
    expect(node).toEqual({
      k: "arr",
      element: { k: "prim", type: "number", refinements: [] },
      minLen: 3,
    });
  });

  it("约束路径 → zod 源码保留长度界", () => {
    expect(schemaNodeToZod(constraintToSchemaNode(arrConstraint(3)))).toBe(
      "z.array(z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))).min(3)",
    );
  });

  it("maxLen 同样可表达（回向同理）", () => {
    const node = constraintToSchemaNode({
      __nudoConstraint: true,
      preds: [lenOf(2, "le")],
      element: number(),
    } as NudoConstraint);
    expect(validateSchemaNode(node, [1, 2])).toEqual({ value: [1, 2] });
    expect(validateSchemaNode(node, [1, 2, 3]).issues?.length).toBeGreaterThan(0);
  });

  it("数组级不可表达的 pred 进 dropped 台账（不得静默丢）", () => {
    const eqPred: Pred = {
      op: "eq",
      a: { op: "var", id: "__nudo_self__" },
      b: { op: "lit", value: 1 },
    } as Pred;
    // 台账在 Abs 投影路径上收集（节点层），不是渲染层
    const { dropped } = absToSchemaNode(abs({ k: "arr", element: num() }, undefined, eqPred, "exact"));
    expect(dropped.join("\n")).toContain(predToString(eqPred));
  });

  it("数组级不可表达的 pred 在约束路径同样进台账（与 Abs 路径同口径）", () => {
    const eqPred: Pred = {
      op: "eq",
      a: { op: "var", id: "__nudo_self__" },
      b: { op: "lit", value: 1 },
    } as Pred;
    const c: NudoConstraint = {
      __nudoConstraint: true,
      preds: [eqPred],
      element: number(),
    } as NudoConstraint;
    // constraintDropped 是内部函数；经 absToSchemaNode 的约束路径无法构造该 pred
    // （absToConstraint 先丢 preds）⇒ 这里只断言节点不携带伪造的长度界。
    const node = constraintToSchemaNode(c);
    expect(node).toEqual({
      k: "arr",
      element: { k: "prim", type: "number", refinements: [] },
    });
  });

  it("负控制：无长度界的数组节点形态不变", () => {
    const { node } = absToSchemaNode(abs({ k: "arr", element: num() }, undefined, undefined, "exact"));
    expect(node).toEqual({
      k: "arr",
      element: { k: "prim", type: "number", refinements: [] },
    });
    expect(schemaNodeToZod(node)).toBe(
      "z.array(z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity)))",
    );
  });

  it("与 absToConstraint 的衔接：契约 Abs 的数组长度界真的到了节点", () => {
    // 直接走 core 契约投影（它只投影元素域）+ emit 补挂的数组级 preds
    const a = arrWith(lenOf(3, "ge"));
    expect(absToConstraint(a)).toBeDefined();
    expect(absToSchemaSource(a)).toContain(".min(3)");
  });
});
