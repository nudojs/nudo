/**
 * Bug 293：Promise 组合子（all / race / any）的 settle 域。
 *
 * 原生（node v26）：
 * - `await Promise.all([Promise.reject(e)])` / `race` → 抛 e（catch 臂可达）
 * - `await Promise.any([Promise.reject(e)])` → 抛 AggregateError
 * - `await Promise.race([Promise.resolve(1)])` → 1（**元素 promise 的值**，
 *   不是 promise 本身——原生 race/any 先按 PromiseResolve unwrap）
 * - `Promise.race([Promise.resolve(1), 2])` → 2（非 promise 元素先 settle）
 *
 * 修前：all/race/any 丢弃元素的 rejected 通道（组合子恒「不抛」→ catch 臂成
 * 死代码、try 臂成确定错值）；race/any 还把元素 promise 本身当结算值。
 */
import { describe, it, expect } from "vitest";
import { formatAbs, litValue, type Abs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs; rejected?: Abs; unsettled?: boolean };
};

/** 结果取值：promise 取兑现域（inner），非 promise 取自身 */
function v(src: string): { ok: boolean; value?: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  return litValue((sh?.k === "eff" && sh.eff === "promise" ? sh.inner : r.result) as Abs);
}

/** 结果的展示串（签名面） */
function fmt(src: string): string {
  return formatAbs(call(src, "f").result as Abs)?.replace(/\s+#[a-z0-9]+$/, "") ?? "";
}

describe("Bug 293: Promise 组合子 settle 域", () => {
  it("all：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）", () => {
    expect(
      v(`export async function f() {
        try { await Promise.all([Promise.reject(new Error("k"))]); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:k" });
  });

  it("race：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）", () => {
    expect(
      v(`export async function f() {
        try { await Promise.race([Promise.reject(new Error("k"))]); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:k" });
  });

  it("any：全拒 → AggregateError（原生 errors 数组 + 固定 message）", () => {
    expect(
      v(`export async function f() {
        try { await Promise.any([Promise.reject(new Error("k"))]); return "no"; }
        catch (e) { return "c:" + e.name; }
      }`),
    ).toEqual({ ok: true, value: "c:AggregateError" });
  });

  it("race：结算值按 PromiseResolve unwrap（元素 promise → 其值，非 promise 本身）", () => {
    expect(
      v(`export async function f() {
        const x = await Promise.race([Promise.resolve(1)]);
        return typeof x;
      }`),
    ).toEqual({ ok: true, value: "number" });
  });

  it("race：混合元素 → 兑现域非 object（原生恒 number）", () => {
    expect(
      v(`export async function f() {
        const x = await Promise.race([Promise.resolve(1), 2]);
        return typeof x === "object";
      }`),
    ).toEqual({ ok: true, value: false });
  });

  it("负控制：无拒绝组合的投影不变（all 元素数组 / race·any 元素联合）", () => {
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1), 2]); }`)).toContain(
      "promise<[1, 2]>",
    );
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1)]); }`)).toContain(
      "promise<[1]>",
    );
    expect(fmt(`export function f() { return Promise.race([1, "a"]); }`)).toContain(
      'promise<1 | "a">',
    );
    expect(fmt(`export function f() { return Promise.any([1]); }`)).toContain("promise<1>");
  });

  it("负控制：单 promise 的 await 拒绝面不变（Bug 36 通道）", () => {
    expect(
      v(`export async function f() {
        try { await Promise.reject(new Error("k")); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:k" });
  });
});
