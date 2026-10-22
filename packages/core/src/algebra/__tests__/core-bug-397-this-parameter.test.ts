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
import { describe, it, expect } from "vitest";
import {
  contractParamNameSet,
  formalParamDisplayNames,
  formalParamsFromNodes,
  formalParamSignatureNames,
  locateContractParam,
} from "../param-surface.ts";
import { generalizeFromAst } from "../generalize.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

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
