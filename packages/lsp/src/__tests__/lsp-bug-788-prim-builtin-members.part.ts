/**
 * Bug 788 — 成员补全的 **prim 分支只投影 `String`**。
 *
 * 症状：同一份文件、同一个补全面，只有 string 接收者有候选；
 * `num.`（number）与 `flag.`（boolean）**零候选**——而求值器的内建原型
 * 近似表里 `Number` / `Boolean` 的成员表**齐备**（引擎知道这些方法存在，
 * 补全面却给不出）。
 *
 * 期望：prim 按类型分派到对应的内建原型表
 * （number → Number / boolean → Boolean / bigint → BigInt / symbol → Symbol）。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  `const num = 42;`,
  `const flag = true;`,
  `const s = "abc";`,
  ``,
  `export function useNumVar() {`,
  `  return num.toF;`,
  `}`,
  ``,
  `export function useBoolVar() {`,
  `  return flag.toS;`,
  `}`,
  ``,
  `export function useStrVar() {`,
  `  return s.toU;`,
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

describe("Bug 788 — prim 接收者按类型分派到内建原型表", () => {
  it("number 接收者 ⇒ Number 的成员（不再是零候选）", async () => {
    await withLspServer({ "prim.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("prim.js"), "return num.toF");
      expect(labels.sort()).toEqual(["toFixed", "toPrecision", "toString", "valueOf"]);
    });
  });

  it("boolean 接收者 ⇒ Boolean 的成员（不再是零候选）", async () => {
    await withLspServer({ "prim.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("prim.js"), "return flag.toS");
      expect(labels.sort()).toEqual(["toString", "valueOf"]);
    });
  });

  it("string 接收者不受影响（对照组——String + length）", async () => {
    await withLspServer({ "prim.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("prim.js"), "return s.toU");
      expect(labels).toContain("toUpperCase");
      expect(labels).toContain("length");
    });
  });
});
