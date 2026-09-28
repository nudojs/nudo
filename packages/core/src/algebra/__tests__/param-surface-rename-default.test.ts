/**
 * 对象解构 `{a: b = 1}` 必须像 `{a: b}` 一样建立 propKey 映射。
 * 回归背景：rename 检查只认 Identifier，AssignmentPattern 直接进
 * collectPatternNames，只推绑定名 b、不写 propKey——契约写 a 时
 * locateContractParam 找不到字段，误报 nudo:interface-param-mismatch。
 */
import { describe, it, expect } from "vitest";
import {
  formalParamsFromNodes,
  contractParamNameSet,
  locateContractParam,
} from "../param-surface.ts";
import { generalizeFromAst } from "../generalize.ts";

describe("object pattern rename + default keeps propKey", () => {
  it("{a: b = 1} maps both a and b; contract b projects to field a", () => {
    const formals = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "a" },
            value: {
              type: "AssignmentPattern",
              left: { type: "Identifier", name: "b" },
              right: { type: "NumericLiteral", value: 1 },
            },
          },
        ],
      },
    ] as never);
    const names = contractParamNameSet(formals);
    expect(names.has("a")).toBe(true);
    expect(names.has("b")).toBe(true);
    expect(locateContractParam(formals, "a")).toMatchObject({ index: 0, field: "a" });
    expect(locateContractParam(formals, "b")).toMatchObject({ index: 0, field: "a" });
  });

  it("{a = 1} shorthand default still works", () => {
    const formals = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "a" },
            value: {
              type: "AssignmentPattern",
              left: { type: "Identifier", name: "a" },
              right: { type: "NumericLiteral", value: 1 },
            },
          },
        ],
      },
    ] as never);
    expect(contractParamNameSet(formals).has("a")).toBe(true);
    expect(locateContractParam(formals, "a")).toMatchObject({ index: 0, field: "a" });
  });

  it("{a: {b} = {}} nested default keeps outer key on nested names", () => {
    const formals = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "a" },
            value: {
              type: "AssignmentPattern",
              left: {
                type: "ObjectPattern",
                properties: [
                  {
                    type: "ObjectProperty",
                    key: { type: "Identifier", name: "b" },
                    value: { type: "Identifier", name: "b" },
                  },
                ],
              },
              right: { type: "ObjectExpression", properties: [] },
            },
          },
        ],
      },
    ] as never);
    const names = contractParamNameSet(formals);
    expect(names.has("b")).toBe(true);
  });

  it("generalize formals for {a: b = 1} expose field a on contract b", () => {
    const g = generalizeFromAst("f", "function f({a: b = 1}) { return b; }\n");
    expect(g?.formals?.[0]?.kind).toBe("pattern");
    const f = g!.formals![0] as { bound: string[]; propKey: Record<string, string> };
    expect(f.bound).toContain("b");
    expect(f.bound).toContain("a");
    expect(f.propKey["b"]).toBe("a");
  });
});
