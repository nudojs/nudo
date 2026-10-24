/**
 * Bug 998：CJS 成员导出（`exports.f = fn` / `module.exports.f = fn`）在 LSP 的
 * 4 个符号 / 观察面 + codeLens 的 interface 档上**整段消失**。
 *
 * 症状（真 server 协议面，改前）：
 * - `textDocument/documentSymbol` → `[]`（ESM 对照文件有 2 项）；
 * - `workspace/symbol` 查 `alpha` → 查不到；
 * - `textDocument/inlayHint` → `[]`；
 * - `textDocument/semanticTokens/full` → 只有形参 token，函数名没有 function 档；
 * - `textDocument/codeLens` → 只有 entry@ 观察层，没有 interface 档；
 * - 而诊断面明明点名 `alpha (export)` —— 符号面查不到、诊断面却报得出。
 *
 * 根因：四处枚举各自为政，都不认 CJS 成员导出形态
 * （`localNamedExports` / core `listTopFunctions` 早已认得）。
 *
 * 期望：CJS 成员导出与 ESM 具名导出在 4 个面上同形。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";
import { decodeSemanticTokens } from "./lsp-bug-d4-harness.ts";

const CJS_SRC = [
  "module.exports.alpha = function (x) {",
  "  return x + 1;",
  "};",
  "exports.beta = function (y) {",
  "  return y * 2;",
  "};",
  "",
].join("\n");

const ESM_SRC = [
  "export function alpha(x) {",
  "  return x + 1;",
  "}",
  "export function beta(y) {",
  "  return y * 2;",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

describe("Bug 998 — CJS 成员导出的符号 / 观察面", () => {
  it("documentSymbol 出 CJS 成员导出（函数档，detail 带 export）", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Array<{ name: string; detail?: string; kind: number }>;
      expect(syms.map((s) => s.name)).toEqual(["alpha", "beta"]);
      expect(syms[0]!.detail).toBe("(x) export");
      expect(syms[0]!.kind).toBe(12); // SymbolKind.Function
    });
  });

  it("workspace/symbol 查得到 CJS 成员导出", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      void uri;
      const syms = req("workspace/symbol")({ query: "alpha" }) as Array<{ name: string }>;
      expect(syms.map((s) => s.name)).toContain("alpha");
    });
  });

  it("semanticTokens 给 CJS 导出键 function 档 + interface 档 modifier", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/semanticTokens/full")({
        textDocument: { uri: uri("a.js") },
      }) as { data: number[] };
      const tokens = decodeSemanticTokens(res.data);
      // alpha 键：function 档（typeIndex 0）+ declaration|derived（modifier 65）
      expect(tokens[0]).toEqual({
        line: 0,
        char: 15,
        length: 5,
        typeIndex: 0,
        modifiers: 65,
      });
      // beta 键
      expect(tokens[2]).toEqual({
        line: 3,
        char: 8,
        length: 4,
        typeIndex: 0,
        modifiers: 65,
      });
    });
  });

  it("inlayHint 出 CJS 导出的返回 inlay + interface 档投影", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const hints = req("textDocument/inlayHint")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 20, character: 0 },
        },
      }) as Array<{ position: { line: number }; label: string }>;
      const labels = hints.map((h) => h.label);
      expect(labels.some((l) => l.includes(": x + 1"))).toBe(true);
      expect(labels.some((l) => l.includes(": y * 2"))).toBe(true);
      expect(labels.filter((l) => l === "  ● contract / imp").length).toBe(2);
    });
  });

  it("codeLens 出 CJS 导出的 interface 档（契约身份 = 导出名）", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const alpha = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "alpha",
      );
      expect(alpha).toBeDefined();
      expect(alpha!.range.start.line).toBe(0);
      const beta = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "beta",
      );
      expect(beta).toBeDefined();
      expect(beta!.range.start.line).toBe(3);
    });
  });

  it("hover 面解析出 CJS 导出名（族 25 收口接线：position.ts 补 MemberExpression property 分支）", async () => {
    await withLspServer({ "a.js": CJS_SRC }, async ({ req, uri }) => {
      const hover = req("textDocument/hover")({
        textDocument: { uri: uri("a.js") },
        // 第 1 行（0-based）的 `alpha`（`module.exports.alpha = …`）
        position: { line: 0, character: 16 },
      }) as { contents?: { value?: string } } | null;
      const text = hover?.contents?.value ?? "";
      // 改前：无名 `(x) => ?`（名字解析不出来）⇒ 诊断面认得它、hover 面不认
      expect(text).toContain("alpha");
      expect(text).not.toContain("(x) => ?");
    });
  });

  it("回归护栏：ESM 具名导出的符号面不受影响", async () => {
    await withLspServer({ "a.js": ESM_SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Array<{ name: string }>;
      expect(syms.map((s) => s.name)).toEqual(["alpha", "beta"]);
    });
  });
});
