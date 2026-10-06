/**
 * litValue 哨兵：lit(undefined) 与「无字面量 / 抽象实参」不得混同。
 * 回归背景：
 * 1) 模板 startsWith/endsWith/includes 用 litValue(args[1])!==undefined
 *    判「有位置参」，抽象位置参被当成缺省 → 假精确 true。
 * 2) Set/Map 的 litKeyOf 对 lit(undefined) 返回 undefined，被
 *    `lk !== undefined` 当成非字面量 → 重复 add 不去重、size 假精确。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatShape,
  anyAbs,
} from "../index.ts";

function call(src: string, fnName = "f", args: Parameters<typeof callTranspiledExportFull>[2] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

describe("litValue sentinel: abstract pos arg / undefined Set key", () => {
  it("template startsWith with abstract position is undecided (not exact true)", () => {
    // "hello"+x 的前缀是 "hello"，但 startsWith("hello", n) 在 n>0 时为 false
    const r = call(
      `export function f(x, n) { const s = "hello" + x; return s.startsWith("hello", n); }`,
      "f",
      [anyAbs, anyAbs],
    );
    const a = r.result as { shape?: { k?: string }; term?: { op?: string; value?: unknown }; conf?: string };
    // 不得 exact true（n 抽象时可能 false）
    const exactTrue = a?.term?.op === "lit" && a.term.value === true && a.conf === "exact";
    expect(exactTrue).toBe(false);
    // Bug 7 边界归一：缺省 x/n ≡ undefined → "helloundefined".startsWith
    // ("hello", 0) 原生确定 true（显式 undefined 实参同面）
    expect(litValue(call(
      `export function f(x, n) { const s = "hello" + x; return s.startsWith("hello", n); }`,
    ).result)).toEqual({ ok: true, value: true });
  });

  it("template endsWith with abstract length is undecided", () => {
    const r = call(
      `export function f(x, n) { const s = "a" + x + "bc"; return s.endsWith("bc", n); }`,
      "f",
      [anyAbs, anyAbs],
    );
    const a = r.result as { term?: { op?: string; value?: unknown }; conf?: string };
    const exactTrue = a?.term?.op === "lit" && a.term.value === true && a.conf === "exact";
    expect(exactTrue).toBe(false);
    // Bug 7 边界归一：缺省 n ≡ undefined → endPosition 缺省取串长，原生确定 true
    expect(litValue(call(
      `export function f(x, n) { const s = "a" + x + "bc"; return s.endsWith("bc", n); }`,
    ).result)).toEqual({ ok: true, value: true });
  });

  it("template includes with abstract position is undecided", () => {
    const r = call(
      `export function f(x, n) { const s = "a" + x + "b"; return s.includes("a", n); }`,
      "f",
      [anyAbs, anyAbs],
    );
    const a = r.result as { term?: { op?: string; value?: unknown }; conf?: string };
    const exactTrue = a?.term?.op === "lit" && a.term.value === true && a.conf === "exact";
    expect(exactTrue).toBe(false);
    // Bug 7 边界归一：缺省 n ≡ undefined → 位置 0，原生确定 true
    expect(litValue(call(
      `export function f(x, n) { const s = "a" + x + "b"; return s.includes("a", n); }`,
    ).result)).toEqual({ ok: true, value: true });
  });

  it("omitted position on a pure template still decides true", () => {
    // 纯字面量接收者走 string 分支；模板缺省位置不得被抽象参判定污染
    const r = call(`export function f() { return "hello".startsWith("hello"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    const r2 = call(`export function f(x) { return ("h" + x).startsWith("h"); }`);
    // 至少不得因缺省位置误折 exact false
    const a = r2.result as { term?: { op?: string; value?: unknown }; conf?: string };
    const exactFalse = a?.term?.op === "lit" && a.term.value === false && a.conf === "exact";
    expect(exactFalse).toBe(false);
  });

  it("Set of undefined: duplicate add does not grow size", () => {
    const r = call(
      `export function f() { const s = new Set(); s.add(undefined); s.add(undefined); return s.size; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("new Set([undefined, undefined]).size is 1", () => {
    const r = call(
      `export function f() { return new Set([undefined, undefined]).size; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("Set.has(undefined) after add(undefined) is true", () => {
    const r = call(
      `export function f() { const s = new Set(); s.add(undefined); return s.has(undefined); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Map.set(undefined, v) then get(undefined) returns v", () => {
    const r = call(
      `export function f() { const m = new Map(); m.set(undefined, 42); return m.get(undefined); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
  });

  it("new Set([1, 2]).size still 2 (regression)", () => {
    const r = call(`export function f() { return new Set([1, 2]).size; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});
