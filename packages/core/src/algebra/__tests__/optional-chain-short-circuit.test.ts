/**
 * 可选链短路回归：`?.` 一旦命中 nullish，**剩余整条链**返回 undefined，
 * 不得再对后续非可选访问求值/抛 TypeError。
 *
 * 回归背景：transpile 把 `o?.user.name` 编成 `$get($optionalGet(o, "user"), "name")`。
 * `$optionalGet` 只短路**当前一跳**（nullish → undefined），下一跳 `$get(undefined, "name")`
 * 走 nullish 成员硬抛 TypeError。ES 语义：
 *   `a?.b.c` ≡ `a == null ? undefined : a.b.c`   // a 非 nullish 后，.b.c 正常（null.name 仍抛）
 * 同类缺口：
 *   - `o?.length` / `o?.[k]` 路由到 $len/$idx，忽略 optional，不短路
 *   - `g?.()` 标识符调用路径忽略 optionalCall
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function run(src: string) {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, "f", []);
}

/** 结果必须是精确 undefined，且不得抛 */
function expectExactUndefined(src: string) {
  const r = run(src);
  expect(r.throws?.shape?.k, `throws for: ${src}`).toBe("never");
  expect(formatAbs(r.result), `result for: ${src}`).toContain("undefined");
  expect(litValue(r.result), `lit for: ${src}`).toBeUndefined();
}

/** 原生语义：非可选后续访问打在 null 上必须抛 TypeError */
function expectTypeError(src: string) {
  const r = run(src);
  const k = r.throws?.shape?.k;
  const name = r.throws?.shape?.k === "brand" ? (r.throws as { shape: { name: string } }).shape.name : k;
  expect(name, `throws for: ${src}`).toBe("TypeError");
}

function val(src: string) {
  return litValue(run(src).result);
}

describe("optional chain short-circuits the remaining chain", () => {
  it("o?.user.name on null → undefined (short-circuit rest)", () => {
    expectExactUndefined(`export function f() { const o = null; return o?.user.name; }`);
  });

  it("o?.user.name on {user:null} → TypeError (rest is non-optional)", () => {
    // o 非 nullish，进入 .user.name；null.name 原生抛——不得被可选链吞掉
    expectTypeError(`export function f() { const o = { user: null }; return o?.user.name; }`);
  });

  it("o?.a.b.c on null → undefined", () => {
    expectExactUndefined(`export function f() { const o = null; return o?.a.b.c; }`);
  });

  it("o?.user.name on {user:{name:'x'}} still reads through", () => {
    expect(val(`export function f() { const o = { user: { name: "x" } }; return o?.user.name; }`)).toBe(
      "x",
    );
  });

  it("o?.user?.name on null still undefined (all-optional)", () => {
    expectExactUndefined(`export function f() { const o = null; return o?.user?.name; }`);
  });

  it("o?.user?.name on {user:null} → undefined (second hop optional)", () => {
    expectExactUndefined(`export function f() { const o = { user: null }; return o?.user?.name; }`);
  });

  it("o?.length on null → undefined (not unknown, no throw)", () => {
    expectExactUndefined(`export function f() { const o = null; return o?.length; }`);
  });

  it("o?.[k] on null → undefined", () => {
    expectExactUndefined(`export function f() { const o = null; const k = "a"; return o?.[k]; }`);
  });

  it("o?.[k].x on null → undefined (computed then non-optional)", () => {
    expectExactUndefined(`export function f() { const o = null; const k = "a"; return o?.[k].x; }`);
  });

  it("call: g?.() on null callee → undefined, no throw", () => {
    expectExactUndefined(`export function f() { const g = null; return g?.(); }`);
  });

  it("call: g?.(1) on function still calls", () => {
    expect(val(`export function f() { const g = (x) => x + 1; return g?.(1); }`)).toBe(2);
  });

  it("obj.method?.() on missing method → undefined", () => {
    expectExactUndefined(`export function f() { const o = {}; return o.m?.(); }`);
  });

  it("obj.method?.() on {m:null} → undefined (optional call)", () => {
    expectExactUndefined(`export function f() { const o = { m: null }; return o.m?.(); }`);
  });

  it("deep: a?.b.c.d on null → undefined", () => {
    expectExactUndefined(`export function f() { const a = null; return a?.b.c.d; }`);
  });

  it("a?.b.c on {b:{c:1}} reads through", () => {
    expect(val(`export function f() { const a = { b: { c: 1 } }; return a?.b.c; }`)).toBe(1);
  });
});
