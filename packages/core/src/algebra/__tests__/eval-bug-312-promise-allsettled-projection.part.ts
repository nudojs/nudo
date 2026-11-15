/**
 * Bug 312：`Promise.allSettled` 的元素投影。
 *
 * 原生（node v26）：`Promise.allSettled([p])` 的元素是**判别联合**——
 * `{status:"fulfilled", value:<值>}` 或 `{status:"rejected", reason:<reason>}`，
 * status 恒定（不取决于别的臂）。读 `r[0].reason.message` 不抛。
 *
 * 修前：元素 promise **原样**塞进 value 槽（没解包）、reason 槽恒 unknown、
 * status 是两态并集（不区分）→ 读 reason 命中 fulfilled 臂的缺槽 → undefined
 * → `.message` 定抛 TypeError（假抛，L2 假红）+ 错类型声明。
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

describe("Bug 312: allSettled 元素投影", () => {
  it("rejected 元素 → reason 槽装真 reason（读 .reason.message 不抛）", () => {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.reject(new Error("k"))]).then((r) => r[0].reason.message);
      }`),
    ).toEqual({ ok: true, value: "k" });
  });

  it("fulfilled 元素 → value 槽装解包后的值（非 promise 本身）", () => {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.resolve(1)]).then((r) => r[0].value);
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("fulfilled 元素 → status 恒 \"fulfilled\"（判别联合，不与 rejected 并集）", () => {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.resolve(1)]).then((r) => r[0].status);
      }`),
    ).toEqual({ ok: true, value: "fulfilled" });
  });

  it("混合元素 → 逐元素投影（长度与原生一致）", () => {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("k"))]).then((r) => r.length);
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：非 promise 元素的既有口径不变（status 两态并集 + value/reason 双槽）", () => {
    const s = fmt(`export function f() { return Promise.allSettled([1]); }`);
    expect(s).toContain('"fulfilled" | "rejected"');
    expect(s).toContain("value");
    expect(s).toContain("reason");
  });
});
