/**
 * UpdateExpression（++/--）语义回归。
 *
 * 回归背景：transpile 把 `x++` 编成 `$add(x, 1)` / 后缀 `(x = $add(x,1), $sub(x,1))`。
 * `$add` 是 JS `+`——字符串操作数走拼接：
 *   let x = "5"; x++;   // 原生 x === 6，引擎 "51"
 *   let x = "5"; x++;   // 原生表达式值 5，引擎 50（后缀 undo 用 $sub("51",1)）
 *
 * 规范（ES UpdateExpression）：
 *   oldValue = ToNumeric(GetValue(lvalue))
 *   newValue = oldValue + 1   （1 随 oldValue 的 numeric type：number→1，bigint→1n）
 *   写回 newValue；前缀值 = newValue，后缀值 = oldValue
 *
 * 同类：后缀 undo `(x = x+1, x-1)` 在 IEEE 边界不保值：
 *   let x = 2**53; return x++;  // 原生 2**53，引擎 2**53-1
 * 必须先缓存 oldValue，不得用 `new-1` 还原。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function run(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  return callTranspiledExportFull(exports, fnName, []);
}

function val(src: string) {
  return litValue(run(src).result);
}

describe("UpdateExpression uses ToNumeric + numeric ± 1", () => {
  it("string numeric: x++ writes 6, not '51'", () => {
    expect(val(`export function f() { let x = "5"; x++; return x; }`)).toEqual({ ok: true, value: 6 });
  });

  it("string numeric: postfix expression value is old ToNumeric", () => {
    expect(val(`export function f() { let x = "5"; return x++; }`)).toEqual({ ok: true, value: 5 });
  });

  it("string numeric: x-- writes 4, postfix returns 5", () => {
    expect(val(`export function f() { let x = "5"; x--; return x; }`)).toEqual({ ok: true, value: 4 });
    expect(val(`export function f() { let x = "5"; return x--; }`)).toEqual({ ok: true, value: 5 });
  });

  it("prefix ++ on string numeric returns new value 6", () => {
    expect(val(`export function f() { let x = "5"; return ++x; }`)).toEqual({ ok: true, value: 6 });
  });

  it("non-numeric string: x++ → NaN (ToNumber), not concat", () => {
    const v = val(`export function f() { let x = "a"; x++; return x; }`);
    expect(v.ok && typeof v.value).toBe("number");
    expect(Number.isNaN(v.ok ? v.value : undefined)).toBe(true);
  });

  it("boolean/null: ToNumeric folds like native", () => {
    expect(val(`export function f() { let x = true; x++; return x; }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { let x = false; x++; return x; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { let x = null; x++; return x; }`)).toEqual({ ok: true, value: 1 });
  });

  it("bigint: x++ stays bigint (1n+1n), not mixed TypeError / number", () => {
    expect(val(`export function f() { let x = 1n; x++; return x; }`)).toEqual({ ok: true, value: 2n });
    expect(val(`export function f() { let x = 1n; return x++; }`)).toEqual({ ok: true, value: 1n });
    expect(val(`export function f() { let x = 1n; return ++x; }`)).toEqual({ ok: true, value: 2n });
  });

  it("number path unchanged", () => {
    expect(val(`export function f() { let x = 5; x++; return x; }`)).toEqual({ ok: true, value: 6 });
    expect(val(`export function f() { let x = 5; return x++; }`)).toEqual({ ok: true, value: 5 });
    expect(val(`export function f() { let x = 5; return ++x; }`)).toEqual({ ok: true, value: 6 });
    expect(val(`export function f() { let x = 5; x--; return x; }`)).toEqual({ ok: true, value: 4 });
  });

  it("same-expression later read sees updated value (x++ + x === 11)", () => {
    expect(val(`export function f() { let x = 5; return x++ + x; }`)).toEqual({ ok: true, value: 11 });
    expect(val(`export function f() { let x = 5; return ++x + x; }`)).toEqual({ ok: true, value: 12 });
  });

  it("postfix at 2^53 returns old value, not (new-1)", () => {
    // 2^53+1 rounds back to 2^53；undo 不能用 new-1
    expect(val(`export function f() { let x = 9007199254740992; return x++; }`)).toEqual({ ok: true, value: 9007199254740992, });
    expect(val(`export function f() { let x = 9007199254740992; x++; return x; }`)).toEqual({ ok: true, value: 9007199254740992, });
  });

  it("postfix at -2^53 similar IEEE boundary", () => {
    expect(val(`export function f() { let x = -9007199254740992; return x--; }`)).toEqual({ ok: true, value: -9007199254740992, });
  });
});
