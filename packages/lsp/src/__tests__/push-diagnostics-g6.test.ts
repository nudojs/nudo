import { describe, it, expect } from "vitest";
import { validateText, type ValidateTextDeps } from "../validation.ts";
import type { LspDiagnostic } from "../validation.ts";

/**
 * LSP-G6：老客户端只消费 push（textDocument/publishDiagnostics），
 * 不用 pull diagnosticProvider。打开/校验路径必须仍走 sendDiagnostics。
 */
describe("push diagnostics face (LSP-G6)", () => {
  it("validateText always publishes via sendDiagnostics (no pull required)", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps: ValidateTextDeps = {
      sendDiagnostics: (p) => {
        published.push(p);
      },
    };
    const src = `export function f(user) { return user.name; }\nf({});\n`;
    await validateText("/t/g6.js", "file:///t/g6.js", src, 1, deps, false, true);
    expect(published.length).toBeGreaterThan(0);
    const last = published[published.length - 1]!;
    expect(last.uri).toBe("file:///t/g6.js");
    // 有诊断（entry may-throw / 未知）或空数组——关键是**有 publish 事件**
    expect(Array.isArray(last.diagnostics)).toBe(true);
  });

  it("empty publish on clean file still fires (clears stale UI)", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps: ValidateTextDeps = {
      sendDiagnostics: (p) => {
        published.push(p);
      },
    };
    // Bug 8（wave 3）：any 形参算术不再 clean（may TypeError）——clean 样本
    // 改用恒总 identity，本用例意图（clean 文件 → 空诊断 publish）不变。
    const src = `export function id(x) { return x; }\n`;
    await validateText("/t/ok.js", "file:///t/ok.js", src, 1, deps, false, true);
    expect(published.length).toBeGreaterThan(0);
    expect(published[published.length - 1]!.diagnostics.length).toBe(0);
  });
});
