/**
 * Bug 071 —— LSP hover 的 `throws` 尾缀**不是 check-identical**：侧车契约
 * 收窄形参时 hover 多报 `throws TypeError`（`nudo check` 判绿）。
 *
 * 根因：形参 / 返回取**契约种子化**的 generalize 结果，throws 却取 service
 * 的**无约束入口域**见证（形参一律 `any` ⇒ `any` 上的 ToNumber 强转 ⇒
 * `TypeError`）—— 两套参数域混用。修复：返回位 + throws 尾缀统一读
 * `checkSource` 的签名（契约域 may-throw 为空 ⇒ 无 throws 尾缀）。
 *
 * 夹具与 `tmp/repro/bug-071/` 同文：`up.js` + 手写侧车 `up.nudo.js`
 * （`s: string()`）。真实 server 走真实 `didOpen` + 真实 `textDocument/hover`。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";
import { lspLoadModule } from "../validation.ts";
import { withLspServer } from "./helpers.ts";

const JS_SRC = ["export function up(s) {", "  return s.toUpperCase();", "}", ""].join("\n");

const SIDECAR_SRC = [
  'import { fn, string } from "@nudojs/env";',
  "export const up = fn({ s: string() });",
  "",
].join("\n");

/** `nudo check` 的签名行：契约域 ⇒ `s: string` 不可能触发强转 ⇒ 不抛 */
const CHECK_SIG = "up(s: string) => string";

type Hover = { contents: { value: string } } | null;

/** hover 的 ```nudo 代码块第一行（签名行） */
function nudoSigLine(contents: string): string {
  const lines = contents.split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 071 — 侧车契约收窄形参时 hover 不得多报 throws（check-identical）", () => {
  it("真实 server：hover 签名行 = check 契约域签名（无 throws）", async () => {
    await withLspServer(
      { "up.js": JS_SRC, "up.nudo.js": SIDECAR_SRC },
      async ({ req, uri }) => {
        const res = req("textDocument/hover")({
          textDocument: { uri: uri("up.js") },
          position: { line: 0, character: 16 }, // `export function up` 的 up
        }) as Hover;
        const value = res?.contents.value ?? "";
        const sig = nudoSigLine(value);
        expect(sig).toBe(CHECK_SIG);
        // 契约域里 `s.toUpperCase()` 无强转 ⇒ 不得出现 throws 尾缀
        expect(sig).not.toContain("throws");
        expect(value).not.toContain("throws");
      },
    );
  });

  it("纯装配面：hover 签名行同样不含 throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug071-"));
    try {
      const jsFile = join(dir, "up.js");
      writeFileSync(jsFile, JS_SRC, "utf-8");
      writeFileSync(join(dir, "up.nudo.js"), SIDECAR_SRC, "utf-8");
      // line 是 **1-based**（= LSP position.line + 1）；column 0-based = 16
      // 侧车契约靠 `loadModule` 装载（协议面由 server 传 `activeLoadModule`，
      // 缺省回落 `lspLoadModule` 读盘）——纯面显式给同一读盘装载器
      const hover = getHoverAtPosition(jsFile, JS_SRC, 1, 16, undefined, {
        loadModule: lspLoadModule,
      });
      expect(hover?.signature).toBe(CHECK_SIG);
      expect(hover?.signature ?? "").not.toContain("throws");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
