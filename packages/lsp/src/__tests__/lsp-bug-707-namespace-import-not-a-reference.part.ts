/**
 * Bug 707 — 命名空间 import 的**裸** `ns` 出现处被当成具名导出的引用。
 *
 * 症状：`import * as ns from "./def.js"` 之后，def.js 里**从未被提及**的
 * 导出 alpha 的 references 里出现了 ns-user.js 的 `ns` 出现处（假引用）；
 * 真正用到的 `ns.beta` 反而不是 beta 的引用。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, locationsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function alpha(n) {
  return n + 1;
}
export function beta(n) {
  return n * 2;
}
`;
const USER = `import * as ns from "./ns-def.js";

export function go() {
  return ns.beta(1);
}
`;

describe("Bug 707 — 命名空间 import 的引用面", () => {
  it("未被命名空间引用的导出，其 references 不含命名空间导入方", async () => {
    h = await startLspWithFiles({ "ns-def.js": DEF, "ns-user.js": USER });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("ns-def.js") },
        position: { line: 0, character: 16 }, // alpha
        context: { includeDeclaration: true },
      }),
    );
    expect(refs.filter((r) => r.file === "ns-user.js")).toEqual([]);
  });

  it("命名空间成员访问 `ns.beta` 是 beta 的引用位点", async () => {
    h = await startLspWithFiles({ "ns-def.js": DEF, "ns-user.js": USER });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("ns-def.js") },
        position: { line: 3, character: 16 }, // beta
        context: { includeDeclaration: true },
      }),
    );
    // 成员属性 beta（不是裸 ns）
    expect(refs).toContainEqual({
      file: "ns-user.js",
      line: 3,
      character: 12,
      endLine: 3,
      endCharacter: 16,
    });
    // 裸 ns 不是引用
    expect(refs).not.toContainEqual({
      file: "ns-user.js",
      line: 0,
      character: 12,
      endLine: 0,
      endCharacter: 14,
    });
  });
});
