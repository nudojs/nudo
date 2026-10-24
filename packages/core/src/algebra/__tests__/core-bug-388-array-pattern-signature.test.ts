/**
 * Bug 388 —— 数组解构形参在签名面被渲染成对象解构 `{ x, y }`。
 *
 * 根因：`FormalParam.kind === "pattern"` 同时覆盖 `ObjectPattern` 与
 * `ArrayPattern`，模型层**不记录模式种类** ⇒ 渲染层没有区分依据，一律输出
 * `{ … }`（数组解构的签名面看得出是对象）。
 *
 * 修法（族 08 · S3）：`FormalParam` 的 pattern 变体加 `patternKind`
 * （`"object"` / `"array"`），`formalParamSignatureNames` 按种类渲染。
 *
 * 反向钉：HEAD（未修）上 `patternKind` 为 undefined、签名渲染是 `{ x, y }`
 * ⇒ 本文件的两条渲染断言**必失败**。
 */
import { describe, it, expect } from "vitest";
import {
  formalParamsFromNodes,
  formalParamSignatureNames,
} from "../param-surface.ts";
import { generalizeFromAst } from "../generalize.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

/** 数组解构 AST：`[x, y]` */
const arrayPatternNode = {
  type: "ArrayPattern",
  elements: [
    { type: "Identifier", name: "x" },
    { type: "Identifier", name: "y" },
  ],
};

/** 对象解构 AST：`{ a, b }` */
const objectPatternNode = {
  type: "ObjectPattern",
  properties: [
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "a" },
      value: { type: "Identifier", name: "a" },
    },
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "b" },
      value: { type: "Identifier", name: "b" },
    },
  ],
};

describe("Bug 388 array pattern signature rendering", () => {
  it("array destructured param records pattern kind array", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(formals).toHaveLength(1);
    expect(formals[0]).toMatchObject({ kind: "pattern", patternKind: "array" });
  });

  it("object destructured param records pattern kind object", () => {
    const formals = formalParamsFromNodes([objectPatternNode] as never);
    expect(formals[0]).toMatchObject({ kind: "pattern", patternKind: "object" });
  });

  it("array pattern renders as [ x, y ] not { x, y }", () => {
    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(formalParamSignatureNames(formals)).toEqual(["[ x, y ]"]);
  });

  it("object pattern still renders as { a, b }", () => {
    const formals = formalParamsFromNodes([objectPatternNode] as never);
    expect(formalParamSignatureNames(formals)).toEqual(["{ a, b }"]);
  });

  it("generalize keeps array pattern signature name", () => {
    const g = generalizeFromAst("f", "export function f([x, y]) { return x + y; }\n");
    expect(g?.params).toEqual(["_p0"]);
    expect(formalParamSignatureNames(g?.formals ?? [])).toEqual(["[ x, y ]"]);
  });

  it("check signature line shows the array pattern", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const r = checkSource(
      "/t/f.js",
      "export function f([x, y]) { return x + y; }\n",
      pTrue,
      {},
    );
    expect(r.signatures.map((s) => s.params)).toEqual([["[ x, y ]"]]);
  });
});
