/**
 * string.match / string.matchAll 边界（B 路径）。
 *
 * 原生语义：
 * - match(/re/g) 无命中 → null（不是空数组）；有命中 → 命中串数组。
 * - matchAll(/re/) 要求正则带 g 标志，否则 TypeError
 *   （"String.prototype.matchAll argument must not be a non-global
 *   regular expression"）；带 g 时迭代全部命中（每项 [full, ...groups]）。
 *
 * 修复前：match(/d/g) 无命中把 null 折成 []（假精确）；
 * matchAll 完全未建模——非全局不抛（假控制流），`[...'aaa'.matchAll(/a/g)].length`
 * 折 1（原生 3）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("B-path string.match with /g flag", () => {
  it("no match returns null (not [])", () => {
    expect(litValue(call(`export function f() { return 'a1b2'.match(/d/g) === null; }`).result)).toBe(true);
  });

  it("matches return the hit strings", () => {
    const r = call(`export function f() { const m = 'a1b2'.match(/\\d/g); return m[0] + ':' + m[1]; }`);
    expect(litValue(r.result)).toBe("1:2");
  });

  it("non-global no-match keeps null", () => {
    expect(litValue(call(`export function f() { return 'abc'.match(/z/) === null; }`).result)).toBe(true);
  });

  it("non-global match keeps groups", () => {
    const r = call(`export function f() { const m = 'abc'.match(/a(b)c/); return m[0] + ':' + m[1]; }`);
    expect(litValue(r.result)).toBe("abc:b");
  });
});

describe("B-path string.matchAll", () => {
  it("non-global regex throws TypeError", () => {
    const r = call(`export function f() { return [...'abc'.matchAll(/b/)].length; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("non-global regex throw is catchable", () => {
    const r = call(
      `export function f() { try { [...'abc'.matchAll(/b/)]; } catch(e) { return 'caught'; } return 'missed'; }`,
    );
    expect(litValue(r.result)).toBe("caught");
  });

  it("global regex yields every match", () => {
    const r = call(`export function f() { return [...'aaa'.matchAll(/a/g)].length; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("global regex exposes groups per match", () => {
    const r = call(`export function f() { const m = [...'ab'.matchAll(/(a)(b)/g)][0]; return m[1] + m[2]; }`);
    expect(litValue(r.result)).toBe("ab");
  });

  it("zero matches yields empty spread", () => {
    const r = call(`export function f() { return [...'abc'.matchAll(/z/g)].length; }`);
    expect(litValue(r.result)).toBe(0);
  });

  it("empty-pattern matches at every position", () => {
    const r = call(`export function f() { return [...'ab'.matchAll(/(?:)/g)].length; }`);
    expect(litValue(r.result)).toBe(3);
  });

  // RegExpStringIterator 是迭代器对象：没有 .length（undefined），
  // 只有 spread/Array.from/for-of 消费。此前折 tuple 暴露幽灵 length。
  it("matchAll iterator has no length property", () => {
    expect(litValue(call(`export function f() { return 'abcabc'.matchAll(/b/g).length ?? 'none'; }`).result)).toBe("none");
    expect(litValue(call(`export function f() { return typeof 'abc'.matchAll(/b/g); }`).result)).toBe("object");
  });

  it("matchAll iterator stays spreadable and Array.from-able", () => {
    expect(litValue(call(`export function f() { return [...'abcabc'.matchAll(/b/g)].length; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return [...'abcabc'.matchAll(/b/g)][0][0]; }`).result)).toBe("b");
    expect(litValue(call(`export function f() { return [...'abcabc'.matchAll(/b/g)][1][0]; }`).result)).toBe("b");
    expect(litValue(call(`export function f() { let n = 0; Array.from('abcabc'.matchAll(/b/g), (m) => { n++; return m; }); return n; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return [...'abc'.matchAll(/z/g)].length; }`).result)).toBe(0);
  });
});
