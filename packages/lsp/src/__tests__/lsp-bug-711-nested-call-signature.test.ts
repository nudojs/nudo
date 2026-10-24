/**
 * Bug 711：LSP **嵌套调用**的 `signatureHelp` 弹**外层函数**的签名
 * （内层调用完全不参与）。
 *
 * 原生 oracle：光标在内层实参里 ⇒ 弹**内层**函数的签名
 * （LSP 签名帮助的语义 = 正在被编辑的那个调用）。
 *
 * 改前：`findEnclosingCall` 命中第一个（外层）CallExpression 即停 +
 * `path.skip()` ⇒ 内层 CallExpression 永不被访问 ⇒ 弹外层签名。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { createNudoServer } from "../server.ts";
import { findEnclosingCall } from "../server-ide.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = [
  "export function outer(a, b, c) { return a + b + c; }",
  "export function inner(x) { return x; }",
  "export function go() { return outer(inner(1), 3, 4); }",
].join("\n");

/** 源码列 → 断言用（`export function go() { return outer(inner(1), 3, 4); }`） */
const COL_INNER_ARG = SRC.split("\n")[2]!.indexOf("inner(1)") + "inner(1)".indexOf("1");
/** 外层第 2 个实参 `3` 的列（不是 `inner(1)` 后的那个逗号） */
const COL_OUTER_ARG2 = SRC.split("\n")[2]!.indexOf("3");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b711-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("Bug 711 signatureHelp：嵌套调用弹**最内层**函数的签名", () => {
  it("纯函数面：光标在内层实参 ⇒ findEnclosingCall 命中内层调用", () => {
    const ast = parse(SRC);
    const hit = findEnclosingCall(ast, 3, COL_INNER_ARG);
    expect(hit).not.toBeNull();
    // 内层 `inner` 的 callee 起点（不是外层 `outer`）
    const innerCalleeCol = SRC.split("\n")[2]!.indexOf("inner");
    expect(hit!.calleeCol).toBe(innerCalleeCol);
    expect(hit!.currentParamIndex).toBe(0);
    // 外层 `outer` 的 callee 起点（改前弹的就是这个）
    expect(innerCalleeCol).toBeGreaterThan(SRC.split("\n")[2]!.indexOf("outer"));
  });

  it("纯函数面：光标在外层第 2 个实参 ⇒ 仍命中外层调用", () => {
    const ast = parse(SRC);
    const hit = findEnclosingCall(ast, 3, COL_OUTER_ARG2);
    expect(hit).not.toBeNull();
    expect(hit!.calleeCol).toBe(SRC.split("\n")[2]!.indexOf("outer"));
    expect(hit!.currentParamIndex).toBe(1);
  });

  it("协议面（真 server）：内层实参处弹 inner 的 1 参签名（改前是 outer 的 3 参）", async () => {
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
        position: { line: 2, character: COL_INNER_ARG },
      });
      expect(res).not.toBeNull();
      const label = res!.signatures[0]!.label;
      expect(label).toBe("(x: any) => unknown");
      expect(res!.signatures[0]!.parameters).toHaveLength(1);
      expect(res!.activeParameter).toBe(0);
      // 负控制：不得是外层的 3 参签名
      expect(label).not.toContain("a: any");
      expect(res!.signatures[0]!.parameters).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：外层第 2 个实参处仍弹 outer 的 3 参签名", async () => {
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
        position: { line: 2, character: COL_OUTER_ARG2 },
      });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.label).toBe("(a: any, b: any, c: any) => unknown");
      expect(res!.activeParameter).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
