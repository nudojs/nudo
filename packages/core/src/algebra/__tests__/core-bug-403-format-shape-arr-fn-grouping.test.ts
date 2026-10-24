/**
 * Bug 403 —— `formatShape` 的**数组元素**不给**函数类型**加括号。
 *
 * 症状（改前）：`arr(fn)` 渲染成 `(1) => 1[]` ⇒ 按 TS 解析规则，`[]` 绑定到
 * **函数的返回类型**而不是数组元素 ⇒ 「函数数组」被读成「返回 `1[]` 的函数」
 * （类型被显示反了）。姊妹渲染器 `absToTSType`（dts 面）对同一 Abs 给的是
 * `((a: 1) => 1)[]` ⇒ **同一个 Abs 两个渲染器两种读法**。
 *
 * 根因：`formatShapeInner` 的 `case "arr"` 只有一条「需要分组」谓词
 * （`s.element.shape.k === "sum"`），`fn` 不在其中。
 *
 * 修法（族 09 · S1）：抽出模块私有谓词 `needsGrouping`（**本片只对 `fn`
 * 生效**；`brand` / `obj` / `tuple` 的同类缺口不在本片范围），`case "arr"`
 * 与 `case "sum"` 共用；既有的 `sum` 分组判定**保留**。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "../format.ts";
import { abs, numLit, strLit, type Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** fn Abs（形参 `a: number`，返回 `number`） */
function fnAbs(): Abs {
  return abs(
    { k: "fn", params: ["a"], paramTypes: [numLit(1)], returnType: numLit(1) },
    undefined,
    undefined,
    "exact",
  );
}

describe("Bug 403 —— formatShape 的数组元素给函数类型加括号", () => {
  it("arr(fn)：函数元素加括号（改前 `(1) => 1[]`）", () => {
    const a = abs({ k: "arr", element: fnAbs() }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("((1) => 1)[]");
  });

  it("arr(arr(fn))：嵌套数组同样带括号", () => {
    const inner = abs({ k: "arr", element: fnAbs() }, undefined, undefined, "exact");
    const outer = abs({ k: "arr", element: inner }, undefined, undefined, "exact");
    expect(formatShape(outer)).toBe("((1) => 1)[][]");
  });

  it("控制：union 元素的既有分组判定保留", () => {
    const sum = abs(
      { k: "sum", members: [numLit(1), strLit("x")] },
      undefined,
      undefined,
      "exact",
    );
    const a = abs({ k: "arr", element: sum }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe('(1 | "x")[]');
  });

  it("控制：prim 元素不加冗余括号", () => {
    const a = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("1[]");
  });

  it("控制：tuple 元素里的 fn 不在本片范围（不加括号）", () => {
    const a = abs({ k: "tuple", elements: [fnAbs()] }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("[(1) => 1]");
  });

  it("控制：对象槽里的 fn 不在本片范围（不加括号）", () => {
    const a = abs(
      { k: "obj", slots: { cb: { value: fnAbs() } } },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("{ cb: (1) => 1 }");
  });

  it("端到端：真实源码返回「函数数组」时不得渲染成「返回数组的函数」", () => {
    const r = call(
      `export function f() { return Array.from([1], (x) => () => x); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("arr");
    const text = formatShape(r.result);
    // 改前是 `() => ?[]`（`[]` 被读成函数的返回类型）
    expect(text).not.toContain("=> ?[]");
    expect(text).toMatch(/\)\[\]$/);
  });
});
