/**
 * Bug 418 —— 一个 JSDoc 被绑到多声明符 `const` 的**每一个** declarator 上
 * （TS 地真：只绑**首个**）→ 一条见证被重放 N 次。
 *
 * 根因（`directive-scan.ts` 的 `VariableDeclaration` 分支）：语句级
 * `leadingComments` 被**逐个** declarator 复制给各自建出的 scope ⇒
 * `const a = () => 1, b = () => 2` 上的 `@nudo:case "shared"` 同时落在 `a`
 * 与 `b` 上 ⇒ `nudo test` 打出**重复的 case 名**（见证重放）。
 *
 * 修法：语句级 JSDoc **只绑首个 declarator**（TS 口径）；其余 declarator
 * 只认自己的**内联**注释。
 */
import { describe, it, expect } from "vitest";
import { listFnDirectiveScopes, parseSource } from "../index.ts";

const MULTI = `/**
 * @nudo:case "shared" (1)
 */
const a = () => 1, b = () => 2;
export { a, b };
`;

const MULTI_INLINE_SECOND = `const a = () => 1, b = /** @nudo:case "own" (2) */ () => 2;
export { a, b };
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource(src));
}

function scopeNamed(src: string, name: string) {
  return scopesOf(src).find((s) => s.name === name);
}

describe("Bug 418 — 多声明符 const：语句级 JSDoc 只绑首个 declarator", () => {
  it("见证只落在首个 declarator 上（不再重放到 b）", () => {
    const a = scopeNamed(MULTI, "a");
    const b = scopeNamed(MULTI, "b");
    expect(a?.commentLines).toContain('@nudo:case "shared" (1)');
    expect(b?.commentLines ?? []).toEqual([]);
  });

  it("每个 declarator 只建一个 scope（不再多出 <anonymous> 影子）", () => {
    const names = scopesOf(MULTI).map((s) => s.name);
    expect(names).toEqual(["a", "b"]);
    expect(names.filter((n) => n === "<anonymous>")).toEqual([]);
  });

  it("第二个 declarator 的内联注释仍归它自己", () => {
    const b = scopeNamed(MULTI_INLINE_SECOND, "b");
    expect(b?.commentLines).toContain('@nudo:case "own" (2)');
    const a = scopeNamed(MULTI_INLINE_SECOND, "a");
    expect(a?.commentLines ?? []).toEqual([]);
  });

  it("单声明符形态不受影响（见证仍可见）", () => {
    const only = `/**
 * @nudo:case "solo" (1)
 */
const a = () => 1;
export { a };
`;
    expect(scopeNamed(only, "a")?.commentLines).toContain('@nudo:case "solo" (1)');
  });
});
