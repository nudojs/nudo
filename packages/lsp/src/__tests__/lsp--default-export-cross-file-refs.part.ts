/**
 * Bug 703 — export default 的跨文件 references 为空。
 *
 * 症状：definition 能跳到 default 导出的定义，references 却查不到任何调用方
 * （自相矛盾）。根因：跨文件引用匹配用的是**导出名**，而 default 导入的
 * importedName 是 "default"、被查符号的本地名是 "greet" ⇒ 永远匹配不上。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, locationsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const A = `export default function greet(n) {
  return n + 1;
}
`;
const B = `import greet from "./a.js";

export function use() {
  return greet(1);
}
`;

describe("Bug 703 — export default 的跨文件 references", () => {
  it("default 导出的定义处能查到 default 导入方的 import 说明符与调用点", async () => {
    h = await startLspWithFiles({ "a.js": A, "b.js": B });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("a.js") },
        position: { line: 0, character: 24 }, // export default function greet
        context: { includeDeclaration: true },
      }),
    );
    // 导入方的 import 说明符（default 导入的本地名 greet）
    expect(refs).toContainEqual({
      file: "b.js",
      line: 0,
      character: 7,
      endLine: 0,
      endCharacter: 12,
    });
    // 导入方的调用点
    expect(refs).toContainEqual({
      file: "b.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 14,
    });
  });

  it("default 导入方一侧发起 references 也能覆盖定义文件", async () => {
    h = await startLspWithFiles({ "a.js": A, "b.js": B });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("b.js") },
        position: { line: 0, character: 7 }, // import greet
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "a.js",
      line: 0,
      character: 24,
      endLine: 0,
      endCharacter: 29,
    });
  });
});
