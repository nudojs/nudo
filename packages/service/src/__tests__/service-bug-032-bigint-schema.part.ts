/**
 * BUG-032 —— export 的 zod / standard 两个方言把**已知的 bigint 字面量**
 * 整条降级成 `unknown`（连基类型都没保住）⇒ 校验器接受**任何**值；
 * 而 guard 面（`data === 10n`）与 dts 面（`bigint`）都保住了基类型
 * ⇒ 三面接受集不相交。
 *
 * 修法：观测路径上的 bigint 字面量保**基类型**（`z.bigint()` /
 * `{"k":"prim","type":"bigint"}`），字面量精度进 dropped 台账。
 */
import { describe, it, expect } from "vitest";
import { abs } from "@nudojs/core";
import { absToSchemaNode, projectAbsToSchema } from "../emit/schema-generator.ts";

const bigintLit = (v: bigint) => abs({ k: "prim", type: "bigint" }, { op: "lit", value: v }, undefined, "exact");

describe("BUG-032 —— bigint 字面量保基类型", () => {
  it("zod 方言：z.bigint()（不是 z.unknown()）", () => {
    const p = projectAbsToSchema(bigintLit(10n), { dialect: "zod" });
    expect(p.source).toBe("z.bigint()");
    // 字面量精度损失必须留痕
    expect(p.dropped.join("\n")).toContain("lit bigint not projected: 10");
  });

  it("schema 节点：prim bigint（standard 方言据此渲染 prim 校验）", () => {
    const { node } = absToSchemaNode(bigintLit(10n));
    expect(node).toEqual({ k: "prim", type: "bigint", refinements: [] });
  });
});
