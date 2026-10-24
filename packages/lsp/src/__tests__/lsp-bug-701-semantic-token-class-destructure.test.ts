/**
 * Bug 701：语义 token 面漏标——类名 / 类方法 / 类字段 / 方法形参 / 解构绑定。
 *
 * 症状（真 server semanticTokens/full）：
 * - `export class K { m(p) {…} }` 只有 `p` 上色，`K` / `m` 全丢；
 * - `export const [x, y] = arr;` 完全没有 token；
 * - `export const { a, b } = obj;` 的 `a` / `b` 被标成 property（见 721）。
 *
 * 期望：
 * - 类名 → class 档；类方法键 → method；类字段键 → property；方法形参 → parameter；
 * - 数组解构元素 → variable；对象解构绑定 → variable。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestSemanticTokens } from "./lsp-bug-d4-harness.ts";
import { SEMANTIC_TOKEN_TYPES } from "../semantic-tokens.ts";

const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");
const TYPE_PARAMETER = SEMANTIC_TOKEN_TYPES.indexOf("parameter");
const TYPE_PROPERTY = SEMANTIC_TOKEN_TYPES.indexOf("property");
const TYPE_METHOD = SEMANTIC_TOKEN_TYPES.indexOf("method");
const TYPE_CLASS = SEMANTIC_TOKEN_TYPES.indexOf("class");

const SRC = [
  "export const { a, b } = obj;", // 0: a@15 b@18
  "export const [x, y] = arr;", // 1: x@14 y@17
  "export class K {", // 2: K@13
  "  m(p) { return p; }", // 3: m@2 p@4
  "  f = 1;", // 4: f@2
  "}",
  "",
].join("\n");

describe("Bug 701 — 类 / 解构 / 方法形参的语义 token", () => {
  it("真 server 返回完整 token 列表（位置 + 档位）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-701/a.js");
    const tokens = requestSemanticTokens(mock, uri);
    expect(tokens).toEqual([
      { line: 0, char: 15, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 0, char: 18, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 1, char: 14, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 1, char: 17, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 2, char: 13, length: 1, typeIndex: TYPE_CLASS, modifiers: 1 },
      { line: 3, char: 2, length: 1, typeIndex: TYPE_METHOD, modifiers: 1 },
      { line: 3, char: 4, length: 1, typeIndex: TYPE_PARAMETER, modifiers: 1 },
      { line: 4, char: 2, length: 1, typeIndex: TYPE_PROPERTY, modifiers: 1 },
    ]);
  });

  it("图例里有 class 档（只追加不重排 ⇒ 老索引不变）", () => {
    expect(SEMANTIC_TOKEN_TYPES[0]).toBe("function");
    expect(SEMANTIC_TOKEN_TYPES[1]).toBe("variable");
    expect(SEMANTIC_TOKEN_TYPES[10]).toBe("method");
    expect(SEMANTIC_TOKEN_TYPES[11]).toBe("class");
  });
});
