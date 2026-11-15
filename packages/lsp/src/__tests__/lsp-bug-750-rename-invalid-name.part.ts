/**
 * Bug 750 —— `textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码
 * 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字），
 * `node --check` 直接 `SyntaxError`。
 *
 * 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后
 * **直接**当替换文本用，全程无标识符合法性 / 保留字校验。
 *
 * 修法（**只做语法层**，零跨片）：① 合法 JS 标识符
 * （`/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u`）；② 非保留字；
 * ③ 非空。⇒ 非法新名**不产出任何编辑**（返回 `null`）。
 *
 * ⚠ **「与同作用域已有绑定冲突」（重复声明）本族不做** —— 它需要作用域模型
 *   （`buildSymbolTable`，片 A 的地盘）⇒ 登记为独立后续项。本钉**不断言**
 *   重复声明被拒（那会与 AGENT-CONTEXT §4 的裁决冲突）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `export const alpha = 1;
export const beta = 2;
`;

/** `alpha` 的声明位（行 0，列 13）。 */
const ALPHA_POS = { line: 0, character: 13 };

type RenameResult = { changes: Record<string, Array<{ range: unknown; newText: string }>> } | null;

describe("Bug 750 — rename 校验新名字（语法层）", () => {
  it("非法标识符 ⇒ 不产出任何编辑", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("a.js") },
        position: ALPHA_POS,
        newName: "1bad",
      }) as RenameResult;
      expect(res, "非法标识符 '1bad' 仍产出了编辑").toBeNull();
    });
  });

  it("空名 ⇒ 不产出任何编辑", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("a.js") },
        position: ALPHA_POS,
        newName: "",
      }) as RenameResult;
      expect(res, "空名仍产出了编辑").toBeNull();
    });
  });

  it("保留字 ⇒ 不产出任何编辑", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      for (const word of ["class", "const", "function", "return", "await", "yield"]) {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("a.js") },
          position: ALPHA_POS,
          newName: word,
        }) as RenameResult;
        expect(res, `保留字 '${word}' 仍产出了编辑`).toBeNull();
      }
    });
  });

  it("合法新名 ⇒ 仍然正常改名（不得误伤）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("a.js") },
        position: ALPHA_POS,
        newName: "alphaRenamed",
      }) as RenameResult;
      expect(res, "合法新名被误拒").toBeTruthy();
      const changes = res!.changes ?? {};
      const edits = Object.entries(changes).flatMap(([u, list]) =>
        list.map((e) => `${u} ${JSON.stringify(e.newText)}`),
      );
      expect(edits.length, "合法改名没有编辑").toBeGreaterThan(0);
      expect(edits.every((e) => e.includes("alphaRenamed"))).toBe(true);
    });
  });

  it("合法但非常规的标识符（$ / _ /  Unicode）⇒ 仍然放行", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      for (const name of ["$alpha", "_alpha", "αlpha"]) {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("a.js") },
          position: ALPHA_POS,
          newName: name,
        }) as RenameResult;
        expect(res, `合法标识符 '${name}' 被误拒`).toBeTruthy();
      }
    });
  });
});
