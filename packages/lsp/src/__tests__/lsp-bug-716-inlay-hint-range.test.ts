/**
 * Bug 716 —— LSP `textDocument/inlayHint` **完全忽略** `params.range`。
 *
 * 改前：handler 收了 `params` 却不读 `params.range` ⇒ 两个**不相交**的
 * 区间返回**逐字节相同**的整文件 hint 集（IDE 的「只看这一段」被无视）。
 *
 * 原生 oracle：LSP 协议里 `textDocument/inlayHint` 的 `range` 是**必填**且
 * 表示「只请求该区间」⇒ 返回的 hint 必须落在请求区间内。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = `export function alpha(x) { return x; }\n\nexport function beta(y) { return y; }\n`;

type Hint = { position: { line: number; character: number }; label: string };

async function hintsFor(
  file: string,
  text: string,
  range?: { start: { line: number; character: number }; end: { line: number; character: number } },
): Promise<Hint[]> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const inlay = mock.requests.get("textDocument/inlayHint")!;
  return (inlay({ textDocument: { uri }, ...(range ? { range } : {}) }) ?? []) as Hint[];
}

describe("Bug 716 inlayHint：params.range 必须被尊重", () => {
  it("区间请求只返回区间内的 hint（改前：整文件集逐字节相同）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug716-"));
    const file = join(dir, "range.js");
    writeFileSync(file, SRC);
    try {
      const whole = await hintsFor(file, SRC);
      expect(whole.length).toBeGreaterThan(1);

      const line0 = await hintsFor(file, SRC, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 40 },
      });
      const line2 = await hintsFor(file, SRC, {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 40 },
      });

      // 每个 hint 都必须落在请求区间内
      expect(line0.every((h) => h.position.line === 0)).toBe(true);
      expect(line2.every((h) => h.position.line === 2)).toBe(true);
      // 两个不相交区间 ⇒ 不同的 hint 集（改前二者与整文件集逐字节相同）
      expect(JSON.stringify(line0)).not.toBe(JSON.stringify(line2));
      expect(JSON.stringify(line0)).not.toBe(JSON.stringify(whole));
      expect(JSON.stringify(line2)).not.toBe(JSON.stringify(whole));
      // 区间内的 hint 仍在（不是「清空」）
      expect(line0.length).toBeGreaterThan(0);
      expect(line2.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("窄区间（不含任何 hint 位）返回空集，且不与整文件集相同", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug716b-"));
    const file = join(dir, "range.js");
    writeFileSync(file, SRC);
    try {
      const whole = await hintsFor(file, SRC);
      const narrow = await hintsFor(file, SRC, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      });
      expect(narrow).toEqual([]);
      expect(JSON.stringify(narrow)).not.toBe(JSON.stringify(whole));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("区间缺省（不合规客户端）⇒ 整文件集（fail-open，不丢内容）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug716c-"));
    const file = join(dir, "range.js");
    writeFileSync(file, SRC);
    try {
      const whole = await hintsFor(file, SRC);
      const noRange = await hintsFor(file, SRC, undefined);
      expect(noRange.length).toBe(whole.length);
      expect(JSON.stringify(noRange)).toBe(JSON.stringify(whole));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
