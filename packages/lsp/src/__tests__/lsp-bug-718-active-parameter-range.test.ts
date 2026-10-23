/**
 * Bug 718：LSP `signatureHelp` 的 `activeParameter` **越界**——
 * 2 参签名在第 2 个实参之后报 index 2（协议规定下标须落在签名参数表内；
 * 越界值客户端只能回落 0 ⇒ 高亮错误的参数）。
 *
 * 原生 oracle：`activeParameter` 必须落在 `parameters` 长度内
 * （`activeParameter < parameters.length`，或该字段被省略）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { absFunction, num } from "@nudojs/core";
import { buildSignatureHelp } from "../signature-help.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = [
  "export function two(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function caller() {",
  "  two(1, 2);",
  "  return 0;",
  "}",
].join("\n");

/** `  two(1, 2);` 的列：`1` / `,` / `2` / `)` / `;` */
const LINE = SRC.split("\n")[5]!;
const COL_ARG1 = LINE.indexOf("1");
const COL_COMMA = LINE.indexOf(",");
const COL_ARG2 = LINE.indexOf("2");
const COL_CLOSE = LINE.indexOf(")");
const COL_SEMI = LINE.indexOf(";");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b718-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("Bug 718 signatureHelp：activeParameter 不越界", () => {
  it("纯函数面：buildSignatureHelp 把 activeParameter 夹进签名参数表内", () => {
    const fn = absFunction(["x", "y"], { apply: () => num() });
    // 越界输入（光标在末参之后 / 实参多于形参）⇒ 夹到最后一个形参
    const help = buildSignatureHelp(fn, 2)!;
    expect(help.signatures[0]!.parameters).toHaveLength(2);
    expect(help.activeParameter).toBe(1);
    expect(help.signatures[0]!.activeParameter).toBe(1);
    expect(help.activeParameter!).toBeLessThan(help.signatures[0]!.parameters!.length);
  });

  it("纯函数面：0 参签名 ⇒ 省略 activeParameter（不是填 0）", () => {
    const fn = absFunction([], { apply: () => num() });
    const help = buildSignatureHelp(fn, 0)!;
    expect(help.signatures[0]!.parameters).toHaveLength(0);
    expect(help.activeParameter).toBeUndefined();
    expect(help.signatures[0]!.activeParameter).toBeUndefined();
  });

  it("协议面（真 server）：末参之后 / 分号处的 activeParameter 都落在参数表内", async () => {
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

      const seen: Array<{ col: number; active: number | undefined; n: number }> = [];
      for (const col of [COL_ARG1, COL_COMMA, COL_ARG2, COL_CLOSE, COL_SEMI]) {
        const res = sig({ textDocument: { uri }, position: { line: 5, character: col } });
        expect(res).not.toBeNull();
        const n = res!.signatures[0]!.parameters.length;
        expect(n).toBe(2);
        const active = res!.activeParameter;
        // 协议取值域：下标落在签名参数表内
        if (active !== undefined) expect(active).toBeLessThan(n);
        seen.push({ col, active, n });
      }
      // 末参之后（`)` / `;`）不得再报 2（改前报 2 ⇒ 越界）
      expect(seen.find((s) => s.col === COL_CLOSE)!.active).toBe(1);
      expect(seen.find((s) => s.col === COL_SEMI)!.active).toBe(1);
      // 首参内 ⇒ 0
      expect(seen.find((s) => s.col === COL_ARG1)!.active).toBe(0);
      // 逗号上 ⇒ 第 2 个参数
      expect(seen.find((s) => s.col === COL_COMMA)!.active).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：实参多于形参时也不得越界", async () => {
    const src = [
      "export function one(a) { return a; }",
      "export function caller() {",
      "  one(1, 2, 3);",
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
      const line = src.split("\n")[2]!;
      for (const col of [line.indexOf("1"), line.indexOf("2"), line.indexOf("3")]) {
        const res = sig({ textDocument: { uri }, position: { line: 2, character: col } });
        expect(res).not.toBeNull();
        const n = res!.signatures[0]!.parameters.length;
        expect(n).toBe(1);
        const active = res!.activeParameter;
        if (active !== undefined) expect(active).toBeLessThan(n);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
