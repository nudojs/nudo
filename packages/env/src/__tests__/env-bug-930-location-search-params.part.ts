import { describe, it, expect } from "vitest";
import { checkWeb, displayOf, slotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 930 — web env 的 `location` 全局成员表缺 `searchParams`。
 *
 * 根因：`location` 是**闭合**对象（`objAbs` 默认 closed），槽表只列了 12 个成员，
 * 漏了 `searchParams` ⇒ 成员读落到「闭 obj 缺槽」⇒ **exact `undefined`** ⇒
 * 链式读 `.get` ⇒ 引擎判「**确定抛 TypeError**」⇒ 该函数体整个变成
 * throw-only ⇒ 返回域落成 `never` ⇒ `nudo:entry-may-throw`（error）⇒ 门禁假红。
 *
 * 原生 oracle（浏览器 `Location` 实例；node 锚点）：
 *   new URL("http://x/?q=1").searchParams.get("q") → "1"
 *   location.searchParams.get("q") → string | null（**恒不抛**）
 *
 * 反向钉：删掉 `searchParams` 槽 ⇒ 本文件必挂。
 */
describe("Bug 930 — location.searchParams is modelled", () => {
  it("the location member table declares searchParams", () => {
    expect(slotOf("location", "searchParams")).toBeTruthy();
  });

  it("location.searchParams.get('q') does not throw (was definite TypeError)", () => {
    const out = checkWeb(`export function f(){ return location.searchParams.get("q"); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("the read folds to string | null (native Location.searchParams.get)", () => {
    const out = checkWeb(`export function f(){ return location.searchParams.get("q"); }`);
    expect(displayOf(out)).toMatch(/^string \| null/);
  });

  it("the other location members are still declared", () => {
    for (const name of ["href", "origin", "protocol", "host", "pathname", "search", "hash"] as const) {
      expect(slotOf("location", name), `location.${name}`).toBeTruthy();
    }
  });
});
