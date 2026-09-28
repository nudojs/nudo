/**
 * 可选链 × RegExp 状态写回：`r.exec(s)?.[0]` / `r.test(s)?.x` 整链短路编译
 * 不得丢掉 `$reStateCall`（lastIndex）。
 *
 * 回归背景：flattenChain 的 invoke hop 只发 `$invoke`，漏了非链路径
 * （`REGEX_STATEFUL_NAMES` + Identifier receiver）的 lastIndex 写回 IIFE。
 * `r.exec(s)?.[1]` 是常见写法——lastIndex 不推进会得到错误的重复匹配。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
} from "@nudojs/core";

function run(src: string) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", []);
}

function val(src: string) {
  return litValue(run(src).result);
}

function expectExactUndefined(src: string) {
  const r = run(src);
  expect(r.throws?.shape?.k, `throws for: ${src}`).toBe("never");
  expect(formatAbs(r.result), `result for: ${src}`).toContain("undefined");
  expect(litValue(r.result), `lit for: ${src}`).toBeUndefined();
}

describe("optional chain keeps RegExp lastIndex writeback", () => {
  it("r.exec(s)?.[0] advances lastIndex", () => {
    expect(
      val(`export function f() {
        const r = /b/g;
        const m = r.exec("abc")?.[0];
        return m === "b" && r.lastIndex === 2;
      }`),
    ).toBe(true);
  });

  it("r.exec(s)?.groups advances lastIndex", () => {
    expect(
      val(`export function f() {
        const r = /(?<x>b)/g;
        const g = r.exec("abc")?.groups;
        return r.lastIndex === 2;
      }`),
    ).toBe(true);
  });

  it("r.test(s)?.foo advances lastIndex even when rest short-circuits", () => {
    // test 成功 → 匹配结果非 nullish 不会在 ?. 处短路；写回仍要发生
    expect(
      val(`export function f() {
        const r = /b/g;
        const hit = r.test("abc")?.foo;
        return r.lastIndex === 2;
      }`),
    ).toBe(true);
  });

  it("consecutive exec via optional chain behaves like non-optional", () => {
    expect(
      val(`export function f() {
        const r = /b/g;
        const a = r.exec("abc")?.[0];
        const b = r.exec("abc")?.[0];
        const c = r.exec("abc")?.[0];
        return a === "b" && b === undefined && c === "b";
      }`),
    ).toBe(true);
  });

  it("r?.exec(s)?.[0] on null receiver short-circuits without throw", () => {
    const r = null;
    expectExactUndefined(`export function f() { const r = null; return r?.exec("abc")?.[0]; }`);
  });

  it("non-optional exec still rebinds (sibling stays consistent)", () => {
    expect(
      val(`export function f() {
        const r = /b/g;
        const m = r.exec("abc");
        return m[0] === "b" && r.lastIndex === 2;
      }`),
    ).toBe(true);
  });
});

describe("optional chain computed-string method keeps this", () => {
  it('o["m"]?.() binds this to o', () => {
    expect(
      val(`export function f() {
        const o = { n: 7, m() { return this.n; } };
        return o["m"]?.();
      }`),
    ).toBe(7);
  });

  it('o["m"]?.() on missing method → undefined', () => {
    expectExactUndefined(`export function f() { const o = {}; return o["m"]?.(); }`);
  });

  it('r["exec"](s)?.[0] advances lastIndex (computed-string invoke)', () => {
    expect(
      val(`export function f() {
        const r = /b/g;
        const m = r["exec"]("abc")?.[0];
        return m === "b" && r.lastIndex === 2;
      }`),
    ).toBe(true);
  });
});
