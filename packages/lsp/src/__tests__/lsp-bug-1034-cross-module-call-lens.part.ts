/**
 * Bug 1034：跨模块调用点（`call@`）在调用方文件的 LSP CodeLens 面上整段消失。
 *
 * 症状（真 server 协议面）：
 * - `lib.js` 导出 `add`，`main.js` 里 `import { add } from "./lib.js"` 后调用
 *   `add(x, 2)` —— `main.js` 的 `textDocument/codeLens` **没有** `call@L4` 观察层；
 * - 同一文件内的调用（同文件 `add`）却有 `call@L6` lens；
 * - 而 CLI `nudo test main.js` **已经**打印
 *   `--- …/lib.js (imported) ---` / `=== add ===` / `call@L4 …` ——
 *   产品面有事实，LSP 面没有投影。
 *
 * 根因：`computeObservationLenses` 只消费 `analysis.functions`（本文件函数），
 * 没消费 `analysis.externalFunctions`（跨模块调用点事实）。
 *
 * 期望：调用方文件的 CodeLens 出现与 CLI 同形的 `call@L4` lens；
 * 且外部函数的 entry@ 属于被导入模块，**不得**在调用方文件落镜。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const LIB_SRC = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "",
].join("\n");

const CROSS_MAIN_SRC = [
  'import { add } from "./lib.js";',
  "",
  "export function run(x) {",
  "  return add(x, 2);",
  "}",
  "",
].join("\n");

const SAME_FILE_SRC = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function run(x) {",
  "  return add(x, 2);",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

const callLenses = (lenses: Lens[]): Lens[] =>
  lenses.filter((l) => l.command?.title.startsWith("call@"));

describe("Bug 1034 — 跨模块调用点的 call@ 观察 lens", () => {
  it("调用方文件的 codeLens 出现跨模块 call@ lens", async () => {
    await withLspServer(
      { "lib.js": LIB_SRC, "main.js": CROSS_MAIN_SRC },
      async ({ req, uri }) => {
        const lenses = req("textDocument/codeLens")({
          textDocument: { uri: uri("main.js") },
        }) as Lens[];
        const calls = callLenses(lenses);
        expect(calls.length).toBe(1);
        expect(calls[0]!.command!.title).toBe("call@L4  (any, 2) => number | string");
        // 追踪目标 = 被导入的函数名（与 CLI `=== add ===` 同形）
        expect(calls[0]!.command!.arguments?.[1]).toBe("add");
        // 落在调用点行（1-based 行 4 ⇒ 0-based 行 3）
        expect(calls[0]!.range.start.line).toBe(3);
      },
    );
  });

  it("外部函数的 entry@ 不在调用方文件落镜（属被导入模块）", async () => {
    await withLspServer(
      { "lib.js": LIB_SRC, "main.js": CROSS_MAIN_SRC },
      async ({ req, uri }) => {
        const lenses = req("textDocument/codeLens")({
          textDocument: { uri: uri("main.js") },
        }) as Lens[];
        // main.js 里只应有 run 的 entry@，不得出现 add 的 entry@
        const entries = lenses.filter((l) => l.command?.title.startsWith("entry@"));
        expect(entries.length).toBe(1);
        expect(entries[0]!.command!.arguments?.[1]).toBe("run");
      },
    );
  });

  it("回归护栏：同文件调用点的 call@ lens 形状不变", async () => {
    await withLspServer({ "same.js": SAME_FILE_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("same.js") },
      }) as Lens[];
      const calls = callLenses(lenses);
      expect(calls.length).toBe(1);
      expect(calls[0]!.command!.title).toBe("call@L6  (any, 2) => number | string");
      expect(calls[0]!.range.start.line).toBe(5);
    });
  });
});
