/**
 * Bug 720：LSP `signatureHelp` 对**方法调用**（`obj.method(…)`）
 * **完全没有签名弹窗**，尽管引擎解析得出该方法的签名（成员补全面能给出
 * `method` 的 2 个具名形参 x / y）。
 *
 * 原生 oracle：成员调用的被调者是**接收者的槽位**，不是模块级绑定
 * ⇒ 签名面必须沿 Abs 形状逐段下钻。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = [
  "const obj = { method(x, y) { return x + y; } };",
  "",
  "export function caller() {",
  "  obj.method(1, 2);",
  "  return 0;",
  "}",
].join("\n");

/** `  obj.method(1, 2);` 的列 */
const LINE = SRC.split("\n")[3]!;
const COL_OBJ = LINE.indexOf("obj");
const COL_METHOD = LINE.indexOf("method");
const COL_OPEN = LINE.indexOf("(");
const COL_ARG1 = LINE.indexOf("1");
const COL_CLOSE = LINE.indexOf(")");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b720-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("Bug 720 signatureHelp：成员调用（obj.method）也有签名弹窗", () => {
  it("协议面（真 server）：obj.method(1, 2) 给出方法的 2 参签名", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({ textDocument: { uri }, position: { line: 3, character: COL_ARG1 } });
      // 改前：null（整面无响应）
      expect(res).not.toBeNull();
      const label = res!.signatures[0]!.label;
      expect(label).toBe("(x: any, y: any) => unknown");
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：光标在接收者 / 方法名 / 括号各处都给出同一签名", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      for (const col of [COL_OBJ, COL_METHOD, COL_OPEN]) {
        const res = sig({ textDocument: { uri }, position: { line: 3, character: col } });
        expect(res, `col=${col}`).not.toBeNull();
        expect(res!.signatures[0]!.label).toBe("(x: any, y: any) => unknown");
      }
      // 末参之后 ⇒ activeParameter 仍在参数表内
      const tail = sig({ textDocument: { uri }, position: { line: 3, character: COL_CLOSE } });
      expect(tail).not.toBeNull();
      expect(tail!.activeParameter!).toBeLessThan(tail!.signatures[0]!.parameters.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：顶层函数调用仍给顶层签名（成员面不得吞掉裸标识符面）", async () => {
    const src = [
      "export function plain(a, b) { return a + b; }",
      "export function caller() {",
      "  plain(1, 2);",
      "  return 0;",
      "}",
    ].join("\n");
    const { dir, file } = tmpFile(src);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const col = src.split("\n")[2]!.indexOf("1");
      const res = sig({ textDocument: { uri }, position: { line: 2, character: col } });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
