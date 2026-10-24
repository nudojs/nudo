/**
 * Bug 723：标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。
 *
 * 症状：`const \u0061bc = 1;` 里 `Identifier.name` 是解码后的 `abc`（3），
 * 但源码写法 `\u0061bc` 是 **8** 个字符 ⇒ token 只盖住转义序列前半截，
 * 客户端高亮错位。
 *
 * 期望：token 长度 = **源码跨度**（`loc.end.column - loc.start.column`），
 * char = 源码起始列，两者同为 UTF-16 code unit。
 */
import { describe, expect, it } from "vitest";
import { buildSemanticTokens, SEMANTIC_TOKEN_TYPES } from "../semantic-tokens.ts";
import { decodeSemanticTokens } from "./lsp-bug-d4-harness.ts";

const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");

describe("Bug 723 — 转义标识符的 token 长度按源码跨度", () => {
  it("`\\u0061bc` 的 token 覆盖整个源码写法（8 个 UTF-16 code unit）", () => {
    const tokens = decodeSemanticTokens(
      buildSemanticTokens("/tmp/nudo-bug-723.js", "export const \\u0061bc = 1;\n"),
    );
    expect(tokens).toEqual([
      { line: 0, char: 13, length: 8, typeIndex: TYPE_VARIABLE, modifiers: 1 },
    ]);
  });

  it("普通标识符长度不变（名字 == 源码写法）", () => {
    const tokens = decodeSemanticTokens(
      buildSemanticTokens("/tmp/nudo-bug-723.js", "export const abc = 1;\n"),
    );
    expect(tokens).toEqual([
      { line: 0, char: 13, length: 3, typeIndex: TYPE_VARIABLE, modifiers: 1 },
    ]);
  });

  it("非 BMP 字符之后的位置按 UTF-16 code unit 记（emoji 占 2）", () => {
    // `export const o = { "😀": 1, x: 2 };` —— emoji 之前的列按 UTF-16 计
    const src = 'export const o = { "\u{1F600}": 1, x: 2 };\n';
    const tokens = decodeSemanticTokens(buildSemanticTokens("/tmp/nudo-bug-723.js", src));
    const x = tokens.find((t) => src.split("\n")[t.line]!.slice(t.char, t.char + 1) === "x");
    expect(x).toBeDefined();
    expect(x!.char).toBe(src.indexOf("x: 2"));
  });
});
