/**
 * Bug 258：`Function.prototype.apply` 传 **array-like** 实参时只传进 1 个实参。
 *
 * 原生 `CreateListFromArrayLike`：ToLength(argArray.length) → 逐下标 Get ⇒
 * `f.apply(null, {length: 2, 0: 1, 1: 2})` 传 **2 个**实参。
 *
 * 引擎此前：array-like 实参（非 tuple / 非 arr）一律折 `[unknown]`（1 个未知
 * 实参）⇒ 实参面塌陷（`arguments.length` 折 1；`a + b` 折未知和）。
 *
 * 钉：改前 engine=1 / native=2（MISMATCH）。
 */
import { describe, it, expect } from "vitest";
import { call } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";
import { diffBody } from "../../__tests__/differential/harness.ts";

function expectLit(src: string, expected: unknown) {
  const r = litValue(call(src, "f").result);
  if (!r.ok) {
    throw new Error(
      `expected literal ${String(expected)}, got non-literal result (domain / unknown)`,
    );
  }
  expect(r.value).toEqual(expected);
}

describe("Bug 258: apply 的 array-like 实参按 length 展开", () => {
  it("apply({length:2,0:1,1:2}) ⇒ 2 个实参（native 2）", () => {
    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, { length: 2, 0: 1, 1: 2 }); }`,
      2,
    );
  });

  it("apply 的实参值参与运算（native 3）", () => {
    expectLit(
      `export function f() { function g(a, b){ return a + b; } return g.apply(null, { length: 2, 0: 1, 1: 2 }); }`,
      3,
    );
  });

  it("apply({length:0}) ⇒ 0 个实参（native 0）", () => {
    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, { length: 0 }); }`,
      0,
    );
  });

  it("apply({length:1,0:9}) ⇒ 1 个实参（native 1）", () => {
    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, { length: 1, 0: 9 }); }`,
      1,
    );
  });

  it("control：apply 真数组 ⇒ 3 个实参（native 3）", () => {
    expectLit(
      `export function f() { function g(){ return arguments.length; } return g.apply(null, [1, 2, 3]); }`,
      3,
    );
  });

  it("差分对账（native oracle）：改前 MISMATCH / 改后一致", () => {
    expect(
      diffBody(
        `function g(){ return arguments.length; } return g.apply(null, { length: 2, 0: 1, 1: 2 });`,
      ),
    ).toBeNull();
    expect(
      diffBody(`function g(a, b){ return a + b; } return g.apply(null, { length: 2, 0: 1, 1: 2 });`),
    ).toBeNull();
  });
});
