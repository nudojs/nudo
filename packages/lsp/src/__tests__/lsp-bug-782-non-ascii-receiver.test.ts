/**
 * Bug 782 — 成员补全对**非 ASCII 接收者**失效。
 *
 * 症状：接收者匹配正则只认 `\w`（ASCII）⇒ `对象.` 匹配失败 ⇒ 回落成
 * **顶层变量表**（`obj` / `对象` / `useAscii` / …），而该对象的成员
 * `alpha` / `beta` 一个都没有 ⇒ 看起来合理、实则完全答非所问。
 *
 * 期望：非 ASCII 接收者与 ASCII 接收者**同口径**——给出该对象的成员。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  `const obj = { alpha: 1, beta: "x" };`,
  `const 对象 = { alpha: 1, beta: "x" };`,
  ``,
  `export function useAscii() {`,
  `  return obj.alpha;`,
  `}`,
  ``,
  `export function useCjk() {`,
  `  return 对象.alpha;`,
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

describe("Bug 782 — 非 ASCII 接收者的成员补全", () => {
  it("CJK 接收者：给出该对象的成员（不是顶层变量表）", async () => {
    await withLspServer({ "cjk.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("cjk.js"), "return 对象.alpha");
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });

  it("ASCII 接收者：同口径（对照组——不得被一起改坏）", async () => {
    await withLspServer({ "cjk.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("cjk.js"), "return obj.alpha");
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });

  it("尾随点形态（`对象.`）：源码消毒也得认非 ASCII ⇒ 仍有成员", async () => {
    // 尾随点使 buffer 文本语法非法 ⇒ 分析走「尾点消毒」后的源码；
    // 消毒器的标识符捕获组 ASCII-only 时不会消毒 `对象.` ⇒ 整文件分析抛
    // ⇒ 绑定面为空 ⇒ 成员补全清零（782 的第二处根因）。
    const dotSrc = [
      `const 对象 = { alpha: 1, beta: "x" };`,
      ``,
      `export function useCjkDot() {`,
      `  return 对象.`,
      `}`,
    ].join("\n");
    await withLspServer({ "dot.js": dotSrc }, async ({ req, uri }) => {
      const lines = dotSrc.split("\n");
      const line = lines.findIndex((l) => l.includes("return 对象."));
      expect(line).toBeGreaterThanOrEqual(0);
      const items = await req("textDocument/completion")({
        textDocument: { uri: uri("dot.js") },
        position: { line, character: lines[line]!.indexOf("对象.") + "对象.".length },
      });
      const labels = (items as { label: string }[]).map((i) => i.label);
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });
});
