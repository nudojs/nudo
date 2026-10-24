/**
 * Bug 719 — LSP `documentSymbol`：**解构绑定**的顶层变量整个从大纲里消失。
 *
 * 改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在
 *       `decl.id.type === "Identifier"` 时返回 id ⇒ 解构声明（ObjectPattern /
 *       ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。
 * 改后：遇到解构模式时**展开每个绑定**，每个绑定各出一个 Variable 项，
 *       range / selectionRange 取该绑定标识符的 range。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/documentSymbol` ⇒ 绑定名逐条。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { documentSymbols } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

type Sym = {
  name: string;
  detail?: string;
  kind: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
};

async function protocolSymbols(src: string): Promise<Sym[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b719-"));
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
    const handler = mock.requests.get("textDocument/documentSymbol");
    expect(handler, "documentSymbol handler not registered").toBeTruthy();
    const res = handler!({ textDocument: { uri } });
    return (res ?? []) as Sym[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SRC = `const { p, q } = { p: 1, q: 2 };
const [first, second] = [1, 2];
const plain = 3;

export function f() { return plain; }
`;

describe("Bug 719 — documentSymbol 展开解构绑定", () => {
  it("纯函数面：4 个解构绑定各出一个符号", () => {
    const syms = documentSymbols(parse(SRC));
    expect(syms.map((s) => s.name)).toEqual(["p", "q", "first", "second", "plain", "f"]);
    for (const name of ["p", "q", "first", "second"]) {
      const hit = syms.find((s) => s.name === name)!;
      expect(hit.kind).toBe(13); // Variable
      // range / selectionRange 落在该绑定标识符上（不是整条声明）
      expect(hit.range.start.line).toBe(hit.selectionRange.start.line);
      expect(hit.range.start.character).toBe(hit.selectionRange.start.character);
    }
  });

  it("协议面（真 server）：解构出的 4 个绑定都能在大纲里搜到", async () => {
    const syms = await protocolSymbols(SRC);
    expect(syms.map((s) => s.name)).toEqual(["p", "q", "first", "second", "plain", "f"]);
    const names = syms.map((s) => s.name);
    expect(names).toContain("p");
    expect(names).toContain("q");
    expect(names).toContain("first");
    expect(names).toContain("second");
    // 改前：只有 plain / f 两项（count=2）
    expect(syms.length).toBe(6);
  });

  it("嵌套 / 默认值 / rest 的绑定也展开", async () => {
    const src = `const { a: { b }, c = 1, ...rest } = obj;
const [x = 2, , ...tail] = arr;
export const used = [b, c, rest, x, tail];
`;
    const syms = await protocolSymbols(src);
    const names = syms.map((s) => s.name);
    expect(names).toEqual(["b", "c", "rest", "x", "tail", "used"]);
  });

  it("负控制：普通变量绑定不受影响", async () => {
    const syms = await protocolSymbols("const plain = 3;\nlet mut = 4;\nexport { plain, mut };\n");
    expect(syms.map((s) => s.name)).toEqual(["plain", "mut"]);
  });
});
