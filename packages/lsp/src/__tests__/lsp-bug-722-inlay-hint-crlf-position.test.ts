/**
 * Bug 722 —— LSP `inlayHint` 在 **CRLF 源文件**上把 `position.character`
 * 推到**行可见长度之外 1 列**（越界位置）。
 *
 * 改前：服务端 `source.split("\n")` 切行 ⇒ 每行末尾的 `\r` 被算进行长
 * ⇒ end-of-line hint 的 character 比客户端算出的可见行长多 1。
 *
 * 原生 oracle：LSP `Position.character` 是行内 UTF-16 偏移，**行终止符
 * 不属于该行** ⇒ character 必须落在该行的可见长度内。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const BODY = `export function alpha(x) {\n  return x + 1;\n}\n`;

type Hint = { position: { line: number; character: number }; label: string };

async function hintsFor(file: string, text: string): Promise<Hint[]> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const inlay = mock.requests.get("textDocument/inlayHint")!;
  return (inlay({ textDocument: { uri } }) ?? []) as Hint[];
}

describe("Bug 722 inlayHint：CRLF 源文件的 hint 位置不得越出行可见长度", () => {
  it("CRLF 与 LF 给出同一组位置（改前：CRLF 的行尾 hint 越界 1 列）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug722-"));
    try {
      const crlfFile = join(dir, "crlf.js");
      const lfFile = join(dir, "lf.js");
      const crlf = BODY.replace(/\n/g, "\r\n");
      writeFileSync(crlfFile, crlf);
      writeFileSync(lfFile, BODY);

      const crlfHints = await hintsFor(crlfFile, crlf);
      const lfHints = await hintsFor(lfFile, BODY);

      // 客户端模型：行终止符不属于该行 ⇒ 可见行长
      const visible = crlf.split(/\r\n|\r|\n/).map((l) => l.length);
      for (const h of crlfHints) {
        const vlen = visible[h.position.line] ?? 0;
        expect(h.position.character).toBeLessThanOrEqual(vlen);
      }
      // 同一份代码、只换行尾 ⇒ 位置逐条相同（服务端与客户端同口径）
      expect(JSON.stringify(crlfHints)).toBe(JSON.stringify(lfHints));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CRLF 下 end-of-line 的 interface 档 hint 落在可见行长上（不是 +1）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug722b-"));
    const file = join(dir, "crlf.js");
    const crlf = BODY.replace(/\n/g, "\r\n");
    writeFileSync(file, crlf);
    try {
      const hints = await hintsFor(file, crlf);
      const visible = crlf.split(/\r\n|\r|\n/).map((l) => l.length);
      const eol = hints.find((h) => h.label.includes("contract"));
      expect(eol).toBeDefined();
      // 行尾 hint 的 character == 该行可见行长（不是可见行长 + 1）
      expect(eol!.position.character).toBe(visible[eol!.position.line]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
