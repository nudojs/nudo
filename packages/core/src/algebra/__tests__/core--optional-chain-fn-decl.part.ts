/**
 * Bug 16 回归：可选链基值是**函数声明绑定**（转译产物里的原生 JS 函数，
 * 不是 Abs）时，短路守卫 `$nullishTest(f)` 不得读 `.shape` 崩溃。
 * 原生函数恒非 nullish ⇒ g() => 1、h() => "f"，零诊断。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const SRC = `export function f(x) { return x; }
export function g() { return f?.(1); }
export function h() { return f?.name; }
export function ok() { return 1; }`;

describe("Bug 16 — 函数声明基值的可选链", () => {
  it("f?.(1) ⇒ 1（改前 nudo:internal 崩溃）", () => {
    const r = call(SRC, "g");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.result.shape.k).not.toBe("never");
  });

  it("f?.name ⇒ 'f'（属性读面同样不崩）", () => {
    const r = call(SRC, "h");
    expect(litValue(r.result)).toEqual({ ok: true, value: "f" });
  });

  it("同模块无关导出不受影响", () => {
    expect(litValue(call(SRC, "ok").result)).toEqual({ ok: true, value: 1 });
  });

  it("负控制：Abs 基值的可选链短路语义不变", () => {
    expect(litValue(call(`export function f() { const o = null; return o?.x; }`).result)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
