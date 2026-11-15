/**
 * Bug 749 —— `textDocument/documentSymbol` **完全无视客户端 capabilities**
 * ⇒ 客户端声明「不支持层级式」却收到 `DocumentSymbol[]`（**形状违规**），
 * 且返回的 `SymbolKind` 超出客户端声明的 `valueSet`（**取值违规**）。
 *
 * 根因：`onInitialize` 只回**自己**的能力声明、**从不保存** `params.capabilities`
 * ⇒ `onDocumentSymbol` 永远按「层级式 + 全量 SymbolKind」输出。
 *
 * 本钉钉住**输出侧**（片 B）：能力**读取侧**在 `server.ts`（片 C），
 * 见 `lsp-bug-749-client-capabilities.test.ts`。
 *
 * 契约（片 C → B）：
 * · `deps.clientCapabilities?: () => ClientCapabilities | undefined`
 *   ——返回客户端在 `initialize` 里声明的 `params.capabilities` **原对象**。
 * · **缺省**（`undefined`，老客户端可能根本不发该段）⇒ **必须走默认**：
 *   **层级式 `DocumentSymbol[]` + 全量 `SymbolKind`**（**不得因拿不到能力就退化**）。
 * · `hierarchicalDocumentSymbolSupport === false` ⇒ 回 **`SymbolInformation[]`**
 *   （`location` 而非 `range` / `selectionRange` / `children`；层级关系用
 *   `containerName` 表达）。
 * · `symbolKind.valueSet` 存在 ⇒ 不在集合内的 kind **夹到集合内的安全值**
 *   （建议 `SymbolKind.Variable` = 13）并保留 `detail` 降级提示。
 */
import { describe, it, expect } from "vitest";
import { withLspServer, withLspServerCapabilities } from "./helpers.ts";

/** 夹具：类（含方法）+ 顶层函数 + 顶层变量（kind 各不相同 ⇒ 可验夹取）。 */
const SRC = `export class Kls {
  alphaMethod() {}
}
export function gammaFn() {}
export const deltaVar = 1;
`;

/** 客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。 */
const FLAT_CAPS = {
  textDocument: {
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: false,
      symbolKind: { valueSet: [12, 13] },
    },
  },
};

type Sym = {
  name: string;
  kind: number;
  detail?: string;
  range?: unknown;
  selectionRange?: unknown;
  children?: unknown;
  containerName?: string;
  location?: { uri: string; range: unknown };
};

const keysOf = (s: Sym): string[] => Object.keys(s).sort();

describe("Bug 749 — documentSymbol 按客户端能力作答（形状 + SymbolKind 取值）", () => {
  it("缺省（客户端没发能力段）⇒ 层级式 + 全量 SymbolKind（不得退化）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Sym[];
      expect(syms.length).toBeGreaterThan(0);
      const cls = syms.find((s) => s.name === "Kls");
      expect(cls, "缺省时没有 Kls").toBeTruthy();
      expect(keysOf(cls!)).toEqual(["children", "detail", "kind", "name", "range", "selectionRange"]);
      expect(cls!.kind, "缺省时 kind 应是 Class(5)（全量取值，不夹取）").toBe(5);
      expect((cls!.children as Sym[]).map((c) => c.name)).toEqual(["alphaMethod"]);
      expect((cls!.children as Sym[])[0].kind, "缺省时方法 kind 应是 Method(6)").toBe(6);
    });
  });

  it("hierarchicalDocumentSymbolSupport=false ⇒ 回 SymbolInformation[]（location 形态）", async () => {
    await withLspServerCapabilities({ "a.js": SRC }, FLAT_CAPS, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Sym[];
      expect(syms.length).toBeGreaterThan(0);
      for (const s of syms) {
        expect(s.location, `扁平形态缺 location：${s.name}`).toBeTruthy();
        expect(s.range, `扁平形态不应有 range：${s.name}`).toBeUndefined();
        expect(s.selectionRange, `扁平形态不应有 selectionRange：${s.name}`).toBeUndefined();
        expect(s.children, `扁平形态不应有 children：${s.name}`).toBeUndefined();
      }
      // 层级关系用 containerName 表达（类成员被摊平到同一层）
      const method = syms.find((s) => s.name === "alphaMethod");
      expect(method, "类成员没被摊平进扁平结果").toBeTruthy();
      expect(method!.containerName, "类成员应带 containerName").toBe("Kls");
    });
  });

  it("symbolKind.valueSet ⇒ 不在集合内的 kind 被夹到集合内（并留 detail 降级提示）", async () => {
    await withLspServerCapabilities({ "a.js": SRC }, FLAT_CAPS, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Sym[];
      for (const s of syms) {
        expect([12, 13], `kind ${s.kind} 超出客户端 valueSet [12,13]`).toContain(s.kind);
      }
      const cls = syms.find((s) => s.name === "Kls");
      // Class(5) 不在 [12,13] ⇒ 夹到 Variable(13)（客户端声明的集合内）
      expect(cls!.kind, "Class(5) 应被夹到集合内的安全值").toBe(13);
      expect(cls!.detail, "夹取后应留 detail 降级提示").toContain("kind clamped to 13");
    });
  });

  it("valueSet 缺省 ⇒ 不夹取（全量 kind）", async () => {
    await withLspServerCapabilities(
      { "a.js": SRC },
      { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
      async ({ req, uri }) => {
        const syms = req("textDocument/documentSymbol")({
          textDocument: { uri: uri("a.js") },
        }) as Sym[];
        const cls = syms.find((s) => s.name === "Kls");
        expect(cls!.kind, "valueSet 缺省时不应夹取").toBe(5);
        expect(cls!.detail ?? "").not.toContain("kind clamped");
      },
    );
  });
});
