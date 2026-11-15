/**
 * Bug 745 —— `workspace/symbol` **从不返回类方法 / 类属性**（只返回类本身）。
 *
 * 根因：`onWorkspaceSymbol`（`server-navigation.ts`）只遍历 `documentSymbols(ast)`
 * 的**顶层**结果，**不下钻 `sym.children`**；而 `documentSymbols`（`symbols.ts`）
 * 恰恰把类成员放在 `children` 里 ⇒ 类方法 / 类属性**永远**不进搜索结果。
 *
 * 修法：**递归下钻并扁平化**成 `SymbolInformation[]`（层级关系用
 * `containerName` 表达）⇒ 与 LSP 的扁平协议相符。
 *
 * ⚠ **独立于本条的口径问题（本族不修）**：`workspace/symbol` 扫的是
 *   `knownFiles`（由 `validateText` 登记）+ 已打开文档 ⇒ **只有被分析过的
 *   文件**才进搜索 ⇒ 搜一个「只被 import 从未单独打开分析过」的文件的类方法
 *   仍可能搜不到（登记为族 24 残留项）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

/** 夹具：类 + 类方法 + 类属性 + 顶层函数（顶层名互不含查询串 ⇒ 断言精确）。 */
const SRC = `export class Kls {
  alphaMethod() {}
  betaProp = 1;
}
export function gammaFn() {}
`;

type WsSymbol = {
  name: string;
  kind: number;
  containerName?: string;
  location: { uri: string; range: { start: { line: number; character: number } } };
};

describe("Bug 745 — workspace/symbol 返回类成员（递归下钻 + 扁平化）", () => {
  it("类方法进搜索结果（带 containerName）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req, uri }) => {
      const syms = req("workspace/symbol")({ query: "alphaMethod" }) as WsSymbol[];
      expect(syms.map((s) => s.name), "类方法没进 workspace/symbol").toEqual(["alphaMethod"]);
      expect(syms[0].kind, "类方法的 kind 应是 Method(6)").toBe(6);
      expect(syms[0].containerName, "类方法应带 containerName（所属类）").toBe("Kls");
      expect(syms[0].location.uri).toBe(uri("kls.js"));
      expect(syms[0].location.range.start).toEqual({ line: 1, character: 2 });
    });
  });

  it("类属性进搜索结果（带 containerName）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req }) => {
      const syms = req("workspace/symbol")({ query: "betaProp" }) as WsSymbol[];
      expect(syms.map((s) => s.name), "类属性没进 workspace/symbol").toEqual(["betaProp"]);
      expect(syms[0].kind, "类属性的 kind 应是 Property(7)").toBe(7);
      expect(syms[0].containerName).toBe("Kls");
    });
  });

  it("顶层符号仍在（不得因下钻而丢顶层）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req }) => {
      const cls = req("workspace/symbol")({ query: "Kls" }) as WsSymbol[];
      expect(cls.map((s) => s.name)).toEqual(["Kls"]);
      expect(cls[0].kind, "类的 kind 应是 Class(5)").toBe(5);
      expect(cls[0].containerName, "顶层符号不应有 containerName").toBeUndefined();

      const fn = req("workspace/symbol")({ query: "gammaFn" }) as WsSymbol[];
      expect(fn.map((s) => s.name)).toEqual(["gammaFn"]);
      expect(fn[0].kind, "函数的 kind 应是 Function(12)").toBe(12);
    });
  });

  it("对照：同一份 AST 的 documentSymbol 层级式结果含 children（证明同一 AST 两种结果）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("kls.js") },
      }) as Array<{ name: string; children?: Array<{ name: string; kind: number }> }>;
      const cls = syms.find((s) => s.name === "Kls");
      expect(cls, "documentSymbol 里没有 Kls").toBeTruthy();
      expect((cls!.children ?? []).map((c) => c.name)).toEqual(["alphaMethod", "betaProp"]);
    });
  });
});
