/**
 * Bug 710 — 跨文件改名：别名 import 被改、import 说明符的 imported 侧没被改。
 *
 * 症状：`import { oldName as alias } from "./xf-def.js"` + 在 xf-def.js 改名
 * ⇒ 改出来是 `import { oldName as newName }`（imported 侧没动 ⇒ import 断链，
 * 模块加载即 SyntaxError），而**不该改的别名**被改了。
 *
 * 期望：imported 侧（`oldName`）被改成新名，别名 `alias` 保持不变。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, editsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function oldName(n) {
  return n + 1;
}
`;
const USE = `import { oldName as alias } from "./xf-def.js";

export function use() {
  return alias(1);
}
`;
const USE2 = `import { oldName } from "./xf-def.js";

export function use2() {
  return oldName(2);
}
`;

describe("Bug 710 — 别名 import 的跨文件改名口径", () => {
  it("改导出名时：imported 侧被改、别名不被改", async () => {
    h = await startLspWithFiles({ "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("xf-def.js") },
        position: { line: 0, character: 16 }, // oldName
        newName: "newName",
      }),
    );
    // xf-use.js：import 说明符的 imported 侧 oldName → newName
    expect(edits).toContainEqual({
      file: "xf-use.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 16,
      newText: "newName",
    });
    // xf-use.js：别名 alias 不得被改
    expect(
      edits.filter((e) => e.file === "xf-use.js" && e.character === 20),
    ).toEqual([]);
    // 别名的调用点也不得被改（本地名没变）
    expect(
      edits.filter((e) => e.file === "xf-use.js" && e.line === 3),
    ).toEqual([]);
    // xf-use2.js（无别名对照）：import 与调用点两处都改
    expect(edits).toContainEqual({
      file: "xf-use2.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 16,
      newText: "newName",
    });
    expect(edits).toContainEqual({
      file: "xf-use2.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 16,
      newText: "newName",
    });
  });

  it("改本地别名时：只改本地，不得连坐改目标模块的导出", async () => {
    h = await startLspWithFiles({ "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("xf-use.js") },
        position: { line: 0, character: 20 }, // alias
        newName: "newAlias",
      }),
    );
    expect(
      edits.filter((e) => e.file === "xf-def.js" || e.file === "xf-use2.js"),
    ).toEqual([]);
    expect(edits).toContainEqual({
      file: "xf-use.js",
      line: 0,
      character: 20,
      endLine: 0,
      endCharacter: 25,
      newText: "newAlias",
    });
    expect(edits).toContainEqual({
      file: "xf-use.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 14,
      newText: "newAlias",
    });
  });
});
