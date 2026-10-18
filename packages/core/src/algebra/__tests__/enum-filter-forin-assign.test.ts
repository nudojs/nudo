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
    expect(val(src)).toEqual({ ok: true, value: true });
  });

  it("for-in on plain object still lists enumerable keys", () => {
    expect(
      val(`export function f() {
        const o = { a: 1, b: 2 };
        let n = 0;
        for (const k in o) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("Object.assign copies only enumerable own keys", () => {
    const src = `export function f() {
      ${setup}
      const t = Object.assign({}, s);
      return t.shown === 2 && !("hidden" in t) && Object.keys(t).length === 1;
    }`;
    expect(val(src)).toEqual({ ok: true, value: true });
  });

  it("Object.assign still copies enumerable values", () => {
    expect(
      val(`export function f() {
        return Object.assign({}, { a: 1, b: 2 }).a + Object.assign({}, { a: 1, b: 2 }).b;
      }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("Object.keys already filters (sibling must stay consistent)", () => {
    const src = `export function f() {
      ${setup}
      return Object.keys(s).length === 1 && Object.keys(s)[0] === "shown";
    }`;
    expect(val(src)).toEqual({ ok: true, value: true });
  });
});

// --- Bug 109：spread / rest 的枚举视图（CopyDataProperties） ----------------

describe("Bug 109: spread/rest enumerable view (CopyDataProperties)", () => {
  it("非枚举键不进 spread 结果（in 检查 + 键序 + JSON 投影）", () => {
    const setup109 = `
      const src = {};
      Object.defineProperty(src, "a", { value: 1, enumerable: false });
      src.b = 2;
    `;
    expect(
      val(`export function f() {
      ${setup109}
      return "a" in ({ ...src });
    }`),
    ).toEqual({ ok: true, value: false });
    expect(
      val(`export function f() {
      ${setup109}
      return Object.keys({ ...src }).join(",");
    }`),
    ).toEqual({ ok: true, value: "b" });
    expect(
      val(`export function f() {
      ${setup109}
      return JSON.stringify({ ...src });
    }`),
    ).toEqual({ ok: true, value: '{"b":2}' });
  });

  it("非枚举键不进 rest 解构（named 提取 + rest 键集）", () => {
    expect(
      val(`export function f() {
      const src = {};
      Object.defineProperty(src, "a", { value: 1, enumerable: false });
      const { a, ...r } = src;
      return JSON.stringify(r);
    }`),
    ).toEqual({ ok: true, value: "{}" });
  });

  it("非枚举访问器 getter 不被 spread 调用（枚举访问器照常物化）", () => {
    expect(
      val(`export function f() {
      const src = {};
      Object.defineProperty(src, "a", { get() { return 5; }, enumerable: false });
      return "a" in ({ ...src });
    }`),
    ).toEqual({ ok: true, value: false });
    expect(
      val(`export function f() {
      const src = {};
      Object.defineProperty(src, "a", { get() { return 5; }, enumerable: true });
      return JSON.stringify({ ...src });
    }`),
    ).toEqual({ ok: true, value: '{"a":5}' });
  });

  it("枚举键照常展开 / for-in·assign 既有面不回归（control）", () => {
    expect(
      val(`export function f() {
      const src = {};
      Object.defineProperty(src, "a", { value: 1, enumerable: true });
      return "a" in ({ ...src });
    }`),
    ).toEqual({ ok: true, value: true });
    expect(
      val(`export function f() {
      const src = {};
      Object.defineProperty(src, "a", { value: 1, enumerable: false });
      return "a" in Object.assign({}, src);
    }`),
    ).toEqual({ ok: true, value: false });
    expect(
      val(`export function f() {
      const src = {};
      Object.defineProperty(src, "a", { value: 1, enumerable: false });
      let n = 0;
      for (const k in src) n++;
      return n;
    }`),
    ).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { return JSON.stringify({ ...{ a: 1 } }); }`)).toEqual({
      ok: true,
      value: '{"a":1}',
    });
  });
});
