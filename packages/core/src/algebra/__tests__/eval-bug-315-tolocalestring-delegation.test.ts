/**
 * Bug 315 回归：Object.prototype.toLocaleString **委派接收者的 toString()**。
 *
 * 原生（node v26 实测）：
 * - `Object.prototype.toLocaleString.call({toString(){return "CUSTOM"}})`
 *   === "CUSTOM"（委派接收者的 toString；**不**调接收者自有的
 *   toLocaleString——自有 toLocaleString 原生永不被调用）；
 * - 接收者的 toString 抛错 ⇒ 原样冒泡；
 * - `Object.create(null)` 接收者 ⇒ TypeError（没有 toString 可委派）；
 * - `[1,2]` ⇒ "1,2"（Array.prototype.toString）、`5` ⇒ "5"
 *   （Number.prototype.toString）。
 *
 * 修复前：toLocaleString 与 toString 合流折 "[object X]" ⇒ 用户自定义
 * toString 的**值与抛错全被吞**；null 原型接收者 no-throw。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 315 — Object.prototype.toLocaleString 委派 this.toString()", () => {
  it("自定义 toString 的值透传（改前折 \"[object Object]\"）", () => {
    expect(
      v(wrap(`const o = { toString() { return "CUSTOM"; } }; return Object.prototype.toLocaleString.call(o);`)),
    ).toEqual({ ok: true, value: "CUSTOM" });
  });

  it("自定义 toString 的抛错透传（改前被吞成标签）", () => {
    expect(
      v(
        wrap(
          `const o = { toString() { throw new Error("boom"); } }; try { return Object.prototype.toLocaleString.call(o); } catch (e) { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("成员调用面同样委派（o.toLocaleString() === o.toString()）", () => {
    expect(
      v(wrap(`const o = { toString() { return "X"; } }; return o.toLocaleString();`)),
    ).toEqual({ ok: true, value: "X" });
  });

  it("null 原型接收者 ⇒ TypeError（改前 no-throw / 折 unknown）", () => {
    expect(
      v(
        wrap(
          `try { return Object.prototype.toLocaleString.call(Object.create(null)); } catch (e) { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  });

  it("数组接收者 ⇒ Array.prototype.toString 的值（原生 \"1,2\"）", () => {
    expect(
      v(wrap(`return Object.prototype.toLocaleString.call([1, 2]);`)),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("数字接收者 ⇒ Number.prototype.toString 的值（原生 \"5\"）", () => {
    expect(v(wrap(`return Object.prototype.toLocaleString.call(5);`))).toEqual({
      ok: true,
      value: "5",
    });
  });

  it("负控制：普通对象仍折 \"[object Object]\"（toString 标签面不变）", () => {
    expect(v(wrap(`return Object.prototype.toLocaleString.call({ a: 1 });`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });

  it("负控制：Object.prototype.toString 标签面不受影响", () => {
    expect(v(wrap(`return Object.prototype.toString.call({ a: 1 });`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });
});
