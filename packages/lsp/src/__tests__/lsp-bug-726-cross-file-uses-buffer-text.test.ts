/**
 * Bug 726 — 跨文件导航读**磁盘**文本，而不是编辑器 buffer。
 *
 * 症状：def.js 已被编辑（未保存）⇒ 磁盘上还是旧内容 ⇒ F12 / references /
 * rename 全部按磁盘坐标给位点 ⇒ 跳错行、改名改坏用户代码（两套坐标）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, locationsOf, editsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function oldName(n) {
  return n + 1;
}
`;
const USE = `import { oldName } from "./def.js";

export function use() {
  return oldName(1);
}
`;
/** 未保存的 buffer：多一行注释 ⇒ 导出声明被顶到第 2 行（1 基） */
const DEF_BUFFER = `// unsaved edit
export function oldName(n) {
  return n + 1;
}
`;

describe("Bug 726 — 跨文件导航必须用打开文档的 buffer", () => {
  it("definition 落在 buffer 坐标（磁盘坐标会跳错行）", async () => {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await new Promise((r) => setTimeout(r, 100));
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 0, character: 9 }, // import { oldName }
      }),
    );
    expect(defs).toContainEqual({
      file: "def.js",
      line: 1, // buffer 里的第 2 行（0 基）
      character: 16,
      endLine: 1,
      endCharacter: 23,
    });
  });

  it("references 落在 buffer 坐标", async () => {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await new Promise((r) => setTimeout(r, 100));
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 3, character: 9 }, // oldName(1)
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "def.js",
      line: 1,
      character: 16,
      endLine: 1,
      endCharacter: 23,
    });
  });

  it("rename 的编辑落在 buffer 坐标", async () => {
    h = await startLspWithFiles({ "def.js": DEF, "use.js": USE });
    h.changeBuffer("def.js", DEF_BUFFER);
    await new Promise((r) => setTimeout(r, 100));
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("use.js") },
        position: { line: 3, character: 9 },
        newName: "brandNew",
      }),
    );
    expect(edits).toContainEqual({
      file: "def.js",
      line: 1,
      character: 16,
      endLine: 1,
      endCharacter: 23,
      newText: "brandNew",
    });
  });
});
