/**
 * Bug 986：LSP `signatureHelp` 对**函数体内的局部 callee**
 * （局部函数声明 / 局部箭头常量）**完全没有签名弹窗**。
 *
 * 根因：局部绑定不在**模块级**绑定表（`AnalysisResult.bindings`）里
 * ⇒ 绑定面必然 miss ⇒ 签名面必须落到 **AST 定位回落**
 * （与 hover 面同源的 `generalizeFromAst`）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = [
  "export function outer() {",
  "  function inner(x, y) {",
  "    return x + y;",
  "  }",
  "  const arrow = (a, b) => a + b;",
  "  inner(1, 2);",
  "  arrow(3, 4);",
  "  return 0;",
  "}",
].join("\n");

/** `  inner(1, 2);` / `  arrow(3, 4);` 的列 */
const LINE_INNER = SRC.split("\n")[5]!;
const LINE_ARROW = SRC.split("\n")[6]!;

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b986-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("Bug 986 signatureHelp：局部 callee 也有签名弹窗", () => {
  it("协议面（真 server）：局部函数声明 inner(1, 2) 给出 2 参签名（改前 null）", async () => {
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

      const res = sig({
        textDocument: { uri },
        position: { line: 5, character: LINE_INNER.indexOf("1") },
      });
      // 改前：null（整面无响应）
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.signatures[0]!.parameters[0]!.label).toBe("x: any");
      expect(res!.signatures[0]!.parameters[1]!.label).toBe("y: any");
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：局部箭头常量 arrow(3, 4) 给出 2 参签名（改前 null）", async () => {
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

      const res = sig({
        textDocument: { uri },
        position: { line: 6, character: LINE_ARROW.indexOf("3") },
      });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.signatures[0]!.parameters[0]!.label).toBe("a: any");
      expect(res!.signatures[0]!.parameters[1]!.label).toBe("b: any");
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：局部 callee 的第 2 个实参 ⇒ activeParameter = 1", async () => {
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

      const res = sig({
        textDocument: { uri },
        position: { line: 5, character: LINE_INNER.indexOf("2") },
      });
      expect(res).not.toBeNull();
      expect(res!.activeParameter).toBe(1);
      expect(res!.activeParameter!).toBeLessThan(res!.signatures[0]!.parameters.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：模块级 callee 仍走绑定面（签名口径一致）", async () => {
    const src = [
      "export function top(a, b) { return a + b; }",
      "export function caller() {",
      "  top(1, 2);",
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
      const res = sig({
        textDocument: { uri },
        position: { line: 2, character: src.split("\n")[2]!.indexOf("1") },
      });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.label).toBe("(a: any, b: any) => unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
