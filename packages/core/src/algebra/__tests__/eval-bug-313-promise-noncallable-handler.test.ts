/**
 * Bug 313：`then` / `catch` 的非可调用 handler 被当成可调用。
 *
 * 原生（node v26，ES262 PerformPromiseThen）：`IsCallable(onFulfilled)` 为假
 * ⇒ onFulfilled ≡ undefined（identity）⇒ 原值透传。
 * `Promise.resolve(1).then({})` / `.then([1,2])` → 兑现 1（不抛）。
 *
 * 修前：`isIdentity` 只把 prim（与 nullish）判为「确定不可调用」——闭合的
 * obj / arr / tuple（形状已知、无可调用成员）落进「可能可调用」→ 微任务臂
 * 真去调 → TypeError → 结果 promise 折成 `promise<never>`（自信错值）。
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

describe("Bug 313: 非可调用 handler ≡ identity", () => {
  it("then({}) → 透传原值（非调用 → ≡ undefined）", () => {
    expect(
      v(`export async function f() { return Promise.resolve(1).then({}); }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("then([1, 2]) → 透传原值", () => {
    expect(
      v(`export async function f() { return Promise.resolve(1).then([1, 2]); }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("then(null) → 透传原值（既有 nullish 口径不变）", () => {
    expect(
      v(`export async function f() { return Promise.resolve(1).then(null); }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("catch({}) → 拒绝透传（非调用 handler ≡ undefined，不吞拒绝）", () => {
    const r = call(`export async function f() { return Promise.reject(new Error("k")).catch({}); }`);
    const sh = r.result.shape as EffShape["shape"];
    expect(sh?.inner?.shape?.k, "fulfilled arm must be impossible").toBe("never");
    expect(sh?.rejected).toBeDefined();
  });

  it("负控制：可调用 handler 仍真执行（映射 / 捕获）", () => {
    expect(
      v(`export async function f() { return Promise.resolve(1).then((x) => x + 1); }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(`export async function f() { return Promise.reject(new Error("k")).catch((e) => "c:" + e.message); }`),
    ).toEqual({ ok: true, value: "c:k" });
  });

  it("负控制：非函数 prim handler 仍是 identity（既有口径不变）", () => {
    expect(
      v(`export async function f() { return Promise.resolve(1).then(5); }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("签名面：非可调用 handler 的结果 promise 是 promise<1>（非 promise<never>）", () => {
    expect(fmt(`export function f() { return Promise.resolve(1).then({}); }`)).toContain(
      "promise<1>",
    );
  });
});
