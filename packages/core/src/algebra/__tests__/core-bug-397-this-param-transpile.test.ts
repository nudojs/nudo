/**
 * Bug 397 回归（**转译面**）：TS 的 `this: T` 是**接收者标注**，不是运行时
 * 形参 —— 但转译器此前把它当**真形参**发射 ⇒ 产物是
 * `function withThis(this, a) { … }` ⇒ `this` **不是合法形参名**
 * （strict / sloppy 皆 `SyntaxError`）⇒ `new Function` 抛 ⇒
 * **整个模块装载失败** ⇒ 求值面（case@ / entry@ / call@）全折 `unknown`
 * （fail-closed）。
 *
 * 模型层（形参表排除 `this`）见 `core-bug-397-this-parameter.test.ts`；
 * 产物面（dts / zod / standard / case 四面）见
 * `packages/service/src/__tests__/service-bug-397-this-param-product-faces.test.ts`；
 * 本钉只钉**转译面**：模块必须**装载成功**（不是 unknown），
 * 且形参表里**没有** `this`、实参**不因** `this` 占用而错位。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled } from "../exec/run.ts";
import { generalizeFromAst } from "../generalize.ts";
import { callLit } from "./eval-helpers.ts";

const FN_DECL = `export function withThis(this: { x: number }, a: number): number { return a + 1; }`;
const CLASS_METHOD = `export class C { m(this: C, a: number): number { return a + 1; } }`;

describe("Bug 397（转译面）：`this: T` 标注不得被发射成运行时形参", () => {
  it("带 `this: T` 的函数声明：实参按**实参位**绑定（`this` 不占位）", () => {
    // `this` 是接收者标注 ⇒ 原生 `f(1)` 的 `a` = 1（不是 undefined）
    const r = callLit(FN_DECL, "withThis", 1);
    expect(r.result.shape.k).toBe("prim");
    expect(r.result.term?.op).toBe("lit");
    expect((r.result.term as { value?: unknown } | undefined)?.value).toBe(2);
  });

  it("带 `this: T` 的函数声明：形参表里没有 `this`", () => {
    const poly = generalizeFromAst("withThis", FN_DECL, { label: "397" });
    expect(poly).toBeDefined();
    expect(poly!.params).toEqual(["a"]);
    expect(poly!.params).not.toContain("this");
  });

  it("带 `this: T` 的类方法：形参表里没有 `this`", () => {
    const poly = generalizeFromAst("C.m", CLASS_METHOD, { label: "397m" });
    expect(poly).toBeDefined();
    expect(poly!.params).toEqual(["a"]);
    expect(poly!.params).not.toContain("this");
  });

  it("带 `this: T` 的类方法：模块装载成功（产物语法合法，不抛 SyntaxError）", () => {
    // 宿主方法签名此前是 `(__this, this, a) => {…}` ⇒ `this` 不是合法形参名
    // ⇒ 产物语法非法 ⇒ `new Function` 抛 ⇒ 整个模块装载失败
    expect(() => runTranspiled(CLASS_METHOD, { mode: "analyze" })).not.toThrow();
  });
});
