/**
 * Bug 380：**转译器「不支持的构造」让 L2 入口 may-throw 门禁由红转绿**。
 *
 * 根因：check-may-throw.ts 的 `evalThrowsOf` 在 `tryRunTranspiled` 返回
 * undefined（转译器抛 NudoUnsupportedError）时**放弃整条 L2 证据** ⇒
 * 门禁看到的是「**没有** may-throw」⇒ 与「**没分析出** may-throw」混同
 * ⇒ 逐字只差一个 `++` 的两个表达式结论相反：
 *   `return g().x`    → L2 error（may throw TypeError）
 *   `return g().x++`  → 零 error（假绿，exit 0）
 *
 * 修法（fail-closed）：转译失败 ⇒ 入口**不可判定** ⇒ 记一条 fail-closed
 * 证据（kind=Error ⇒「入口**可能**抛 Error」是 sound 的过近似：未能分析
 * ⇒ 不能证明入口 total）。用户可用 `@nudo:throws Error` / `--ignore-throws
 * Error` 显式放行。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts, l2Count, sigOf } from "./nudo-constraints.ts";
import { effects } from "./eval-helpers.ts";

const updSrc = `export function f(g) { return g().x++; }`;
const delSrc = `export function f(g) { return delete (g() + 1); }`;

describe("Bug 380：转译器拒绝构造 ⇒ L2 门禁不得由红转绿", () => {
  it("g().x++（不可写回的 update 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）", () => {
    const r = checkSource("c6.js", updSrc, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("delete (g() + 1)（非成员 delete 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）", () => {
    const r = checkSource("c7.js", delSrc, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("fail-closed 证据可被 @nudo:throws Error 显式放行（用户可自证有意 fail-fast）", () => {
    const src = `/**
 * @nudo:throws Error
 */
export function f(g) { return g().x++; }`;
    const r = checkSource("c6.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
    // 证据仍上屏（门禁过滤 ≠ 藏事实）
    expect(sigOf(r, "f")).toContain("throws");
  });

  it("同模块的**其它**入口不做过度断言（原生下它们并不抛）", () => {
    // 转译失败是模块级的（tricky 里的不支持构造让整个模块未求值）⇒ 若对
    // 兄弟入口 safe 也断言「可能抛 Error」，那是**不 sound** 的过度断言。
    const src = `export function safe() { return 1; }
export function tricky(g) { return g().x++; }`;
    const r = checkSource("mixed.js", src, pTrue, stdOpts);
    expect(l2Count(r, "tricky")).toBe(1);
    expect(l2Count(r, "safe")).toBe(0);
  });

  it("eval 层：可分析的孪生表达式记 TypeError 效果；不可分析的那个连模块都起不来", () => {
    expect(effects(`export function f(g) { return g().x; }`, "f")).toContain("TypeError");
    // 转译器拒绝 ⇒ 模块整体未求值（这正是「证据整条丢失」的根因）
    expect(() => effects(updSrc, "f")).toThrow();
  });
});
