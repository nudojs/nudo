/**
 * Bug 446 —— TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物不是合法 JS。
 *
 * 根因：strip-types.ts 的 `isTypeOnlyStatement` 语句级 switch 缺
 * `TSExportAssignment` / `TSNamespaceExportDeclaration` 两个 case ⇒ 这两条
 * TS-only 语句被原样打印进 `.js` ⇒ `node --check` ⇒ SyntaxError。
 *
 * 修法：switch 补这两个 case（两条语句被剥除）。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../index.ts";

const body = (src: string) => parseSource(src).program.body;

describe("Bug 446: TS-only 的模块出口语句被剥除", () => {
  it("export = X（TSExportAssignment）整条删除", () => {
    const b = body(`declare namespace N { const x: number; }\nexport = N;`);
    expect(b.map((n) => n.type)).not.toContain("TSExportAssignment");
    expect(b.some((n) => n.type === "TSExportAssignment")).toBe(false);
  });

  it("export as namespace X（TSNamespaceExportDeclaration）整条删除", () => {
    const b = body(`export as namespace MyGlobal;\nexport declare const v: number;`);
    expect(b.some((n) => n.type === "TSNamespaceExportDeclaration")).toBe(false);
  });

  it("export = 的右值（值引用）不产生残留语句", () => {
    const b = body(`const N = { x: 1 };\nexport = N;`);
    expect(b.map((n) => n.type)).toEqual(["VariableDeclaration"]);
  });

  it("纯 JS 源码不受影响（结构性 no-op）", () => {
    const b = body(`export const x = 1;\nexport default x;`);
    expect(b.map((n) => n.type)).toEqual(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);
  });
});
