/**
 * Bug 112（对象字面量计算键访问器键双求值）：对象字面量 emitter 把同一
 * computedKeySrc 内嵌两处——占位槽写 $setKey(acc, key, void 0) 与访问器
 * 注册 $objAccessorKey(acc, key, …)——副作用键表达式翻倍
 *（`{ get ["a" + (n++, "")]() {} }` → n=2，native n=1）。
 *
 * 修复：IIFE 绑定临时键 __k，占位与注册共用（键求值保持在字面量位置；
 * 注册是侧表插入与位置无关）。计算数据键 / 计算方法键 / 静态键访问器
 * 本就单次，为 controls。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

const run = (src: string) => litValue(call(src).result);

describe("Bug 112: 计算键访问器的键表达式只求值一次", () => {
  it("get [计算键]：副作用计数 1（此前 2）", () => {
    expect(
      run(`export function f() { let n = 0; const o = { get ["a" + (n++, "")]() { return 1; } }; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("set [计算键]：副作用计数 1（此前 2）", () => {
    expect(
      run(`export function f() { let n = 0; const o = { set ["a" + (n++, "")](v) {} }; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("与后续数据属性混排：计数 1（getter 值经独立行钉住）", () => {
    expect(
      run(`export function f() { let n = 0; const o = { get ["a" + (n++, "")]() { return 42; }, b: 2 }; return n; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      run(`export function f() { let n = 0; const o = { get ["a" + (n++, "")]() { return 42; } }; return n * 100 + o.a; }`),
    ).toEqual({ ok: true, value: 142 });
  });

  it("访问器读写面与键存在性占位不回归", () => {
    expect(
      run(`export function f() { const k = "a"; const o = { get [k]() { return 42; } }; return o.a; }`),
    ).toEqual({ ok: true, value: 42 });
    expect(
      run(`export function f() { let s = 0; const k = "a"; const o = { set [k](v) { s = v; } }; o.a = 7; return s; }`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      run(`export function f() { const k = "a"; const o = { get [k]() { return 5; } }; return "a" in o; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("exec 差分对 native 对账（触发面 + getter 值）", () => {
    expect(diffBody(`let n = 0; const o = { get ["a" + (n++, "")]() { return 1; } }; return n;`)).toBeNull();
    expect(diffBody(`let n = 0; const o = { set ["a" + (n++, "")](v) {} }; return n;`)).toBeNull();
    expect(diffBody(`let n = 0; const o = { get ["a" + (n++, "")]() { return 1; }, b: 2 }; return n;`)).toBeNull();
  });
});

describe("Bug 112 controls：单次求值族不回归", () => {
  it("计算数据键 / 计算方法键：各一次", () => {
    expect(
      run(`export function f() { let n = 0; const o = { [("a" + (n++, ""))]: 1 }; return n; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      run(`export function f() { let n = 0; const o = { ["a" + (n++, "")]() { return 1; } }; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("静态键访问器：读派发计数不翻倍", () => {
    expect(
      run(`export function f() { let n = 0; const o = { get a() { return n++; } }; o.a; o.a; return n; }`),
    ).toEqual({ ok: true, value: 2 });
  });
});
