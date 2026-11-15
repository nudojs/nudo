/**
 * Bug 771 — union（sum）接收者的补全**跳过「零成员」的那一支**。
 *
 * 症状：`u = { x, y } | 5`（对象臂 | **原始值臂**）在 `u.` 处给出 `x` / `y`
 * ⇒ 用户接受补全后 `u.x` 在原始值臂上是 TypeError（补全 detail 只显示对象臂
 * 的类型，静默误导）。
 *
 * 期望：sum 接收者的候选是**各臂的交集**——原始值臂**没有任何属性**
 * ⇒ 交集必空 ⇒ `u.` 无候选。
 *
 * 反向护栏：两臂都是对象（`{x,y} | {x}`）⇒ 交集 = `x`（不能被一起清零）。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  `const aObj = { x: 1, y: 9 };`,
  `const uPrim = Math.random() > 0.5 ? aObj : 5;`,
  `const uStr = Math.random() > 0.5 ? aObj : "str";`,
  `const uObj = Math.random() > 0.5 ? aObj : { x: 3 };`,
  ``,
  `export function usePrim() {`,
  `  return uPrim.x;`,
  `}`,
  `export function useStr() {`,
  `  return uStr.x;`,
  `}`,
  `export function useObj() {`,
  `  return uObj.x;`,
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

async function labelsAt(
  req: (method: string) => (params: any) => any,
  uri: string,
  needle: string,
): Promise<string[]> {
  const pos = cursorAfter(SRC, needle);
  const items = await req("textDocument/completion")({
    textDocument: { uri },
    position: pos,
  });
  return (items as { label: string }[]).map((i) => i.label);
}

describe("Bug 771 — sum 接收者：原始值臂让交集判空", () => {
  it("对象臂 | 原始值臂 ⇒ 无候选（取属性在原始值臂上是 TypeError）", async () => {
    await withLspServer({ "union.js": SRC }, async ({ req, uri }) => {
      expect(await labelsAt(req, uri("union.js"), "return uPrim.x")).toEqual([]);
    });
  });

  it("对象臂 | 字符串臂 ⇒ 无候选（字符串臂有内建成员，交集为空）", async () => {
    await withLspServer({ "union.js": SRC }, async ({ req, uri }) => {
      expect(await labelsAt(req, uri("union.js"), "return uStr.x")).toEqual([]);
    });
  });

  it("两臂都是对象 ⇒ 交集仍是公共成员 x（不能被一起清零）", async () => {
    await withLspServer({ "union.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("union.js"), "return uObj.x");
      expect(labels).toContain("x");
      expect(labels).not.toContain("y");
    });
  });
});
