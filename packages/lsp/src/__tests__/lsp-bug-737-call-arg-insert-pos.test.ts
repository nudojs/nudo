/**
 * Bug 737 —— A6「Add missing field 'X' to call」的插入点用**行内文本启发式**
 * 定位（`indexOf("{")` + 行内 `{` 计数 == 1）⇒ 诊断所在行的第一个 `{` 落在
 * **字符串 / 模板串**里时，字段被插进字面量内部 ⇒ 源码语义被改坏。
 *
 * 钉：插入点由 **AST** 定位（诊断所在调用的对象字面量实参的 `{` 之后），
 * 字符串字面量里的 `{` 不再被当成插入点。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  applyEdits,
  codeActionParams,
  docEdits,
  missingFieldDiag,
  mountCodeActions,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

/** 调用起始行只有一个 `{`，且它在字符串字面量里；对象字面量的 `{` 在下一行 */
const GREET_JS_737 = `export function greet(u) {
  return u.name + "!";
}

greet("a{b",
  { id: 1 });
`;
const GREET_SC = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;

describe("Bug 737 · 调用点插入点必须是对象字面量实参（不是字符串里的 `{`）", () => {
  it("插入点落进对象字面量，字符串字面量原样保留", () => {
    withTempDir("nudo-lsp-737-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS_737, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS_737);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = docEdits(actions, uri);
      expect(edits.length).toBe(1);
      const e = edits[0]!;
      // 对象字面量的 `{` 在第 5 行第 2 列 ⇒ 插入点 = 第 5 行第 3 列
      expect(e.range.start).toEqual({ line: 5, character: 3 });
      const applied = applyEdits(GREET_JS_737, edits);
      // 字符串字面量没被插字段
      expect(applied).toContain('greet("a{b",');
      expect(applied).not.toContain('"a{ name');
      // 字段落进对象字面量
      expect(applied).toContain("{ name: null,  id: 1 });");
    });
  });

  it("同一行既有字符串 `{` 又有对象字面量时也落进对象字面量", () => {
    const src = `export function greet(u) {
  return u.name + "!";
}

greet("{", { id: 1 });
`;
    withTempDir("nudo-lsp-737b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), src, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, src);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = docEdits(actions, uri);
      expect(edits.length).toBe(1);
      const applied = applyEdits(src, edits);
      expect(applied).toContain('greet("{", { name: null,  id: 1 });');
    });
  });
});
