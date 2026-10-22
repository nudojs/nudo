/**
 * Bug 714 回归钉：LSP `textDocument/references` 的
 * `context.includeDeclaration: false` **仍返回声明位点**。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   references on `v`（a 内），includeDeclaration=false
 *     → [1:8-1:9]（**a 里 v 的声明位**）、[2:9-2:10]（用点）❌
 *   （includeDeclaration 只作用于 `resolveReferences` 的那一个 `decl` 数组，
 *     管不到引用集合里的声明位）
 *
 * 根因：`collectBindingReferences` 无条件把绑定声明位（`binding.identifier`）
 * 收进引用集合 ⇒ `includeDeclaration` 只关掉了「另一处」的声明。
 *
 * 修法：`collectBindingReferences` 增加 `includeDeclaration` 入参（默认 true
 * —— 直接调用方的既有语义不变），由 `resolveReferences` 按
 * `context.includeDeclaration` 透传。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { collectBindingReferences } from "../symbols.ts";
import { withLspServer } from "./helpers.ts";

const SHADOW_SRC = `export function a() {
  const v = 1;
  return v;
}
`;

describe("Bug 714 — references 的 includeDeclaration:false 必须剔除声明位", () => {
  it("collectBindingReferences：includeDeclaration=false 不含声明位", () => {
    const ast = parse(SHADOW_SRC);
    const withDecl = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js");
    expect(withDecl.length).toBe(2);
    expect(withDecl.some((r) => r.loc.start.line === 2)).toBe(true);

    const withoutDecl = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js", {
      includeDeclaration: false,
    });
    expect(withoutDecl.length).toBe(1);
    expect(withoutDecl[0]!.loc.start.line).toBe(3);
  });

  it("collectBindingReferences：默认仍含声明位（既有语义不变，负控制）", () => {
    const ast = parse(SHADOW_SRC);
    const refs = collectBindingReferences(ast, "v", { line: 3, column: 10 }, "file:///t/s.js");
    expect(refs.some((r) => r.loc.start.line === 2)).toBe(true);
  });

  it("协议面：includeDeclaration=false 只返回用点", async () => {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const without = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: false },
      }) as any[];
      expect(Array.isArray(without)).toBe(true);
      expect(without.length).toBe(1);
      expect(without[0]!.range.start.line).toBe(2);
      expect(without[0]!.range.start.character).toBe(9);

      const with_ = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: true },
      }) as any[];
      // 负控制：includeDeclaration=true 时声明位必须在
      expect(with_.length).toBe(2);
      expect(with_.some((l) => l.range.start.line === 1)).toBe(true);
    });
  });
});
