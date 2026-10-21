/**
 * Bug 310：`new Promise` 的执行器抛错被吞掉。
 *
 * 原生（node v26）：`new Promise(() => { throw new Error("x"); })` 产出
 * **被拒绝**的 promise（reason = Error("x")）——`await` 抛 → catch 臂可达。
 *
 * 修前：执行器抛出只翻「executed」标志 → 短路 `promiseUnknown()`（inner=unknown、
 * **无 rejected 通道**、unsettled=true）→ `$await` 永不抛 → catch 臂成死代码，
 * try 臂的字面量成了确定返回值（自信错值）。
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

/** eff(promise) 的形状面 */
function shape(src: string): EffShape["shape"] {
  const sh = call(src, "f").result.shape as EffShape["shape"];
  expect(sh?.k, "expected eff shape").toBe("eff");
  expect(sh?.eff, "expected promise eff").toBe("promise");
  return sh;
}

describe("Bug 310: new Promise 执行器抛错", () => {
  it("执行器抛错 → promise 以抛出值拒绝（catch 臂可达）", () => {
    expect(
      v(`export async function f() {
        try { await new Promise(() => { throw new Error("x"); }); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:x" });
  });

  it("执行器抛错 → fulfilled 域 never + rejected 通道带 reason", () => {
    const sh = shape(`export function f() { return new Promise(() => { throw new Error("boom"); }); }`);
    expect(sh?.inner?.shape?.k).toBe("never");
    expect(sh?.rejected?.shape?.k).toBe("brand");
    expect(formatAbs(sh!.rejected as Abs)).toContain("Error");
  });

  it("先 settle 获胜：执行器先 resolve 后抛错 → 仍兑现（原生 first-wins）", () => {
    expect(
      v(`export function f() { return new Promise((r) => { r(1); throw new Error("x"); }); }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：空执行器（永不 settle）仍是 promise<unknown>（不假装 settle）", () => {
    const sh = shape(`export function f() { return new Promise(() => {}); }`);
    expect(sh?.inner?.shape?.k).toBe("unknown");
    expect(sh?.rejected).toBeUndefined();
    expect(sh?.unsettled).toBe(true);
  });

  it("负控制：只 reject 的执行器仍是确定拒绝（Bug 36 通道）", () => {
    const sh = shape(`export function f() { return new Promise((r, j) => { j(new Error("x")); }); }`);
    expect(sh?.inner?.shape?.k).toBe("never");
    expect(sh?.rejected).toBeDefined();
  });
});
