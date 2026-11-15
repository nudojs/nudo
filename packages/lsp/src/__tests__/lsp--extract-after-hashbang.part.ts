/**
 * Bug 742 —— Extract 在**顶层选区**时把新函数插到**文件第 0 字节** ⇒ 落到 hashbang
 * **之前** ⇒ Node 只认第一行的 `#!` 为 shebang ⇒ 产物
 * `SyntaxError: Invalid or unexpected token` ⇒ 文件不再是可执行脚本。
 *
 * 根因（`packages/lsp/src/extract-function.ts`）：顶层选区时 `containingFnBox.fn` 为空
 * ⇒ `insertAt` 落到兜底值 `{line:0, character:0}`（文件最开头），**不考虑文件前导区**
 * （hashbang / `"use strict"` 指令 / 前导注释）。
 *
 * 修法：顶层选区的插入点 = **选区语句的起点**（天然落在前导区之后）；
 * 没有锚点时退到「文件前导区之后」（`leadingSafeInsertPos`）。
 *
 * oracle（改前 → 改后）：
 *   改前 insertAt = {line:0, character:0} ⇒ newText 第 1 行是 `function extracted() {…}`，
 *        hashbang 被挤到第 5 行 ⇒ Babel: Unexpected token (5:0)
 *   改后 insertAt = {line:1, character:0} ⇒ hashbang 仍是第 1 行 ⇒ 产物可解析。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { extractFunction } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

const SRC = `#!/usr/bin/env node
const value = compute();
export function f(a) {
  return a + value;
}
`;

/** 选区 = 第 2 行（0 基）的 `const value = compute();` */
const SEL = { start: { line: 1, character: 0 }, end: { line: 1, character: 24 } };

describe("Bug 742 · 顶层选区的 Extract 跳过文件前导区（hashbang）", () => {
  it("插入点在 hashbang 之后（不是文件第 0 字节）", () => {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 {line:0, character:0}
    expect(r.insertAt).toEqual({ line: 1, character: 0 });
  });

  it("产物里 hashbang 仍是第 1 行（可解析、可执行）", () => {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newText.split("\n")[0]).toBe("#!/usr/bin/env node");
    // 改前：Unexpected token (5:0)
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("协议面：codeAction 下发的文本第 1 行仍是 shebang", async () => {
    await withLspServer({ "m.mjs": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText.split("\n")[0]).toBe("#!/usr/bin/env node");
      expect(() => parse(newText)).not.toThrow();
    });
  });
});
