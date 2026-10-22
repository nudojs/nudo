/**
 * Bug 721：解构绑定被上成 property；对象字面量简写 `{ x }` 被当属性定义。
 *
 * 症状（真 server semanticTokens/full）：
 * - `export const { a, b } = obj;` 的 `a` / `b` → property 档（应是 variable 绑定）；
 * - `export const obj = { x, y: 2 };` 的 `x`（简写引用）→ property 档 **且带
 *   declaration modifier**（它是对变量的引用，不是属性定义）。
 *
 * 期望：
 * - 对象解构的**绑定名** → variable（declaration）；
 * - 对象字面量简写 `{ x }` → variable，**不带** declaration modifier；
 * - 真正的属性定义 `y: 2` → property（declaration 不变）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestSemanticTokens } from "./lsp-bug-d4-harness.ts";
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from "../semantic-tokens.ts";

const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");
const TYPE_PROPERTY = SEMANTIC_TOKEN_TYPES.indexOf("property");
const MOD_DECLARATION = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("declaration");

describe("Bug 721 — 解构绑定 / 简写引用的语义 token", () => {
  it("对象解构绑定 → variable（declaration）", async () => {
    const src = "export const { a, b } = obj;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-721/a.js");
    const tokens = requestSemanticTokens(mock, uri);
    expect(tokens).toEqual([
      { line: 0, char: 15, length: 1, typeIndex: TYPE_VARIABLE, modifiers: MOD_DECLARATION },
      { line: 0, char: 18, length: 1, typeIndex: TYPE_VARIABLE, modifiers: MOD_DECLARATION },
    ]);
  });

  it("对象字面量简写 `{ x }` → variable 且不带 declaration modifier", async () => {
    const src = "const x = 1;\nexport const obj = { x, y: 2 };\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-721/b.js");
    const tokens = requestSemanticTokens(mock, uri);
    const shorthand = tokens.find((t) => t.line === 1 && t.char === 21);
    expect(shorthand).toBeDefined();
    expect(shorthand!.typeIndex).toBe(TYPE_VARIABLE);
    expect(shorthand!.modifiers & MOD_DECLARATION).toBe(0);
    // 真正的属性定义仍是 property + declaration
    const prop = tokens.find((t) => t.line === 1 && t.char === 24);
    expect(prop).toBeDefined();
    expect(prop!.typeIndex).toBe(TYPE_PROPERTY);
    expect(prop!.modifiers & MOD_DECLARATION).toBe(MOD_DECLARATION);
  });
});
