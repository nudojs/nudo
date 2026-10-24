/**
 * Bug 728 — 侧车里**对契约毫无作用**的绑定被当成契约定义。
 *
 * 症状：`lib.nudo.js` 里 `export const positive = number().gt(0)`（值模板）
 * 不是引擎消费的契约形态（引擎只消费 `fn({ … }, …)` 形态的导出绑定，
 * 见 packages/core/src/algebra/interface.ts），但 F12 仍跳到它 ⇒ 用户
 * 改多少都不会生效（与 hover / codeLens 的 imp、CLI 的 [implicit] 矛盾）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startLspWithFiles, locationsOf, type LspHarness } from "./lsp-bug-d3-harness.ts";

let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const LIB = `export function positive(x) {
  return x > 0;
}
`;
/** 值模板：引擎不消费（not fn() form） */
const LIB_SIDECAR_VALUE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;
const LIB2 = `export function good(x) {
  return x > 0;
}
`;
/** fn() 形态：引擎消费的有效契约 */
const LIB2_SIDECAR_FN = `import { fn, number } from "@nudojs/core";
export const good = fn({ x: number().gt(0) }, number());
`;

describe("Bug 728 — 侧车契约定义只认引擎真正消费的绑定", () => {
  it("值模板绑定不得被当成契约定义", async () => {
    h = await startLspWithFiles({
      "lib.js": LIB,
      "lib.nudo.js": LIB_SIDECAR_VALUE,
    });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("lib.js") },
        position: { line: 0, character: 16 }, // positive
      }),
    );
    expect(defs.filter((d) => d.file === "lib.nudo.js")).toEqual([]);
    // 本地定义仍在
    expect(defs[0]?.file).toBe("lib.js");
  });

  it("fn() 形态的导出绑定仍是契约定义（不得误伤）", async () => {
    h = await startLspWithFiles({
      "lib2.js": LIB2,
      "lib2.nudo.js": LIB2_SIDECAR_FN,
    });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("lib2.js") },
        position: { line: 0, character: 16 }, // good
      }),
    );
    expect(defs).toContainEqual({
      file: "lib2.nudo.js",
      line: 1,
      character: 13,
      endLine: 1,
      endCharacter: 17,
    });
  });
});
