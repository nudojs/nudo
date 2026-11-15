// MERGED (topic-related bug pins): core-bug-397-this-param-transpile.test.ts + core-bug-397-this-parameter.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { runTranspiled } from "../exec/run.ts";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import { callLit } from "./eval-helpers.ts";
import { contractParamNameSet, formalParamDisplayNames, formalParamsFromNodes, formalParamSignatureNames, locateContractParam } from "../format/param-surface.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check/check.ts";

describe("[merged] core-bug-397-this-param-transpile.test.ts", () => {
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
 * `packages/service/src/__tests__/service--this-param-product-faces.part.ts`；
 * 本钉只钉**转译面**：模块必须**装载成功**（不是 unknown），
 * 且形参表里**没有** `this`、实参**不因** `this` 占用而错位。
 */





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
});

describe("[merged] core-bug-397-this-parameter.test.ts", () => {
/**
 * Bug 397 —— TS 的 `this: T` **接收者标注**被当成运行时形参 ⇒ 形参表多一槽。
 *
 * 根因：TS 的 `this: T` 在 Babel AST 里就是普通 `Identifier("this")`
 * （**不是** TSParameterProperty），`formalParamsFromNodes` 的 `Identifier`
 * 分支没有「名字是 `this` ⇒ 接收者标注」的判据 ⇒ `this` 进形参表 ⇒ 顺着
 * `extractParamNames` → `fn.paramNames` 流向全部下游面（check 签名面 /
 * `--abs` / dts 形参表 / zod 槽名 / standard 导出名 / case 实参绑定）。
 *
 * 修法（族 08 · S3）：`formalParamsFromNodes` 跳过名字为 `this` 的形参
 * （`this` 是 JS 保留字，不可能有同名真形参 ⇒ 判据用标识符文本即可，
 * 与 harvester 路径 Bug 794 同口径）。跳过后**形参表的位置要跟着前移**
 * （`index` 与 `formalParamDisplayNames` 同序）。
 *
 * ⚠ **产物面在 S5**（dts / zod / standard / case）：它们消费
 * `fn.paramNames`（由 `formalParamDisplayNames(formalParamsFromNodes(…))`
 * 派生）⇒ 本片的模型修正自动传导过去。
 *
 * 反向钉：HEAD（未修）上 `formalParamDisplayNames` 是 `["this", "a"]`
 * ⇒ 本文件的断言**必失败**。
 */







const thisParamSource =
  "export function withThis(this: { x: number }, a: number) { return a + this.x; }\n";

describe("Bug 397 TS this-parameter is not a runtime param", () => {
  it("identifier named this is skipped from the formal param table", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "this" },
      { type: "Identifier", name: "a" },
    ] as never);
    expect(formals).toHaveLength(1);
    expect(formals[0]).toMatchObject({ kind: "id", name: "a", index: 0 });
  });

  it("this does not appear in display / signature / contract names", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "this" },
      { type: "Identifier", name: "a" },
    ] as never);
    expect(formalParamDisplayNames(formals)).toEqual(["a"]);
    expect(formalParamSignatureNames(formals)).toEqual(["a"]);
    expect(contractParamNameSet(formals).has("this")).toBe(false);
    expect(locateContractParam(formals, "this")).toBeUndefined();
  });

  it("generalize keeps only the real runtime params", () => {
    const g = generalizeFromAst("withThis", thisParamSource);
    expect(g?.params).toEqual(["a"]);
    expect(g?.formals?.map((f) => f.kind)).toEqual(["id"]);
    expect(g?.formals?.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual([
      "a",
    ]);
  });

  it("check signature lists one param, not two", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const r = checkSource("/t/lib.ts", thisParamSource, pTrue, {});
    expect(r.signatures).toHaveLength(1);
    expect(r.signatures[0]!.params).toEqual(["a"]);
    expect(r.signatures[0]!.paramTypes).toEqual(["number"]);
  });

  it("a param literally named this cannot exist (this is a reserved word)", () => {
    // `function f(this) {}` 是 JS 语法错误 ⇒ 名字是 `this` 只能是接收者标注
    expect(() => new Function("function f(this) {}")).toThrow();
  });
});
});
