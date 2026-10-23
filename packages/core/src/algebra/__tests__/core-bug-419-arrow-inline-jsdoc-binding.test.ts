/**
 * Bug 419 —— 箭头函数**初始化器上的** JSDoc 绑到 `<anonymous>` 而不是导出名 `f`
 * → 见证落在错的函数名下（`nudo test` 打出 `=== <anonymous> ===`）。
 *
 * 根因（`directive-scan.ts` 的 `VariableDeclaration` 分支）：它按**语句**的
 * `leadingComments` 建了一个名为 `f` 的 scope（内联形态下为空），而**内联**
 * JSDoc 落在初始化器（`ArrowFunctionExpression`）节点上 ⇒ 见证被登记在
 * `<anonymous>` 名下。
 *
 * 修法：变量声明的函数初始化器**只建一个** scope，名字取**绑定名**（`f`），
 * 注释取「函数节点自身 + 语句宿主」的合并（语句级与内联两种形态都可见）。
 */
import { describe, it, expect } from "vitest";
import { findFnDirectiveScope, listFnDirectiveScopes, parseSource } from "../index.ts";

const INLINE = `const f = /** @nudo:case "inline" (1) */ () => 1;
export { f };
`;

const ABOVE = `/**
 * @nudo:case "inline" (1)
 */
const f = () => 1;
export { f };
`;

const INLINE_FN_EXPR = `const f = /** @nudo:case "inline" (1) */ function () { return 1; };
export { f };
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource(src));
}

describe("Bug 419 — 箭头初始化器上的内联 JSDoc 绑到绑定名", () => {
  it("内联形态：见证落在 f 上", () => {
    const f = scopesOf(INLINE).find((s) => s.name === "f");
    expect(f?.commentLines).toContain('@nudo:case "inline" (1)');
  });

  it("内联形态：不再产生 <anonymous> 影子 scope", () => {
    const names = scopesOf(INLINE).map((s) => s.name);
    expect(names).toEqual(["f"]);
    expect(names).not.toContain("<anonymous>");
  });

  it("内联形态：按名查找拿到 f 的注释行", () => {
    const scope = findFnDirectiveScope(parseSource(INLINE), "f");
    expect(scope?.commentLines).toContain('@nudo:case "inline" (1)');
  });

  it("语句级形态（对照）：见证同样落在 f 上", () => {
    const f = scopesOf(ABOVE).find((s) => s.name === "f");
    expect(f?.commentLines).toContain('@nudo:case "inline" (1)');
    expect(scopesOf(ABOVE).map((s) => s.name)).toEqual(["f"]);
  });

  it("函数表达式初始化器的内联形态同样绑到绑定名", () => {
    const f = scopesOf(INLINE_FN_EXPR).find((s) => s.name === "f");
    expect(f?.commentLines).toContain('@nudo:case "inline" (1)');
  });
});
