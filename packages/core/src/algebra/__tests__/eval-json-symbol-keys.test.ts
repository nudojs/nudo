/**
 * Bug 73：计算 symbol 键投影为 "@@X" 字符串槽后，JSON.stringify 把它当
 * 可枚举字符串键序列化（'{"@@iterator":5}'，原生 "{}"）。修复：投影期
 * （[Symbol.X] 字面量/赋值/方法/访问器）经 $set opts.symbolKey 打
 * Slot.symbolKey 标记；stringifyObj（absToJsonNative / jsonStringifyTotal
 * / replacer 桥接共用 jsonEnumerableEntries）跳过标记槽。字面量字符串键
 * "{@@lit:1}" 无标记照常序列化（不得用 "@@" 前缀语法过滤——会误滤）。
 * $get/$set/$in 直连键访问与 spread/assign 拷贝不受影响。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

describe("Bug 73: JSON.stringify skips symbol-keyed slots", () => {
  it("computed Symbol.iterator key is not serialized", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({[Symbol.iterator]: 5}); }`).result))
      .toEqual({ ok: true, value: "{}" });
  });

  it("Symbol.toStringTag alongside a string key keeps only the string key", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({[Symbol.toStringTag]: "T", a: 1}); }`).result))
      .toEqual({ ok: true, value: '{"a":1}' });
  });

  it("assigned form o[Symbol.iterator] = 5 is not serialized", () => {
    expect(
      litValue(call(`export function f() { const o = {}; o[Symbol.iterator] = 5; return JSON.stringify(o); }`).result),
    ).toEqual({ ok: true, value: "{}" });
  });

  it("Symbol.asyncIterator key is not serialized", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({[Symbol.asyncIterator]: 5}); }`).result))
      .toEqual({ ok: true, value: "{}" });
  });

  it("nested array element objects skip symbol keys too", () => {
    expect(litValue(call(`export function f() { return JSON.stringify([{[Symbol.iterator]: 5}]); }`).result))
      .toEqual({ ok: true, value: "[{}]" });
  });

  it("control: literal \"@@lit\" string key still serializes", () => {
    // 字面量数据键不是 symbol 投影——无标记，原生两侧都序列化
    expect(litValue(call(`export function f() { return JSON.stringify({["@@lit"]: 1}); }`).result))
      .toEqual({ ok: true, value: '{"@@lit":1}' });
  });

  it("symbol-keyed object method is not serialized", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({[Symbol.iterator](){}, a: 1}); }`).result))
      .toEqual({ ok: true, value: '{"a":1}' });
  });

  it("symbol-keyed accessor is not serialized", () => {
    expect(
      litValue(
        call(`export function f() { return JSON.stringify({get [Symbol.toStringTag](){return "T"}, a: 1}); }`).result,
      ),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("overwrite keeps the symbol-key marker", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = {}; o[Symbol.iterator] = 5; o[Symbol.iterator] = 6; return JSON.stringify(o); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "{}" });
  });

  it("spread keeps the symbol key (native) but stringify still skips it", () => {
    // 原生 {...o} 拷贝 symbol 键；JSON.stringify 依旧跳过 → {"a":1}
    expect(
      litValue(
        call(
          `export function f() { const o = {[Symbol.iterator]: 5, a: 1}; const p = {...o}; return JSON.stringify(p); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("direct slot read of a symbol-projected key is unaffected", () => {
    expect(litValue(call(`export function f() { const o = {[Symbol.iterator]: 5}; return o[Symbol.iterator]; }`).result))
      .toEqual({ ok: true, value: 5 });
  });

  it("callable replacer walk also skips symbol-keyed slots", () => {
    expect(
      litValue(
        call(
          `export function f() { return JSON.stringify({[Symbol.iterator]: 5, a: 1}, (k, v) => v); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });
});
