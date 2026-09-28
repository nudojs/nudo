/**
 * enumerable 过滤回归：for-in / Object.assign 只枚举 enumerable 自有键。
 *
 * 回归背景：
 * - `$forInKeys` 用 Object.keys(slots) 不查 getPropFlags().enumerable
 *   —— Object.keys(o) 自己有 enumKeys 过滤，for-in 没有（同类不一致）。
 * - `runtimeAssignObject` / evalObjectMethod("assign") 同样不滤 non-enumerable，
 *   把 hidden 一并拷过去。
 *
 * ES：for-in 与 Object.assign 都走 [[OwnPropertyKeys]] + enumerable 过滤
 * （assign 还走 Set，与 spread 对 __proto__ 的语义不同——本套只覆盖 enumerable）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function run(src: string) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", []);
}

function val(src: string) {
  return litValue(run(src).result);
}

const setup = `
  const s = {};
  Object.defineProperty(s, "hidden", { value: 1, enumerable: false });
  Object.defineProperty(s, "shown",  { value: 2, enumerable: true });
`;

describe("enumerable filter: for-in and Object.assign", () => {
  it("for-in skips non-enumerable own keys", () => {
    const src = `export function f() {
      ${setup}
      const ks = [];
      for (const k in s) ks.push(k);
      return ks.length === 1 && ks[0] === "shown";
    }`;
    expect(val(src)).toBe(true);
  });

  it("for-in on plain object still lists enumerable keys", () => {
    expect(
      val(`export function f() {
        const o = { a: 1, b: 2 };
        let n = 0;
        for (const k in o) n++;
        return n;
      }`),
    ).toBe(2);
  });

  it("Object.assign copies only enumerable own keys", () => {
    const src = `export function f() {
      ${setup}
      const t = Object.assign({}, s);
      return t.shown === 2 && !("hidden" in t) && Object.keys(t).length === 1;
    }`;
    expect(val(src)).toBe(true);
  });

  it("Object.assign still copies enumerable values", () => {
    expect(
      val(`export function f() {
        return Object.assign({}, { a: 1, b: 2 }).a + Object.assign({}, { a: 1, b: 2 }).b;
      }`),
    ).toBe(3);
  });

  it("Object.keys already filters (sibling must stay consistent)", () => {
    const src = `export function f() {
      ${setup}
      return Object.keys(s).length === 1 && Object.keys(s)[0] === "shown";
    }`;
    expect(val(src)).toBe(true);
  });
});
