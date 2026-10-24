/**
 * Bug 705 — LSP references / definition 对**类方法**返回空（IDE 显示「无引用 / 无定义」）。
 *
 * 改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false）
 *       ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空；
 *       已经写好的方法面（`collectMethodReferences`）**没有**被 references /
 *       definition 通道接入 ⇒ 两个请求都答「没有」。
 * 改后：references / definition 通道**改走方法面**（方法键 + 同源成员访问）。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/references` 与 `textDocument/definition`
 *             ⇒ Location 数组 / 跳转目标。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { collectMethodReferences } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

type Loc = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const SRC = `export class K {
  m(p) { return p; }
}
export const k = new K();
export const r = k.m(1);
`;

/** 0-based 行列 */
function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {
  const lines = src.split("\n");
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    let from = 0;
    for (;;) {
      const idx = lines[line]!.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === occurrence) return { line, character: idx };
      seen++;
      from = idx + 1;
    }
  }
  throw new Error(`needle not found: ${needle}`);
}

async function withServer<T>(
  src: string,
  fn: (mock: ReturnType<typeof createMockConnection>, uri: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b705-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src, "utf-8");
  try {
    const uri = `file://${file}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: src },
    });
    await new Promise((r) => setTimeout(r, 200));
    return await fn(mock, uri);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const KEY_POS = posOf(SRC, "m(p)");
// `k.m(1)` 里的 `m`（不是 `k`）
const USE_POS = { line: posOf(SRC, "k.m").line, character: posOf(SRC, "k.m").character + 2 };

describe("Bug 705 — 类方法的 references / definition 不再返回空", () => {
  it("纯函数面：方法面能收齐类方法键 + 同源成员访问", () => {
    const hits = collectMethodReferences(parse(SRC), "m");
    expect(hits.some((h) => h.kind === "key")).toBe(true);
    expect(hits.some((h) => h.kind === "member")).toBe(true);
    // 归属：类 K
    expect(hits.every((h) => h.owner?.name === "K")).toBe(true);
  });

  it("协议面（真 server）：references @ 类方法键 ⇒ 至少 1 条引用（k.m(1)）", async () => {
    const refs = await withServer(SRC, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/references");
      expect(handler, "references handler not registered").toBeTruthy();
      const res = handler!({
        textDocument: { uri },
        position: KEY_POS,
        context: { includeDeclaration: true },
      });
      return (res ?? []) as Loc[];
    });
    const lines = refs.map((r) => r.range.start.line).sort((a, b) => a - b);
    // 改前：[] （一条都没有）
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(lines).toContain(KEY_POS.line); // 定义位（类方法键）
    expect(lines).toContain(USE_POS.line); // 使用位（k.m(1)）
    // 使用位落在 `m` 本身（不是整条表达式）
    const use = refs.find((r) => r.range.start.line === USE_POS.line)!;
    expect(use.range.start.character).toBe(USE_POS.character);
    expect(use.range.end.character).toBe(USE_POS.character + 1);
  });

  it("协议面（真 server）：definition @ k.m(1) ⇒ 跳到类里的方法键", async () => {
    const defs = await withServer(SRC, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/definition");
      expect(handler, "definition handler not registered").toBeTruthy();
      const res = handler!({ textDocument: { uri }, position: USE_POS });
      return (res ?? []) as Loc[];
    });
    // 改前：[] （跳不过去）
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(KEY_POS.line);
    expect(def.range.start.character).toBe(KEY_POS.character);
    expect(def.range.end.character).toBe(KEY_POS.character + 1);
  });

  it("协议面（真 server）：references 的 includeDeclaration=false 只剩使用位", async () => {
    const refs = await withServer(SRC, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/references")!;
      const res = handler!({
        textDocument: { uri },
        position: KEY_POS,
        context: { includeDeclaration: false },
      });
      return (res ?? []) as Loc[];
    });
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.map((r) => r.range.start.line)).toContain(USE_POS.line);
    expect(refs.map((r) => r.range.start.line)).not.toContain(KEY_POS.line);
  });

  it("负控制：普通变量的 references 通道不受影响", async () => {
    const src = `export const v = 1;
export function use() { return v; }
`;
    const refs = await withServer(src, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/references")!;
      const res = handler!({
        textDocument: { uri },
        position: posOf(src, "v ="),
        context: { includeDeclaration: true },
      });
      return (res ?? []) as Loc[];
    });
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });
});
