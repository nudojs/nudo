/**
 * Bug 453 —— 收割的**泛型函数**在调用点**不绑定类型实参** ⇒ 返回值落 `any`
 * ⇒ 参与算术即「抽象操作数强制转换」⇒ **L2 假红**（tsc exit 0 的合法代码被门禁判红）。
 *
 * 根因：harvester 把 `T[]` 建成 **`arr`**（元素 = α var），引擎把**数组字面量**
 * 建成 **`tuple`** ⇒ `bindTypeVars` 只做**同 kind** 配对 ⇒ α 永不绑定。
 *
 * 修法（`packages/core/src/algebra/hof.ts` 的 `bindTypeVars`）：加**跨 kind 臂**
 * （`arr` 形参 × `tuple` 实参 / `tuple` 形参 × `arr` 实参）。
 * ⚠ **同 kind 臂排在前** —— 否则 `hof-relation.test.ts` 的既有用例
 * 「deep α: `T[]` param binds T from `number[]` arg (lodash-style)」会被改判。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, relationFn, instantiateReturn, type Abs } from "../index.ts";

/** α 变量（any 形状 + var term） */
const alpha = abs({ k: "any" }, { op: "var", id: "T0" }, undefined, "exact");
/** harvester 建的 `T[]` 形参：shape = arr(element = α) */
const arrParam = abs({ k: "arr", element: alpha }, undefined, undefined, "exact");
/** 引擎的数组字面量实参：shape = tuple(elements) */
const tupleArg = abs(
  { k: "tuple", elements: [numLit(1)] },
  undefined,
  undefined,
  "exact",
);
/** 引擎的「arr 形」实参（抽象数组） */
const arrArg = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");

function fnSig(paramTypes: Abs[], returnType: Abs): Abs {
  return abs(
    { k: "fn", params: paramTypes.map((_, i) => `p${i}`), paramTypes, returnType },
    undefined,
    undefined,
    "exact",
  );
}

describe("Bug 453: 泛型 α 跨形状 kind 绑定", () => {
  it("arr 形参（收割的 T[]）× tuple 实参（数组字面量）⇒ α 绑定（不再落 any）", () => {
    const fn = fnSig([arrParam], alpha);
    const out = instantiateReturn(fn, [tupleArg]);
    // 改前：any = T0（α 未绑定）⇒ 参与算术即 may-throw（L2 假红）
    expect(out.shape.k).not.toBe("any");
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("同 kind 臂仍排在前：arr 形参 × arr 实参 仍绑出元素类型（既有 deep-α 用例的护栏）", () => {
    const fn = fnSig([arrParam], alpha);
    const out = instantiateReturn(fn, [arrArg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("tuple 形参 × arr 实参 ⇒ 各槽绑 arr 的元素类型", () => {
    const t = abs({ k: "tuple", elements: [alpha] }, undefined, undefined, "exact");
    const fn = fnSig([t], alpha);
    const out = instantiateReturn(fn, [arrArg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("空 tuple 实参不绑（无元素 ⇒ 保守留空，不臆造元素类型）", () => {
    const empty = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
    const fn = fnSig([arrParam], alpha);
    const out = instantiateReturn(fn, [empty]);
    // α 未绑定 ⇒ 仍是 any 形状（不假精确）
    expect(out.shape.k).toBe("any");
  });

  it("非数组 kind 仍不绑（prim 形参 × prim 实参：无 α 可绑）", () => {
    const prim = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
    const fn = fnSig([prim], alpha);
    const out = instantiateReturn(fn, [numLit(1)]);
    expect(out.shape.k).toBe("any");
  });
});
