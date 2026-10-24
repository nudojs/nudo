/**
 * Bug 727 — re-export 边在 references / rename 面不可见。
 *
 * 症状：`export { a } from "./m.js"` 这条边在符号表里根本没被建立 ⇒
 * 引用面看不到 m.js ⇒ 改名只改本地 ⇒ 目标模块没同步 ⇒ 模块图断裂
 * （m.js 改了名、main.js 的 re-export 原样不动 ⇒ SyntaxError）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, locationsOf, editsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const M = `export const a = "TAG";
export function helper() {
  return a;
}
`;
const MAIN = `export { a } from "./m.js";

export function use() {
  return a;
}
`;

describe("Bug 727 — re-export 边的引用面与改名", () => {
  it("从 re-export 位置发起 references 覆盖目标模块的定义与内部引用", async () => {
    h = await startLspWithFiles({ "m.js": M, "main.js": MAIN });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("main.js") },
        position: { line: 0, character: 9 }, // export { a } from "./m.js"
        context: { includeDeclaration: true },
      }),
    );
    // m.js 的定义位点
    expect(refs).toContainEqual({
      file: "m.js",
      line: 0,
      character: 13,
      endLine: 0,
      endCharacter: 14,
    });
    // m.js 内部 helper() 里的引用
    expect(refs).toContainEqual({
      file: "m.js",
      line: 2,
      character: 9,
      endLine: 2,
      endCharacter: 10,
    });
  });

  it("从目标模块的定义处发起 references 覆盖 re-export 位点", async () => {
    h = await startLspWithFiles({ "m.js": M, "main.js": MAIN });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("m.js") },
        position: { line: 0, character: 13 }, // export const a
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "main.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 10,
    });
  });

  it("从 re-export 位置发起 rename 同步改目标模块", async () => {
    h = await startLspWithFiles({ "m.js": M, "main.js": MAIN });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("main.js") },
        position: { line: 0, character: 9 },
        newName: "b",
      }),
    );
    // m.js 的定义 + 内部引用
    expect(edits).toContainEqual({
      file: "m.js",
      line: 0,
      character: 13,
      endLine: 0,
      endCharacter: 14,
      newText: "b",
    });
    expect(edits).toContainEqual({
      file: "m.js",
      line: 2,
      character: 9,
      endLine: 2,
      endCharacter: 10,
      newText: "b",
    });
    // main.js 的 re-export 位点
    expect(edits).toContainEqual({
      file: "main.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 10,
      newText: "b",
    });
  });
});
