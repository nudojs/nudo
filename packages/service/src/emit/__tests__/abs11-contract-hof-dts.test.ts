/**
 * ABS-11（投影层）：契约 × HOF 关系合取。
 *
 * 写手写契约只覆盖部分形参时，未覆盖位与返回位必须保留 HOF 的 β 链接
 * （entryShapes / fnRels 的 α 按结构对齐绑定到契约 Abs），不得静默退化成
 * unknown。合取判据同 `contractOnlySignature` / `computeMainSignature`。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { abs as makeAbs, v } from "@nudojs/core";
import { projectFunctionDts, type DtsContractFace } from "../dts-generator.ts";

const source = `export function processItems(items, transform) { return items.map(transform); }`;

function fnAnalysis() {
  const r = analyzeFile("/test/abs11.js", source);
  const f = r.functions.find((x) => x.name === "processItems");
  if (!f) throw new Error("function not found");
  return f;
}

const itemsContract: DtsContractFace = {
  params: [
    {
      name: "items",
      abs: makeAbs(
        { k: "arr", element: makeAbs({ k: "prim", type: "number" }, undefined, undefined, "path") },
        v("items"),
        undefined,
        "path",
      ),
      display: "array(number())",
    },
  ],
};

describe("ABS-11 dts 契约 × HOF 合取", () => {
  it("契约覆盖 items 后，transform 与返回位仍保留 β 链接（不退化成 unknown）", () => {
    const proj = projectFunctionDts(fnAnalysis(), itemsContract);
    const decl = proj.lines.join("\n");
    expect(decl).toContain("items: number[]");
    expect(decl).toContain("transform: (x0: number) => B_transform");
    expect(decl).toContain(": B_transform[]");
    expect(decl).not.toContain("transform: unknown");
  });

  it("不写契约的基线同样保留泛型（合取不改变未覆盖位）", () => {
    const proj = projectFunctionDts(fnAnalysis(), undefined);
    const decl = proj.lines.join("\n");
    expect(decl).toMatch(/<[A-Za-z0-9_, ]+>/);
    expect(decl).not.toContain("transform: unknown");
  });
});
