/**
 * Bug 768 —— `nudo/hover` 的位置入参**零校验**：
 *
 * 1. `line` 传字符串（`"2"`）等非法值时，工具**原样回显**并把分析字段全落
 *    `null` —— 调用方分不清「此处没有 hover」与「我传的参数类型不对」。
 *    ⇒ 非法位置参数 ⇒ 工具错误（`isError: true`）。
 * 2. `column` 缺省时载荷里**没有** `column` 键 —— 与文档承诺的
 *    `{ file, line, column, … }` 形状不符。
 *    ⇒ `column` 缺省 0（键恒在）；给了但不是 0-based 整数 ⇒ 工具错误。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = ["export function inner() {", "  const v = 7;", "  return v;", "}", ""].join("\n");

describe("Bug 768：nudo/hover 位置入参校验 + column 键恒在", () => {
  it("非法 line / column ⇒ 工具错误；缺省 column ⇒ 载荷带 column 键", async () => {
    await withLspServer({ "a4-768.js": SRC }, async ({ req, uri }) => {
      const file = uri("a4-768.js");

      // ① 非法 line（字符串）⇒ 失败，不再原样回显
      const badLine = await req("nudo/hover")({ file, line: "2", column: 2 });
      expect(badLine.isError).toBe(true);
      expect(badLine.content[0].text).toContain("line must be a 1-based integer");

      // ② line 缺失 ⇒ 失败
      const noLine = await req("nudo/hover")({ file });
      expect(noLine.isError).toBe(true);

      // ③ 非法 column（负数）⇒ 失败
      const badColumn = await req("nudo/hover")({ file, line: 2, column: -1 });
      expect(badColumn.isError).toBe(true);
      expect(badColumn.content[0].text).toContain("column must be a 0-based integer");

      // ④ column 缺省 ⇒ 成功面，载荷的 column 键恒在（缺省 0）
      const noColumn = await req("nudo/hover")({ file, line: 2 });
      expect(noColumn.isError).toBeFalsy();
      const payload = JSON.parse(noColumn.content[0].text);
      expect(Object.keys(payload)).toContain("column");
      expect(payload.column).toBe(0);
      expect(payload.line).toBe(2);
    });
  });
});
