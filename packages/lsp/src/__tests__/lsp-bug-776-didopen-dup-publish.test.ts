/**
 * Bug 776 —— `didOpen` 重复发布 `publishDiagnostics`。
 *
 * 症状：打开一个文件后，同一版本、同一内容的诊断被**发布两次**。
 * 根因：`vscode-languageserver` 的 `TextDocuments.listen()` 在 `didOpen` 时
 * **同时** fire `onDidOpen` 与 `onDidChangeContent`
 * （`vscode-languageserver/lib/common/textDocuments.js`）⇒ server 的
 * 「打开即验证」路径与「编辑防抖」路径对**同一内容**各跑一遍完整校验，
 * 各 publish 一次。
 *
 * 修法（片 D · `server.ts`）：
 * - `documents.onDidOpen` 记录文档指纹（version + 内容）；
 * - `documents.onDidChangeContent` 发现指纹相同 ⇒ 认定是 didOpen 回声 ⇒
 *   不再排一次防抖校验；
 * - publish 面加**内容去重**（同 uri + 同 version + 同诊断内容 ⇒ 只发一次），
 *   同版本但诊断内容变了（侧车/依赖变更后的 force 重检）仍照发。
 *
 * 钉：打开一个会出诊断的文件 ⇒ 只发布 1 次；打开一个不出诊断的文件 ⇒
 * 也只发布 1 次（空数组），不得出现「同一版本同内容发两次」。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Bug 776 — didOpen 不得重复发布同一版本的诊断", () => {
  it("会出诊断的文件：didOpen 只发布一次（同 version 同内容）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export function boom() {\n  throw new Error('x');\n}\n";
      const file = join(dir, "boom.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published).toHaveLength(1);
      expect(published[0]?.version).toBe(1);
      expect((published[0]?.diagnostics ?? []).map((d: { code?: string }) => d.code)).toContain(
        "nudo:entry-may-throw",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("不出诊断的文件：didOpen 也只发布一次（空数组）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export const a = 1;\n";
      const file = join(dir, "plain.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published).toHaveLength(1);
      expect(published[0]?.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("编辑后仍会发布新版本的诊断（去重不得把后续诊断吞掉）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export function boom() {\n  throw new Error('x');\n}\n";
      const file = join(dir, "boom.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      mock.notifications.get("textDocument/didChange")!({
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: src + "\nexport const b = 2;\n" }],
      });
      await sleep(900);
      const versions = mock.sentDiagnostics
        .filter((d) => d.uri === uri)
        .map((d) => d.version);
      expect(versions).toContain(1);
      expect(versions).toContain(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
