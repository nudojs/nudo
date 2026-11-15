/**
 * BUG-243：数组样（array-like）接收者上的 `sort` / `reverse` / `copyWithin` /
 * `fill` 此前**既不建模写面、又记 may-throw** ⇒
 * ① 宿主能跑通的代码被判 error 级 `nudo:entry-may-throw`（L1 **假红**）；
 * ② 接收者内容被当结果交回 ⇒ 印出「未排序 / 未反转」的旧值（`conf: exact`
 *   的**自信错值**）。
 *
 * 规范事实（ES2023 22.1.3.x）：这四个方法的算法只依赖 `Get` / `Set` /
 * `DeletePropertyOrThrow` + 可写 `length` ⇒ 数组样接收者与真数组**同义**，
 * 原生不抛。同族 `push` 早已建模（对照组）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, effects } from "./eval-helpers.ts";

const lit = (src: string): unknown => {
  const r = litValue(call(src).result);
  return r.ok ? r.value : `NOT-LIT(${JSON.stringify(r)})`;
};

describe("BUG-243 sort/reverse on array-like receivers", () => {
  it("sort writes the sorted order back (host: 'a')", () => {
    expect(
      lit(`export function f() {
        const o = { length: 2, 0: "b", 1: "a" };
        Array.prototype.sort.call(o);
        return o[0];
      }`),
    ).toBe("a");
  });

  it("reverse writes the reversed order back (host: 'b')", () => {
    expect(
      lit(`export function f() {
        const o = { length: 2, 0: "a", 1: "b" };
        Array.prototype.reverse.call(o);
        return o[0];
      }`),
    ).toBe("b");
  });

  it("fill writes the window (host: 'x')", () => {
    expect(
      lit(`export function f() {
        const o = { length: 3, 0: "a", 1: "b", 2: "c" };
        Array.prototype.fill.call(o, "x", 1, 3);
        return o[1];
      }`),
    ).toBe("x");
  });

  it("copyWithin copies within the receiver (host: 'b' at 0)", () => {
    expect(
      lit(`export function f() {
        const o = { length: 3, 0: "a", 1: "b", 2: "c" };
        Array.prototype.copyWithin.call(o, 0, 1);
        return o[0];
      }`),
    ).toBe("b");
  });

  it("no may-throw is recorded for array-like receivers (native never throws)", () => {
    // 原生这四个方法对数组样接收者不抛 ⇒ 记 may-throw 即 L1 假红。
    expect(
      effects(`export function f() {
        const o = { length: 2, 0: "b", 1: "a" };
        Array.prototype.sort.call(o);
        Array.prototype.reverse.call(o);
        Array.prototype.fill.call(o, "z");
        Array.prototype.copyWithin.call(o, 0, 1);
        return o[0];
      }`),
    ).toEqual([]);
  });

  it("control: push on the same receiver kind already agreed with the host", () => {
    expect(
      lit(`export function f() {
        const o = { length: 1, 0: "a" };
        Array.prototype.push.call(o, "b");
        return o.length;
      }`),
    ).toBe(2);
  });

  it("sort with a comparator sorts the array-like receiver", () => {
    expect(
      lit(`export function f() {
        const o = { length: 3, 0: 3, 1: 1, 2: 2 };
        Array.prototype.sort.call(o, (a, b) => a - b);
        return o[0];
      }`),
    ).toBe(1);
  });
});
