import { describe, it, expect } from "vitest";
import { checkWeb, displayOf, slotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 872 — web env 的 `navigator` 面缺 `hardwareConcurrency`。
 *
 * 根因：闭 obj 缺槽 ⇒ 成员读出 **exact `undefined`** ⇒ `undefined > 4` 按 JS
 * 语义折成 `false`（NaN 比较恒 false）⇒ 引擎**零诊断**地断言了一个假事实
 * （错值，不是抛）。
 *
 * 原生 oracle（node v26 / 浏览器，`NavigatorID` mixin）：
 * `navigator.hardwareConcurrency` 是**数字**（本机 16 核 ⇒ `> 4` 为 `true`）。
 *
 * 反向钉：删掉 `hardwareConcurrency` 槽 ⇒ 本文件必挂（签名回到
 * `undefined` / `false`）。
 */
describe("Bug 872 — navigator.hardwareConcurrency is modelled", () => {
  it("the navigator member table declares hardwareConcurrency", () => {
    expect(slotOf("navigator", "hardwareConcurrency")).toBeTruthy();
  });

  it("navigator.hardwareConcurrency reads as number (was exact undefined)", () => {
    const out = checkWeb(`export function f(){ return navigator.hardwareConcurrency; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^number/);
  });

  it("the comparison folds to boolean, not a hard-coded false", () => {
    const out = checkWeb(`export function f(){ return navigator.hardwareConcurrency > 4; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^boolean/);
    expect(displayOf(out)).not.toMatch(/^false/);
  });
});
