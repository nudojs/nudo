import { describe, it, expect } from "vitest";
import { checkWeb, slotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 873 — web env 的 `AbortSignal` 面缺静态工厂 `any`。
 *
 * 根因：`AbortSignal` 只建模了 `abort` / `timeout` 两个静态方法 ⇒ 成员读 `any`
 * 落到 exact `undefined` ⇒ 调用 undefined ⇒ **定抛 TypeError** ⇒ L2 门禁假红。
 *
 * 原生 oracle（node v26.10.0）：`typeof AbortSignal.any === "function"`，
 * `AbortSignal.any([])` 返回 `AbortSignal` 实例 ⇒ **不抛**。
 *
 * 反向钉：删掉 `any` 槽 ⇒ 本文件必挂。
 */
describe("Bug 873 — AbortSignal.any is declared", () => {
  it("the AbortSignal member table declares any", () => {
    expect(slotOf("AbortSignal", "any")).toBeTruthy();
  });

  it("AbortSignal.any([...]) does not throw (was definite TypeError)", () => {
    const out = checkWeb(`export function f(){ return AbortSignal.any([]); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).not.toContain("TypeError");
  });

  it("AbortSignal.abort / timeout stay declared", () => {
    for (const name of ["abort", "timeout"] as const) {
      expect(slotOf("AbortSignal", name), `AbortSignal.${name}`).toBeTruthy();
    }
  });
});
