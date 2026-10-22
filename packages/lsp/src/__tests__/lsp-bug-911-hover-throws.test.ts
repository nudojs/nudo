/**
 * Bug 911 —— LSP `textDocument/hover` 的签名块**整段丢掉 `throws` 通道**。
 *
 * 改前：hover 签名块只吃 formatShape/formatAbs（Abs 的四槽
 * `shape × term × pred × conf` 没有 throws 槽）⇒ IDE 里显示「不会抛」，
 * 而 `nudo check` 同一函数判 `nudo:entry-may-throw`（error）。
 *
 * 原生 oracle：`api/lsp.md` 明写 hover 给 **check-identical signature**
 * ⇒ hover 签名行必须与 `nudo check` 的签名行**逐字相同**（含 throws 段）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = `export function risky(x) {
  return x + 1;
}

export function safe(x) {
  return x * 2;
}
`;

type Hover = { contents: { value: string } } | null;

async function hoverSignatureAt(
  file: string,
  text: string,
  line: number,
  character: number,
): Promise<string> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const hover = mock.requests.get("textDocument/hover")!;
  const res = hover({
    textDocument: { uri },
    position: { line, character },
  }) as Hover;
  const lines = (res?.contents.value ?? "").split("\n");
  // 签名块 = ```nudo 之后的第一个非围栏行
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 911 hover 签名块：throws 通道不得丢失（check-identical）", () => {
  it("会抛的导出函数：hover 签名带 `throws TypeError`（改前静默省略）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911-"));
    const file = join(dir, "throws.js");
    writeFileSync(file, SRC);
    try {
      const sig = await hoverSignatureAt(file, SRC, 0, 16);
      expect(sig).toBe("risky(x: any) => number | string  throws TypeError");
      expect(sig).toContain("throws TypeError");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hover 签名行与 `nudo check` 签名行逐字相同（throws 段一致）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911b-"));
    const file = join(dir, "throws.js");
    writeFileSync(file, SRC);
    try {
      const sig = await hoverSignatureAt(file, SRC, 0, 16);
      // `nudo check` 的人面签名行（core formatCheckReport）：`name(params) => ret  throws X`
      const checkLine = "risky(x: any) => number | string  throws TypeError";
      expect(sig).toBe(checkLine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不会抛的函数：无证据 ⇒ **省略** throws 段（不得写 `throws never`）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911c-"));
    const file = join(dir, "clean.js");
    const clean = `export function pure(x) {
  return x;
}
`;
    writeFileSync(file, clean);
    try {
      const sig = await hoverSignatureAt(file, clean, 0, 16);
      expect(sig).toBe("pure(x: any) => any");
      expect(sig).not.toContain("throws");
      expect(sig).not.toContain("never");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非导出函数不带 throws（CLI 的 L2 throws 只对 entry 生效）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug911d-"));
    const file = join(dir, "local.js");
    const local = `function helper(x) {
  return x + 1;
}

export function other() {
  return 1;
}
`;
    writeFileSync(file, local);
    try {
      const sig = await hoverSignatureAt(file, local, 0, 10);
      expect(sig).toBe("helper(x: any) => number | string");
      expect(sig).not.toContain("throws");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
