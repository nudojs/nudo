/**
 * Bug 787 — 成员补全的**接收者识别**失败时回落成顶层变量表。
 *
 * 症状：`(42).toF` / `(true).toS` / `"abc".toU` 这类**字面量 / 括号 / 字符串**
 * 接收者不被识别 ⇒ 协议层返回**顶层变量表**（`obj` / `useNum` / …）
 * ——不是「没有候选」，是**给出了完全无关的候选**；用户按 Tab 会插入
 * `obj` 之类的东西。
 *
 * 期望：识别成功 ⇒ 走内建原型表（Number / Boolean / String）；
 * 识别不出接收者 ⇒ **空列表**，绝不回落成顶层变量表。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  `const obj = { alpha: 1, beta: 2 };`,
  ``,
  `export function useObj() {`,
  `  return obj.a;`,
  `}`,
  ``,
  `export function useNum() {`,
  `  return (42).toF;`,
  `}`,
  ``,
  `export function useBool() {`,
  `  return (true).toS;`,
  `}`,
  ``,
  `export function useStr() {`,
  `  return "abc".toU;`,
  `}`,
].join("\n");

/** 顶层变量表里的名字——出现即说明回落错了分支。 */
const TOP_LEVEL = ["obj", "useObj", "useNum", "useBool", "useStr"];

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

describe("Bug 787 — 字面量 / 括号 / 字符串接收者走内建原型表", () => {
  it("数字字面量接收者 ⇒ Number 的成员，且不含顶层变量", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), "return (42).toF");
      expect(labels).toContain("toFixed");
      expect(labels).toContain("toPrecision");
      for (const name of TOP_LEVEL) expect(labels).not.toContain(name);
    });
  });

  it("布尔字面量接收者 ⇒ Boolean 的成员，且不含顶层变量", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), "return (true).toS");
      expect(labels).toContain("toString");
      expect(labels).toContain("valueOf");
      for (const name of TOP_LEVEL) expect(labels).not.toContain(name);
    });
  });

  it("字符串字面量接收者 ⇒ String 的成员，且不含顶层变量", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), 'return "abc".toU');
      expect(labels).toContain("toUpperCase");
      for (const name of TOP_LEVEL) expect(labels).not.toContain(name);
    });
  });

  it("对象接收者不受影响（对照组）", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), "return obj.a");
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });
});
