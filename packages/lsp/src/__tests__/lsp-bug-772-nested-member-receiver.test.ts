/**
 * Bug 772 — 成员补全把嵌套成员访问的接收者取成「最后一段标识符」。
 *
 * 症状：`a = { b: { right: 2 } }` 且模块级另有 `b = { wrong: 1 }` 时，
 * `a.b.` 的候选是**顶层绑定 `b`** 的成员（`wrong`）——`a.b` 上根本没有这个
 * 成员 ⇒ 用户接受补全会得到运行时 `undefined`。
 *
 * 期望：接收者按**整条成员访问链**解析（`a.b`）⇒ 候选 = `a.b` 的成员。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  `export const b = { wrong: 1 };`,
  `export const a = { b: { right: 2 } };`,
  ``,
  `export function useNested() {`,
  `  return a.b.right;`,
  `}`,
].join("\n");

/** 光标位置：needle（已写出的接收者 + 成员前缀）之后。 */
function cursorAfter(src: string, needle: string): { line: number; character: number } {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf(needle);
    if (c >= 0) return { line: i, character: c + needle.length };
  }
  throw new Error(`needle not found: ${needle}`);
}

describe("Bug 772 — 嵌套成员访问的接收者是整条路径", () => {
  it("a.b. 的候选是 a.b 的成员，不是同名顶层绑定的成员", async () => {
    await withLspServer({ "nested.js": SRC }, async ({ req, uri }) => {
      const lines = SRC.split("\n");
      let line = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes("return a.b.right")) {
          line = i;
          break;
        }
      }
      expect(line).toBeGreaterThanOrEqual(0);
      const pos = cursorAfter(SRC, "return a.b.right");
      const items = await req("textDocument/completion")({
        textDocument: { uri: uri("nested.js") },
        position: pos,
      });
      const labels = (items as { label: string }[]).map((i) => i.label);
      expect(labels).toContain("right");
      expect(labels).not.toContain("wrong");
    });
  });

  it("三层以上（a.b.c.）：接收者仍是整条链", async () => {
    const deepSrc = [
      `export const c = { wrong: 1 };`,
      `export const b = { c: { deep: 2 } };`,
      `export const a = { b: { c: { deep: 2 } } };`,
      ``,
      `export function useDeep() {`,
      `  return a.b.c.deep;`,
      `}`,
    ].join("\n");
    await withLspServer({ "deep.js": deepSrc }, async ({ req, uri }) => {
      const lines = deepSrc.split("\n");
      const line = lines.findIndex((l) => l.includes("return a.b.c.deep"));
      expect(line).toBeGreaterThanOrEqual(0);
      const items = await req("textDocument/completion")({
        textDocument: { uri: uri("deep.js") },
        position: {
          line,
          character: lines[line]!.indexOf("a.b.c.deep") + "a.b.c.deep".length,
        },
      });
      const labels = (items as { label: string }[]).map((i) => i.label);
      expect(labels).toContain("deep");
      expect(labels).not.toContain("wrong");
    });
  });
});
