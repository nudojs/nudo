/**
 * Bug 769：导出类的实例方法（`Counter.inc`）在 LSP CodeLens / inlayHint 面
 * 完全不存在。
 *
 * 症状（真 server 协议面）：
 * - `textDocument/codeLens` 里 `Counter.inc` 只有 entry@ 观察层，
 *   **没有** `● contract / imp` / `⚡ persist interface` / `⚡ draft interface`；
 * - `textDocument/inlayHint` 里 `Counter.inc` 没有任何提示（既没有 interface
 *   档投影，也没有 `: by + 1 · derived` 返回 inlay）；
 * - 而 `textDocument/hover` **能**看到 `Counter.inc(by: any) => number | string`
 *   与 `● contract / imp` —— 四面不一致（design §3.2：导出类的实例方法与
 *   顶层导出函数同为消费者可见入口）。
 *
 * 根因：两处枚举都不认类方法——
 * - `topLevelFunctionSlots`（agent-tools.ts，CodeLens / interface inlay 面）；
 * - core `listFunctions`（algebra/inlay.ts，Abs 返回 inlay 面）。
 *
 * 期望：`Counter.inc` 与顶层导出函数在 CodeLens / inlayHint 面上同形，
 * 且契约键为 `Class.method`。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  "export class Counter {",
  "  inc(by) {",
  "    return by + 1;",
  "  }",
  "}",
  "",
  "export function plain(x) {",
  "  return x * 2;",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

describe("Bug 769 — 导出类实例方法的 interface 档 lens", () => {
  it("codeLens 出现 Counter.inc 的 interface 档（契约键 Class.method）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const contract = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "Counter.inc",
      );
      expect(contract).toBeDefined();
      // lens 落在方法声明行（1-based 行 2 ⇒ 0-based 行 1）
      expect(contract!.range.start.line).toBe(1);

      const titles = lenses.map((l) => l.command?.title);
      expect(titles).toContain("⚡ persist interface");
      expect(titles).toContain("⚡ draft interface");
      const draft = lenses.find(
        (l) =>
          l.command?.title === "⚡ draft interface" &&
          l.command?.arguments?.[1] === "Counter.inc",
      );
      expect(draft).toBeDefined();
    });
  });

  it("inlayHint 出现 Counter.inc 的 interface 档 + 返回 inlay", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const hints = req("textDocument/inlayHint")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 20, character: 0 },
        },
      }) as Array<{ position: { line: number }; label: string }>;
      // interface 档投影（CodeLens 不可见客户端）
      const contractHint = hints.find(
        (h) => h.label === "  ● contract / imp" && h.position.line === 1,
      );
      expect(contractHint).toBeDefined();
      // Abs 返回 inlay（core inlay 面也必须认类方法）
      const returnHint = hints.find((h) => h.label.includes(": by + 1"));
      expect(returnHint).toBeDefined();
      // 插在方法体 `{` 前（1-based 行 2 ⇒ 0-based 行 1）
      expect(returnHint!.position.line).toBe(1);
    });
  });

  it("回归护栏：同文件的顶层导出函数不受影响", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const plain = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "plain",
      );
      expect(plain).toBeDefined();
      expect(plain!.range.start.line).toBe(6);
    });
  });

  it("export default class 的实例方法同样进 interface 档", async () => {
    const defaultClassSrc = [
      "export default class Counter {",
      "  inc(by) {",
      "    return by + 1;",
      "  }",
      "}",
      "",
    ].join("\n");
    await withLspServer({ "a.js": defaultClassSrc }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const contract = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "Counter.inc",
      );
      expect(contract).toBeDefined();
      expect(contract!.range.start.line).toBe(1);
    });
  });
});
