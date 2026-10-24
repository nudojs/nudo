/**
 * Bug 1076 回归：`Uint8ClampedArray` 元素取值**先截断再钳位** ⇒ 自信错值。
 *
 * 修前（探针实测）：
 * - `new Uint8ClampedArray([1.5])[0]` ⇒ **1**（原生 2）；
 * - `new Uint8ClampedArray([3.5])[0]` ⇒ **3**（原生 4）。
 *
 * 根因：`builtins/error/binary.ts` 的 `taStoreNumber` 先做
 * `Math.trunc`（整数 TA 的 ToIntegerOrInfinity 口径），再调
 * `taClampUint8`（ToUint8Clamp——**就近偶数**取整，**不**向零截断）。
 * 钳位函数本身是对的，被上游的截断污染 ⇒ 折出自信的错值。
 *
 * 修后：`Uint8ClampedArray` 分支改吃**未截断**的值（`taClampUint8` 自带
 * NaN / ±Infinity / 0 / 255 边界处理）；其余整数 TA（Int8Array 等）的
 * 向零截断口径**不变**（负控制）。
 *
 * oracle：node v26.10.0 实测（ES2024 7.1.7 ToUint8Clamp）。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 1076 — Uint8ClampedArray 取值是「就近偶数」（不向零截断）", () => {
  it("new Uint8ClampedArray([1.5])[0] ⇒ 2（native：2；修前：1）", () => {
    expect(val(wrap(`return new Uint8ClampedArray([1.5])[0];`))).toEqual({ ok: true, value: 2 });
  });

  it("new Uint8ClampedArray([3.5])[0] ⇒ 4（native：4；修前：3）", () => {
    expect(val(wrap(`return new Uint8ClampedArray([3.5])[0];`))).toEqual({ ok: true, value: 4 });
  });

  it("就近偶数（tie → 偶数）：2.5 ⇒ 2、4.5 ⇒ 4、0.5 ⇒ 0（native 同款）", () => {
    expect(val(wrap(`return new Uint8ClampedArray([2.5])[0];`))).toEqual({ ok: true, value: 2 });
    expect(val(wrap(`return new Uint8ClampedArray([4.5])[0];`))).toEqual({ ok: true, value: 4 });
    expect(val(wrap(`return new Uint8ClampedArray([0.5])[0];`))).toEqual({ ok: true, value: 0 });
  });

  it("非 tie 值照旧四舍五入：1.4 ⇒ 1、1.6 ⇒ 2（native 同款）", () => {
    expect(val(wrap(`return new Uint8ClampedArray([1.4])[0];`))).toEqual({ ok: true, value: 1 });
    expect(val(wrap(`return new Uint8ClampedArray([1.6])[0];`))).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 1076 — 负控制（边界与整数 TA 口径不变）", () => {
  it("边界：300 ⇒ 255、-1 ⇒ 0（native 同款）", () => {
    expect(val(wrap(`return new Uint8ClampedArray([300])[0];`))).toEqual({ ok: true, value: 255 });
    expect(val(wrap(`return new Uint8ClampedArray([-1])[0];`))).toEqual({ ok: true, value: 0 });
  });

  it("整数 TA 仍是向零截断：new Int8Array([1.5])[0] ⇒ 1（native：1）", () => {
    expect(val(wrap(`return new Int8Array([1.5])[0];`))).toEqual({ ok: true, value: 1 });
  });

  it("浮点 TA 不钳位：new Float64Array([1.5])[0] ⇒ 1.5（native：1.5）", () => {
    expect(val(wrap(`return new Float64Array([1.5])[0];`))).toEqual({ ok: true, value: 1.5 });
  });
});
