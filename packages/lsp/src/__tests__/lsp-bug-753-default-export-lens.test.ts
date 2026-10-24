/**
 * Bug 753：`export default function` 在 LSP CodeLens / inlayHint 面整段消失。
 *
 * 症状（真 server 协议面）：
 * - `textDocument/codeLens` 只有 entry@ 观察层，**没有** `● contract / imp`
 *   / `⚡ persist interface` / `⚡ draft interface` 三条 interface 档 lens；
 * - `textDocument/inlayHint` 没有 `● contract / imp` 投影
 *   （CodeLens 不可见的客户端靠它看到契约档）；
 * - 而 hover / documentSymbol / semanticTokens 面**都**能看到 `compute` ——
 *   枚举面与导出面分裂。
 *
 * 根因：`topLevelFunctionSlots`（agent-tools.ts）只认 `ExportNamedDeclaration`
 * 与裸声明，不认 `ExportDefaultDeclaration` —— 默认导出从未进入 interface 档
 * 的目标集。
 *
 * 期望：默认导出与具名导出在 CodeLens / inlayHint 面上同形。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const DEFAULT_EXPORT_SRC = [
  "export default function compute(n) {",
  "  return n + 1;",
  "}",
  "",
].join("\n");

const NAMED_EXPORT_SRC = [
  "export function compute(n) {",
  "  return n + 1;",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

describe("Bug 753 — export default function 的 interface 档 lens", () => {
  it("codeLens 出现默认导出的 interface 档（● contract / imp + 固化动作）", async () => {
    await withLspServer({ "a.js": DEFAULT_EXPORT_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const titles = lenses.map((l) => l.command?.title);
      expect(titles).toContain("● contract / imp");
      expect(titles).toContain("⚡ persist interface");
      expect(titles).toContain("⚡ draft interface");

      const contract = lenses.find((l) => l.command?.title === "● contract / imp")!;
      // 契约身份 = 本地名（core listTopFunctions / localNamedExports 同口径）
      expect(contract.command?.arguments?.[1]).toBe("compute");
      // lens 落在函数声明行（1-based 行 1 ⇒ 0-based 行 0）
      expect(contract.range.start.line).toBe(0);

      const draft = lenses.find((l) => l.command?.title === "⚡ draft interface")!;
      expect(draft.command?.arguments?.[1]).toBe("compute");
    });
  });

  it("inlayHint 出现默认导出的 interface 档投影（CodeLens 不可见客户端）", async () => {
    await withLspServer({ "a.js": DEFAULT_EXPORT_SRC }, async ({ req, uri }) => {
      const hints = req("textDocument/inlayHint")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 10, character: 0 },
        },
      }) as Array<{ position: { line: number }; label: string }>;
      const labels = hints.map((h) => h.label);
      expect(labels).toContain("  ● contract / imp");
      // 契约档 inlay 落在函数声明行
      const contractHint = hints.find((h) => h.label === "  ● contract / imp")!;
      expect(contractHint.position.line).toBe(0);
    });
  });

  it("回归护栏：具名导出不受影响（同一 lens 形状）", async () => {
    await withLspServer({ "a.js": NAMED_EXPORT_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const contract = lenses.find((l) => l.command?.title === "● contract / imp")!;
      expect(contract).toBeDefined();
      expect(contract.command?.arguments?.[1]).toBe("compute");
    });
  });
});
