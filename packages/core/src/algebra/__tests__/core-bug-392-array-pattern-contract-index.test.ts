/**
 * Bug 392 —— 数组解构形参的**字段级契约**被按**属性键**寻址 ⇒ 假红。
 *
 * 根因：`locateContractParam` 对 `kind: "pattern"` 默认「bound 名即属性键」
 * （对对象解构成立）。对数组解构不成立：`[a, b]` 的 `a` 是**下标 0 的元素**
 * ⇒ 契约被投影到 `arg.a` ⇒ 投影找不到 ⇒ 报「missing field a」**假红**。
 *
 * 修法（族 08 · S3 = **模型层**）：形参表面记录模式种类与**元素下标表**
 * （`patternKind: "array"` + `boundIndex`），`locateContractParam` 对数组解构
 * 返回**下标** `fieldIndex`（且**不给** `fieldPath`——fieldPath 是对象 slot
 * 投影路径，对数组无意义）。
 *
 * ⚠ **执法侧（实参投影 + 报假红）在 S4**（`scan-literal-calls.ts`）：
 * S4 需要 `hit.fieldIndex`（数组解构 ⇒ 按下标投影实参的元素）与
 * `hit.field`（展示名）两个字段；对象解构的 `fieldPath` 口径**不变**。
 *
 * 反向钉：HEAD（未修）上 `locateContractParam` 返回
 * `{index, field, fieldPath}`（属性键口径）⇒ 本文件的数组解构断言**必失败**。
 */
import { describe, it, expect } from "vitest";
import {
  formalParamsFromNodes,
  locateContractParam,
} from "../param-surface.ts";

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

describe("Bug 392 array pattern contract addressing is by index", () => {
  it("array pattern bound name resolves to the element index", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(locateContractParam(formals, "a")).toEqual({
      index: 0,
      field: "a",
      fieldIndex: 0,
    });
    expect(locateContractParam(formals, "b")).toEqual({
      index: 0,
      field: "b",
      fieldIndex: 1,
    });
  });

  it("array pattern contract hit carries no object-slot fieldPath", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    const hit = locateContractParam(formals, "a");
    expect(hit).toBeDefined();
    expect(hit!.fieldPath).toBeUndefined();
  });

  it("object pattern contract hit keeps the property-key addressing", () => {
    const formals = formalParamsFromNodes([objectPatternNode] as never);
    expect(locateContractParam(formals, "a")).toEqual({
      index: 0,
      field: "a",
      fieldPath: ["a"],
    });
  });

  it("whole-param contract name still resolves to the pattern index", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(locateContractParam(formals, "_p0")).toEqual({ index: 0 });
    expect(locateContractParam(formals, "_")).toEqual({ index: 0 });
  });
});
