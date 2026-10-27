/**
 * Bug 985：`export default function defFn(…)` 的**默认导出** callee
 * ⇒ LSP `signatureHelp` **整面无响应**（null）。
 *
 * 根因（HEAD 实测）：`AnalysisResult.bindings` **只收具名导出** ⇒
 * 默认导出**连 "default" 键都没有**（既无 "default" 也无本地名 "defFn"）
 * ⇒ 绑定面必然 miss。签名面必须落到 **AST 定位回落**（与 hover 面同源的
 * `generalizeFromAst`）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = [
  "export default function defFn(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function caller() {",
  "  return defFn(1, 2);",
  "}",
].join("\n");

/** `  return defFn(1, 2);` 的列 */
const LINE = SRC.split("\n")[5]!;
const COL_CALLEE = LINE.indexOf("defFn");
const COL_ARG1 = LINE.indexOf("1");
const COL_ARG2 = LINE.indexOf("2");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b985-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("Bug 985 signatureHelp：export default 的 callee 也有签名弹窗", () => {
  it("协议面（真 server）：defFn(1, 2) 给出 2 参签名（改前 null）", async () => {
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

      const res = sig({ textDocument: { uri }, position: { line: 5, character: COL_ARG1 } });
      // 改前：null（整面无响应）
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.signatures[0]!.parameters[0]!.label).toBe("a: any");
      expect(res!.signatures[0]!.parameters[1]!.label).toBe("b: any");
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：光标落在被调者名 / 第 2 个实参处都给同一签名", async () => {
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

      const atCallee = sig({ textDocument: { uri }, position: { line: 5, character: COL_CALLEE } });
      expect(atCallee).not.toBeNull();
      expect(atCallee!.signatures[0]!.parameters).toHaveLength(2);

      const atArg2 = sig({ textDocument: { uri }, position: { line: 5, character: COL_ARG2 } });
      expect(atArg2).not.toBeNull();
      expect(atArg2!.signatures[0]!.parameters).toHaveLength(2);
      expect(atArg2!.activeParameter).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：具名导出的 callee 仍走绑定面（参数名 / 数量一致）", async () => {
    const src = [
      "export function namedFn(a, b) {",
      "  return a + b;",
      "}",
      "",
      "export function caller() {",
      "  return namedFn(1, 2);",
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
      const col = src.split("\n")[5]!.indexOf("1");
      const res = sig({ textDocument: { uri }, position: { line: 5, character: col } });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      // 返回类型部分随 **BUG-104** 的修复变精确。
      //
      // 旧期望 `"(a: any, b: any) => unknown"` 钉的正是 BUG-104 判红的
      // **症状**：`tmp/bug-report/sections/BUG-104.md` §期望 vs 实际 明写
      // signatureHelp 的 label 期望是**精确签名**、实际是
      // 「`(user: any) => unknown`」（声明空壳：形参一律 any、返回一律
      // unknown）⇒ 与同一 LSP 面的 hover 及 CLI `nudo check` 互斥。
      // 战役按该条修了 signatureHelp（arity-only 空壳不采纳 ⇒ 回落内涵面）
      // ⇒ 模块级 callee 现在给的是**精确**签名：`a + b`（两侧 any）⇒
      // JS `+` 的 ToPrimitive 结果并集 `number | string`（引擎 check 面
      // 同源：`number | string throws TypeError`）。
      // ⇒ 负控改钉精确签名；负控本意（模块级 callee 有签名 / 参数名与数量
      // 一致）由上面的 parameters 断言继续兜住。
      expect(res!.signatures[0]!.label).toBe("(a: any, b: any) => number | string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
