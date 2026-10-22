/**
 * Bug 393 —— 数组解构形参的契约把形参投影成**对象 shape**（错形态）
 * ⇒ 函数体按**数组下标**读绑定名 `a` ⇒ 读到 `never` ⇒ 返回面塌成 `never`。
 *
 * 修法（族 08 · S3 = **模型层**）：形参表面必须记录「这是数组解构」以及
 * **每个顶层绑定名对应的元素下标**——投影侧（`generalize.ts` 的
 * `buildPatternObjAbs`）据此建 **tuple/arr** 而不是对象 shape。
 *
 * ⚠ **投影侧在 S4**（`generalize.ts`）：S4 需要的字段形状 =
 *   `FormalParam.patternKind === "array"`（判形态）+ `FormalParam.boundIndex`
 *   （绑定名 → 下标）+ `FormalParam.propKey`（数组解构**恒空**——数组没有
 *   属性键）。S4 建 tuple 时按下标取 `boundIndex` 的值。
 *
 * 反向钉：HEAD（未修）上 `patternKind` 为 undefined、`boundIndex` 不存在
 * ⇒ 本文件的断言**必失败**。
 */
import { describe, it, expect } from "vitest";
import { formalParamsFromNodes } from "../param-surface.ts";
import { callLit } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

const arrayPatternNode = {
  type: "ArrayPattern",
  elements: [
    { type: "Identifier", name: "a" },
    { type: "Identifier", name: "b" },
  ],
};

const objectPatternNode = {
  type: "ObjectPattern",
  properties: [
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "a" },
      value: { type: "Identifier", name: "a" },
    },
  ],
};

describe("Bug 393 array pattern param shape model", () => {
  it("array pattern exposes the element index of every top-level binding", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    const f = formals[0]!;
    expect(f.kind).toBe("pattern");
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.patternKind).toBe("array");
    expect(f.bound).toEqual(["a", "b"]);
    expect(f.boundIndex).toEqual({ a: 0, b: 1 });
  });

  it("array pattern has no property-key table (arrays have no slots)", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    const f = formals[0]!;
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.propKey).toEqual({});
  });

  it("object pattern keeps the property-key table and no index table", () => {
    const formals = formalParamsFromNodes([objectPatternNode] as never);
    const f = formals[0]!;
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.patternKind).toBe("object");
    expect(f.propKey).toEqual({ a: "a" });
    expect(f.boundIndex).toEqual({});
  });

  it("default + array pattern still records the array kind and index", () => {
    const formals = formalParamsFromNodes([
      {
        type: "AssignmentPattern",
        left: {
          type: "ArrayPattern",
          elements: [{ type: "Identifier", name: "a" }],
        },
      },
    ] as never);
    const f = formals[0]!;
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.patternKind).toBe("array");
    expect(f.boundIndex).toEqual({ a: 0 });
  });

  it("array destructuring still evaluates at runtime (no regression)", () => {
    const r = callLit(
      "export function f([a, b]) { return a; }\n",
      "f",
      [1, 2],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});
