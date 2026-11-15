/**
 * Bug 034 —— LSP hover 对**类方法**丢掉 `throws` 尾缀 ⇒ IDE 说「total」
 * 而 `nudo check` 说「may throw」（`f * 2` 里 `f: any` ⇒ ToNumeric 强转 ⇒
 * `TypeError`）。
 *
 * 根因：throws 只从 service 的运行时见证取（`entryThrowsAbs` / `entry@`），
 * 而 service 从不求值类方法体（点号名 `C.m` 的入口求值派发不到）⇒ 证据恒空。
 *
 * 修复：hover 的返回位 + throws 尾缀改读 `checkSource` 的签名（与门禁同源）。
 * 本钉要求类方法 hover 签名行与 `nudo check` 签名行**逐字同形**
 * （`PUBLIC_API.md` 的 “check-identical signature” 承诺）。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";
import { withLspServer } from "./helpers.ts";

/** 与 `tmp/repro/bug-034/cls.js` 逐字同文 */
const SRC = ["export class C {", "  m(f) { return f * 2; }", "}", ""].join("\n");

/** `nudo check` 的签名行（core formatCheckReport）：`name(params) => ret  throws X` */
const CHECK_SIG = "C.m(f: any) => number  throws TypeError";

type Hover = { contents: { value: string } } | null;

/** hover 的 ```nudo 代码块第一行（签名行） */
function nudoSigLine(contents: string): string {
  const lines = contents.split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 034 — 类方法 hover 的 throws 尾缀与 check 同源", () => {
  it("纯装配面：类方法 hover 签名行 = check 签名行（含 throws 尾缀）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug034-"));
    try {
      const file = join(dir, "cls.js");
      writeFileSync(file, SRC, "utf-8");
      // line 是 **1-based**（= LSP position.line + 1）；column 0-based = 2（`m`）
      const hover = getHoverAtPosition(file, SRC, 2, 2);
      expect(hover?.signature).toBe(CHECK_SIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("真实 server 协议面：hover 内容里的签名行同样带 `throws TypeError`", async () => {
    await withLspServer({ "cls.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/hover")({
        textDocument: { uri: uri("cls.js") },
        position: { line: 1, character: 2 }, // 0-based 行 1 = `m(f) { … }`；列 2 = `m`
      }) as Hover;
      const sig = nudoSigLine(res?.contents.value ?? "");
      expect(sig).toBe(CHECK_SIG);
      // 尾缀形态：两个空格 + `throws <name>`
      expect(sig).toContain("  throws TypeError");
    });
  });
});
