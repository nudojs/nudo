/**
 * Bug 706 — LSP `documentSymbol` 漏掉 `export default <arrow>` 与**匿名**
 * `export default function () {}`。
 *
 * 改前：顶层语句循环只处理 FunctionDeclaration / ClassDeclaration /
 *       VariableDeclaration ⇒ `export default` 的声明整条从大纲里消失；
 *       `pushFn` 对无名函数 `if (!idNode?.name) return` 直接丢弃。
 * 改后：顶层循环补 `ExportDefaultDeclaration` 分支——表达式型默认导出给一个
 *       名为 `default` 的符号；函数型默认导出**即便匿名**也要出项。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/documentSymbol` ⇒ DocumentSymbol[]。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { documentSymbols } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

type Sym = { name: string; detail?: string; kind: number };

async function protocolSymbols(src: string): Promise<Sym[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b706-"));
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

const CASES: Array<{ label: string; src: string; name: string; kind: number }> = [
  {
    label: "export default <arrow>",
    src: "export default (x) => x;\n",
    name: "default",
    kind: 12,
  },
  {
    label: "export default 匿名 function",
    src: "export default function () {}\n",
    name: "default",
    kind: 12,
  },
  {
    label: "export default function <name>",
    src: "export default function named() {}\n",
    name: "named",
    kind: 12,
  },
  {
    label: "export default 匿名 class",
    src: "export default class {}\n",
    name: "default",
    kind: 5,
  },
  {
    label: "export default class <Name>",
    src: "export default class Named {}\n",
    name: "Named",
    kind: 5,
  },
  {
    label: "export default <字面量>",
    src: "export default 42;\n",
    name: "default",
    kind: 13,
  },
];

describe("Bug 706 — documentSymbol 收录 export default", () => {
  for (const c of CASES) {
    it(`纯函数面：${c.label} ⇒ 大纲里有 ${c.name}`, () => {
      const syms = documentSymbols(parse(c.src));
      expect(syms.map((s) => s.name)).toContain(c.name);
      const hit = syms.find((s) => s.name === c.name)!;
      expect(hit.kind).toBe(c.kind);
    });

    it(`协议面（真 server）：${c.label} ⇒ documentSymbol 响应里有 ${c.name}`, async () => {
      const syms = await protocolSymbols(c.src);
      expect(syms.length).toBeGreaterThan(0);
      expect(syms.map((s) => s.name)).toContain(c.name);
      expect(syms.find((s) => s.name === c.name)!.kind).toBe(c.kind);
    });
  }

  it("负控制：普通具名导出不受影响", async () => {
    const syms = await protocolSymbols("export const f = () => {};\nexport function g() {}\n");
    expect(syms.map((s) => s.name)).toEqual(["f", "g"]);
  });
});
