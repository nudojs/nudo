/**
 * Bug 522 —— standard-schema 方言**不校验元组的定长**（假绿）。
 *
 * 修前：定长元组（无 rest）的校验器只按位校验 `node.elements`，从不看
 * `value.length` ⇒ `[1, "two", 3]` 被放行，而引擎（`leqAbs` 的 tuple arity
 * 判定）与 zod 面（`z.tuple`）都拒绝。
 *
 * 修后：两份实现（库函数 `checkNode` / 生成产物内联 `__nudoCheck`）都在
 * **无 rest** 时要求 `value.length === node.elements.length`。
 *
 * 负控制：带 rest 的元组仍按 rest 语义放行超长数组（不得被定长判定误伤）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, strLit } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const fixedTuple = () =>
  abs({ k: "tuple", elements: [numLit(1), strLit("two")] }, undefined, undefined, "exact");

const tupleWithRest = () =>
  abs(
    { k: "tuple", elements: [numLit(1)], rest: numLit(2) },
    undefined,
    undefined,
    "exact",
  );

describe("Bug 522: standard 面定长元组必须校验长度", () => {
  it("库函数版：超长 / 欠长元组被拒，等长放行", () => {
    const { node } = absToSchemaNode(fixedTuple());
    expect(validateSchemaNode(node, [1, "two"])).toEqual({ value: [1, "two"] });
    const over = validateSchemaNode(node, [1, "two", 3]);
    expect(over.issues?.[0]?.message).toContain("expected tuple of length 2");
    const under = validateSchemaNode(node, [1]);
    expect(under.issues?.[0]?.message).toContain("expected tuple of length 2");
  });

  it("生成产物版：超长元组被拒（与库函数版同口径）", async () => {
    const { source } = absToStandardSchema(fixedTuple(), { name: "pair" });
    const mod = await loadGeneratedModule(source);
    expect(mod.pair!["~standard"].validate([1, "two"])).toEqual({ value: [1, "two"] });
    const over = mod.pair!["~standard"].validate([1, "two", 3]);
    expect(over.issues?.[0]?.message).toContain("expected tuple of length 2");
  });

  it("负控制：带 rest 的元组仍放行超长元素（rest 语义不回归）", async () => {
    const { node } = absToSchemaNode(tupleWithRest());
    expect(validateSchemaNode(node, [1, 2, 2])).toEqual({ value: [1, 2, 2] });
    const { source } = absToStandardSchema(tupleWithRest(), { name: "t" });
    const mod = await loadGeneratedModule(source);
    expect(mod.t!["~standard"].validate([1, 2, 2])).toEqual({ value: [1, 2, 2] });
  });
});
