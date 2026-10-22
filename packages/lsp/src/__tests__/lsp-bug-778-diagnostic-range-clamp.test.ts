/**
 * Bug 778 —— 诊断 range 越界（`nudo:case-expected` 的 `column: 999` 整行哨兵）。
 *
 * 症状：service 用 `column: 999` 当「整行」哨兵，诊断原样转成 LSP range ⇒
 * `end.character = 999` 越出文档（协议层 Position 必须在文档内）⇒ 客户端按
 * range 渲染会划到行外。push / pull **两条通道**都越界。
 *
 * 修法（片 E）：range 的**唯一计算点** `lspDiagnosticRange` —— 行号 1 基 → 0 基，
 * 列号**夹到该行长度**以内（999 ⇒ 行尾），同 line 时 end ≥ start。
 *
 * 钉：push 与 pull 两条通道的 range 都必须落在文档内，且 end 恰为行尾。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";
import { lspDiagnosticRange, lineLengthsOf } from "../validation.ts";

/** `@nudo:case` 的期望类型与实得类型不符 ⇒ 触发 nudo:case-expected */
const SRC = `/**
 * @nudo:case "bad" (1) => "str"
 */
export function one(x) {
  return x;
}
`;

const CASE_CODE = "nudo:case-expected";

function openSession(src: string): {
  mock: ReturnType<typeof createMockConnection>;
  uri: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug778-"));
  const file = join(dir, "rng.js");
  writeFileSync(file, src, "utf-8");
  const uri = `file://${file}`;
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text: src },
  });
  return {
    mock,
    uri,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("Bug 778 — 诊断 range 必须夹在文档内（整行哨兵 column:999）", () => {
  it("push 通道：nudo:case-expected 的 range 不越过行尾", async () => {
    const { mock, uri, cleanup } = openSession(SRC);
    try {
      await new Promise((r) => setTimeout(r, 800));
      await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.selectCase",
        arguments: [uri, "one", 0],
      });
      await new Promise((r) => setTimeout(r, 800));

      const lines = SRC.split("\n");
      const pushed = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .filter((d: any) => d.code === CASE_CODE);
      expect(pushed.length, "nudo:case-expected 未上屏").toBeGreaterThan(0);
      for (const d of pushed) {
        const endLine = lines[d.range.end.line];
        expect(typeof endLine, "range 指向不存在的行").toBe("string");
        expect(d.range.end.character).toBe(endLine!.length);
        expect(d.range.start.character).toBeLessThanOrEqual(endLine!.length);
      }
    } finally {
      cleanup();
    }
  }, 30_000);

  it("pull 通道：nudo:case-expected 的 range 不越过行尾（同 push 口径）", async () => {
    const { mock, uri, cleanup } = openSession(SRC);
    try {
      await new Promise((r) => setTimeout(r, 800));
      await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.selectCase",
        arguments: [uri, "one", 0],
      });
      await new Promise((r) => setTimeout(r, 800));

      const res: any = await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      });
      const lines = SRC.split("\n");
      const pulled = (res?.items ?? []).filter((d: any) => d.code === CASE_CODE);
      expect(pulled.length, "nudo:case-expected 未上屏（pull）").toBeGreaterThan(0);
      for (const d of pulled) {
        const endLine = lines[d.range.end.line];
        expect(typeof endLine, "range 指向不存在的行").toBe("string");
        expect(d.range.end.character).toBe(endLine!.length);
      }
    } finally {
      cleanup();
    }
  }, 30_000);

  it("lspDiagnosticRange：整行哨兵夹到行尾，且同 line 时 end ≥ start", () => {
    const source = "abcdef\nxy\n";
    const lengths = lineLengthsOf(source);
    expect(lengths).toEqual([6, 2, 0]);

    // 整行哨兵 999 ⇒ 行尾（6）
    const r = lspDiagnosticRange({ line: 1, column: 0 }, { line: 1, column: 999 }, lengths);
    expect(r.start).toEqual({ line: 0, character: 0 });
    expect(r.end).toEqual({ line: 0, character: 6 });

    // 夹取后不得倒挂（start 在行尾之外 ⇒ start 也夹到行尾）
    const r2 = lspDiagnosticRange({ line: 1, column: 999 }, { line: 1, column: 999 }, lengths);
    expect(r2.start).toEqual({ line: 0, character: 6 });
    expect(r2.end).toEqual({ line: 0, character: 6 });

    // 跨行：end 行按 end 行自己的长度夹
    const r3 = lspDiagnosticRange({ line: 1, column: 0 }, { line: 2, column: 999 }, lengths);
    expect(r3.end).toEqual({ line: 1, character: 2 });
  });

  it("lspDiagnosticRange：行号 1 基 → 0 基（占位 line 0 → 0）", () => {
    const r = lspDiagnosticRange({ line: 0, column: 0 }, { line: 0, column: 1 });
    expect(r.start).toEqual({ line: 0, character: 0 });
    expect(r.end).toEqual({ line: 0, character: 1 });
    const r2 = lspDiagnosticRange({ line: 3, column: 4 }, { line: 3, column: 5 });
    expect(r2.start).toEqual({ line: 2, character: 4 });
  });
});
