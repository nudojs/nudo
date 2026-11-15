/**
 * Bug 713 — 成员属性（`obj.x` 的 x）F12 跳到工作区里无关文件的同名导出。
 *
 * 症状：`o.helper()` 的 helper 没有来源，却命中「同名导出兜底」跳到
 * 另一个文件里毫不相干的 `export function helper`。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, locationsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const OTHER = `export function helper() {
  return 1;
}
`;
const USER = `export function go(o) {
  return o.helper();
}
`;

describe("Bug 713 — 成员属性不触发同名导出兜底", () => {
  it("成员属性 helper 的 definition 不得跳到无关文件的同名导出", async () => {
    h = await startLspWithFiles({ "other.js": OTHER, "user.js": USER });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("user.js") },
        position: { line: 1, character: 15 }, // o.helper 的 helper
      }),
    );
    expect(defs.filter((d) => d.file === "other.js")).toEqual([]);
  });

  it("裸标识符仍能命中同名导出兜底（兜底本身没坏）", async () => {
    const other = `export function helper() {
  return 1;
}
`;
    const user = `export function go() {
  return helper();
}
`;
    h = await startLspWithFiles({ "other.js": other, "user.js": user });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("user.js") },
        position: { line: 1, character: 9 }, // 裸标识符 helper
      }),
    );
    expect(defs).toContainEqual({
      file: "other.js",
      line: 0,
      character: 16,
      endLine: 0,
      endCharacter: 22,
    });
  });
});
