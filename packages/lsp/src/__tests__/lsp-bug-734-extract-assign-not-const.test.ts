/**
 * Bug 734 —— Extract 在 `capturedWrites` 路径**一律**生成 `const <name> = <call>()`，
 * 不区分「原本是声明」与「原本是赋值」⇒ 被抽出的若是**赋值表达式**
 * （`x = compute();`），调用点就变成 `const x = extracted(...)` ⇒ 与外层已有的
 * `let x` **重复声明** ⇒ `SyntaxError: Identifier 'x' has already been declared`
 * ⇒ 文件彻底不可解析。
 *
 * 根因（`packages/lsp/src/extract-function.ts` 的 capturedWrites 分支）：调用点文本
 * 硬编码 `const`，且 `capturedWrites` 不记录「这一条写到底是声明还是赋值」。
 *
 * 修法：区分两种写 ——
 * - assign（选区内是 `x = …`，x 声明在选区外）⇒ 调用点用**赋值表达式**
 *   `x = extracted(...)`，**不得**引入新的 `const`。
 * - declare（选区内是 `const/let/var x = …`）⇒ 调用点还原**同种声明**。
 *
 * oracle（改前 → 改后）：
 *   改前 callText = "const x = extracted(compute);" ⇒ newText 不可解析
 *        （Babel: Identifier 'x' has already been declared. (7:8)）
 *   改后 callText = "x = extracted(compute);" ⇒ newText 可解析
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { extractFunction } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

const SRC = `export function f(compute) {
  let x = 0;
  x = compute();
  return x;
}
`;

/** 选区 = 第 3 行（0 基）的 `x = compute();` */
const SEL = { start: { line: 2, character: 2 }, end: { line: 2, character: 16 } };

describe("Bug 734 · Extract 的赋值写法不引入重复 const 声明", () => {
  it("调用点是赋值表达式，不是 const 声明", () => {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 "const x = extracted(compute);"
    expect(r.callText).toBe("x = extracted(compute);");
    expect(r.callText).not.toContain("const x");
  });

  it("产物不再有重复声明（可解析）", () => {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newText).not.toContain("const x = extracted");
    expect(r.newText).toContain("x = extracted(compute);");
    expect(r.newText).toContain("let x = 0;");
    // 改前：Identifier 'x' has already been declared
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("协议面：codeAction 下发的文本里没有重复 const 声明", async () => {
    await withLspServer({ "m.mjs": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText).not.toContain("const x = extracted");
      expect(newText).toContain("x = extracted(compute);");
    });
  });

  it("对照：原本就是声明时，调用点仍是同种声明（const）", () => {
    const src = `function outer(a, b) {
  const t = a + b;
  const u = t * 2;
  return u;
}
`;
    const r = extractFunction(
      src,
      { start: { line: 1, character: 2 }, end: { line: 3, character: 0 } },
      { name: "combine" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callText).toBe("const u = combine(a, b);");
  });
});
