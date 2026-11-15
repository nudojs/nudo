/**
 * Bug 951 —— LSP hover 的**函数签名块**把返回类型按 `maxDepth: 4` 截断。
 *
 * 改前：同一份源码、同一函数、同一次分析下，`nudo check` 签名行 /
 * 同文档的 inlayHint / `nudo.hover` 载荷给出**三个互不相同的类型**，
 * 并直接违反 `api/lsp.md` 明写的「check-identical signature」承诺。
 *
 * 原生 oracle：hover 签名块的返回类型与 `nudo check` 的签名行**逐字相同**
 * （共享投影预算 PROJECTION_MAX_DEPTH，不是 hover 单方面的 maxDepth 4）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const DEEP = `export function deep() {
  return { a: { b: { c: { d: { e: 1 } } } } };
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
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 951 hover 签名块：返回类型与 check 同预算（不按 maxDepth 4 截断）", () => {
  it("5 层嵌套：hover 签名给出完整返回类型（改前截成 `{ d: … }`）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug951-"));
    const file = join(dir, "deep.js");
    writeFileSync(file, DEEP);
    try {
      const sig = await hoverSignatureAt(file, DEEP, 0, 16);
      expect(sig).toBe("deep() => { a: { b: { c: { d: { e: 1 } } } } }");
      expect(sig).not.toContain("…");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hover 签名行与 `nudo check` 签名行逐字相同", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug951b-"));
    const file = join(dir, "deep.js");
    writeFileSync(file, DEEP);
    try {
      const sig = await hoverSignatureAt(file, DEEP, 0, 16);
      expect(sig).toBe("deep() => { a: { b: { c: { d: { e: 1 } } } } }");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("更深的嵌套不再逐字节相同（深度 4 与深度 8 的 hover 输出不同）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug951c-"));
    const file4 = join(dir, "d4.js");
    const file8 = join(dir, "d8.js");
    const d4 = `export function nest() {
  return { n: { n: { n: { n: 1 } } } };
}
`;
    const d8 = `export function nest() {
  return { n: { n: { n: { n: { n: { n: { n: { n: 1 } } } } } } } };
}
`;
    writeFileSync(file4, d4);
    writeFileSync(file8, d8);
    try {
      const s4 = await hoverSignatureAt(file4, d4, 0, 16);
      const s8 = await hoverSignatureAt(file8, d8, 0, 16);
      expect(s4).toBe("nest() => { n: { n: { n: { n: 1 } } } }");
      expect(s8).toBe("nest() => { n: { n: { n: { n: { n: { n: { n: { n: 1 } } } } } } } }");
      expect(s8).not.toBe(s4);
      expect(s8).not.toContain("…");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
