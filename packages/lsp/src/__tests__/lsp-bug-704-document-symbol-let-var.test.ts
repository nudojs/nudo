/**
 * Bug 704 — LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。
 *
 * 改前：`documentSymbols` 的变量分支写死 `detail: exported ? "export const" : "const"`，
 *       与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。
 * 改后：detail 按 `decl.kind` 输出 `const` / `let` / `var`（导出时前缀 `export `）。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/documentSymbol` ⇒ 响应里的 `detail`。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { documentSymbols } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

type Sym = { name: string; detail?: string; kind: number };

const SRC = `let mutable = 1;
var legacy = 2;
const fixed = 3;
export let exportedMutable = 4;
export var exportedLegacy = 5;
export const exportedFixed = 6;
`;

async function protocolSymbols(src: string): Promise<Sym[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b704-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src, "utf-8");
  try {
    const uri = `file://${file}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: src },
    });
    await new Promise((r) => setTimeout(r, 200));
    const handler = mock.requests.get("textDocument/documentSymbol");
    expect(handler, "documentSymbol handler not registered").toBeTruthy();
    const res = handler!({ textDocument: { uri } });
    return (res ?? []) as Sym[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 704 — documentSymbol 的变量 detail 按声明种类（const / let / var）", () => {
  it("纯函数面：let / var / const / export 前缀各自正确", () => {
    const syms = documentSymbols(parse(SRC));
    const detailOf = (name: string): string | undefined =>
      syms.find((s) => s.name === name)?.detail;
    expect(detailOf("mutable")).toBe("let");
    expect(detailOf("legacy")).toBe("var");
    expect(detailOf("fixed")).toBe("const");
    expect(detailOf("exportedMutable")).toBe("export let");
    expect(detailOf("exportedLegacy")).toBe("export var");
    expect(detailOf("exportedFixed")).toBe("export const");
  });

  it("协议面（真 server）：documentSymbol 响应里的 detail 不是 const", async () => {
    const syms = await protocolSymbols(SRC);
    const detailOf = (name: string): string | undefined =>
      syms.find((s) => s.name === name)?.detail;
    expect(syms.map((s) => s.name)).toEqual([
      "mutable",
      "legacy",
      "fixed",
      "exportedMutable",
      "exportedLegacy",
      "exportedFixed",
    ]);
    expect(detailOf("mutable")).toBe("let");
    expect(detailOf("legacy")).toBe("var");
    expect(detailOf("fixed")).toBe("const");
    expect(detailOf("exportedMutable")).toBe("export let");
    expect(detailOf("exportedLegacy")).toBe("export var");
    expect(detailOf("exportedFixed")).toBe("export const");
    // 改前：6 个变量绑定的 detail 全是 "const" / "export const"
    expect(syms.filter((s) => s.detail === "const").length).toBe(1);
  });

  it("负控制：kind 仍是 Variable(13)，不被文案改动牵连", async () => {
    const syms = await protocolSymbols(SRC);
    for (const s of syms) {
      expect(s.kind).toBe(13);
    }
  });
});
