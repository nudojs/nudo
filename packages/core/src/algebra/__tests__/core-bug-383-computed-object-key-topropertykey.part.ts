/**
 * Bug 383 —— 计算成员访问的**对象键**不做 ToPropertyKey：写被静默丢弃、
 * 键强制转换副作用全丢。
 *
 * 修前（HEAD）：`propertyKeyOf` 只认**字面量** term ⇒ 对象键落「抽象键」臂 ⇒
 *   - 写被**静默丢弃**（`o[{}] = 1` 之后 `Object.keys(o).length` = 0；native 1）
 *   - 键的强制转换副作用全丢（`k.toString()` 从不执行 ⇒ 计数器恒 0）
 *   - 键集面还折 **exact 空元组**（自信的确切错值）
 *
 * 修后：对象键走 ToPropertyKey（ToPrimitive(string) → ToString），钩子**真调用**
 * （与 Bug 381 的钩子调用面同口径）；键**不可判**时写不得静默丢弃 ⇒ 打
 * 「自有键集不完备」标记（键家族据此折 partial，**不得**折 exact 空元组）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 383 · 对象键走 ToPropertyKey（写落地）", () => {
  it("`o[{}] = 1` 的键为 \"[object Object]\" ⇒ 写落地（native：1）", () => {
    expect(val(`export function f() { const o = {}; o[{}] = 1; return Object.keys(o).length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("`o[k] = 1`（k 有 toString）⇒ 键为 toString 的结果（native：1）", () => {
    expect(
      val(
        `export function f() { const o = {}; const k = { toString(){ return "kk"; } }; o[k] = 1; return Object.keys(o).length; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("类实例接收者同样落地（native：\"number\"）", () => {
    expect(
      val(`export function f() { class A {} const a = new A(); a[{}] = 1; return typeof a["[object Object]"]; }`),
    ).toEqual({ ok: true, value: "number" });
  });

  it("读面：对象键读到对应的槽值（native：1）", () => {
    expect(
      val(
        `export function f() { const o = {kk: 1}; const k = { toString(){ return "kk"; } }; return o[k]; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 383 · 键的强制转换副作用不再全丢", () => {
  it("写面：键的 toString 被调一次（native：1）", () => {
    expect(
      val(
        `export function f() { let n = 0; const o = {}; const k = { toString(){ n++; return "kk"; } }; o[k] = 1; return n; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("读面：键的 toString 被调一次（native：1）", () => {
    expect(
      val(
        `export function f() { let n = 0; const o = {kk: 1}; const k = { toString(){ n++; return "kk"; } }; const v = o[k]; return n; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 383 · 键不可判 ⇒ 写不得静默丢弃（键集面不折 exact 空元组）", () => {
  it("函数键的 ToString 不可判 ⇒ 键集折 partial（native：1，引擎不得折 exact 0）", () => {
    const r = val(`export function f() { const o = {}; o[function f(){}] = 1; return Object.keys(o).length; }`);
    expect(r.ok).toBe(false);
  });
});

describe("Bug 383 · 对照组（字面量键）不得回归", () => {
  it("字符串键 / 数字键照旧落地（native：1）", () => {
    expect(val(`export function f() { const o = {}; o["x"] = 1; return Object.keys(o).length; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { const o = {}; o[1] = 1; return Object.keys(o).length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });
});
