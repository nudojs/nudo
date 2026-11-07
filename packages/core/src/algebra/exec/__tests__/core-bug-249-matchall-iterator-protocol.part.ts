/**
 * Bug 249 —— `String.prototype.matchAll` 的结果必须**是迭代器**。
 *
 * 原生 `matchAll` 返回 **RegExp String Iterator**：
 * - `typeof it.next` → "function"（此前折 exact **"undefined"**——wrong-exact）
 * - `typeof it[Symbol.iterator]` → "function"（协议面缺失）
 * - `it.next()` → `{value: <匹配项 RegExpExecArray>, done: false}`；
 *   逐次推进同一游标（第二次 → 第二项）；耗尽 → `{value: undefined, done: true}`
 * - `Object.prototype.toString.call(it)` → "[object RegExp String Iterator]"
 *
 * 根因：`exec/class-regex.ts` 的 `stringRegexMethod` matchAll 尾段只挂了
 * brand 名 + **元素侧表**（`exec/match-iter.ts`）⇒ 协议面全缺。展开 / for-of
 * 之所以仍对，是因为它们**读侧表**，与迭代器协议本身无关。
 *
 * 修法：`class-regex.ts` 的 `matchIteratorAbs` 给 brand 建协议面（内层 obj
 * 的 internal 槽：next / @@iterator / @@toStringTag；游标走闭包，元素面仍
 * 挂 match-iter.ts 侧表——两侧同源）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call } from "../../__tests__/eval-helpers.ts";

describe("Bug 249: matchAll result exposes the iterator protocol face", () => {
  it("typeof it.next → \"function\"（原生协议面；此前 \"undefined\"）", () => {
    const r = call(`export function f() {
      const it = "a1b2".matchAll(/\\d/g);
      return typeof it.next;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("typeof it[Symbol.iterator] → \"function\"", () => {
    const r = call(`export function f() {
      const it = "a1b2".matchAll(/\\d/g);
      return typeof it[Symbol.iterator];
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("it.next().value[0] → 首个匹配项", () => {
    const r = call(`export function f() {
      return "a1b2".matchAll(/\\d/g).next().value[0];
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
  });

  it("it.next() 逐次推进同一游标（第二次 → 第二项）", () => {
    const r = call(`export function f() {
      const it = "a1b2".matchAll(/\\d/g);
      it.next();
      return it.next().value[0];
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "2" });
  });

  it("耗尽后 done → true、value → undefined", () => {
    const r = call(`export function f() {
      const it = "a".matchAll(/a/g);
      it.next();
      return it.next().done;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    const r2 = call(`export function f() {
      const it = "a".matchAll(/a/g);
      it.next();
      return String(it.next().value);
    }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: "undefined" });
  });

  it("Object.prototype.toString.call(it) → \"[object RegExp String Iterator]\"", () => {
    const r = call(`export function f() {
      return Object.prototype.toString.call("a1b2".matchAll(/\\d/g));
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "[object RegExp String Iterator]" });
  });

  it("协议槽是原型的（非自有可枚举）：Object.keys 空、hasOwnProperty 假、in 真", () => {
    const r = call(`export function f() {
      const it = "ab".matchAll(/a/g);
      return Object.keys(it).length;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
    const r2 = call(`export function f() {
      const it = "ab".matchAll(/a/g);
      return it.hasOwnProperty("next");
    }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: false });
    const r3 = call(`export function f() {
      const it = "ab".matchAll(/a/g);
      return "next" in it;
    }`);
    expect(litValue(r3.result)).toEqual({ ok: true, value: true });
  });

  it("展开 / for-of 仍按侧表精确迭代（对照组）", () => {
    const r = call(`export function f() {
      return [..."a1b2".matchAll(/\\d/g)].length;
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    const r2 = call(`export function f() {
      let n = 0;
      for (const m of "a1b2".matchAll(/\\d/g)) n++;
      return n;
    }`);
    expect(litValue(r2.result)).toEqual({ ok: true, value: 2 });
  });
});
