/**
 * for 步进 lowering 回归（报告 Bug 132 / Bug 144）。
 *
 * Bug 132：主 for 路径（`for (let i = …)`）把 `i++` 降成 `i = $add(i, $lit(1))`
 * —— `$add` 是二元 `+`：bigint + number 走 mixed-bigint 抛 TypeError 臂；
 * string 左操作数走字符串拼接臂（"5"++ 原生 6，拼接得 "51"）。同仓库另外
 * 三处步进 lowering 早已用 $updateAdd/$updateSub（ToNumeric ± 1）。
 *
 * Bug 144：步进闭包的**返回值**被当成 $for 的状态线程——序列表达式
 * （`i++, n++`）的值是末项值（后缀自增回旧值），循环变量因此停滞 / 超跑。
 * 修法：步进只取副作用，状态线程恒为循环变量自身（与 fallback 路径同口径）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, isNever } from "./eval-helpers.ts";

describe("for 步进 lowering（$updateAdd 口径 + 状态线程恒为循环变量）", () => {
  it("bigint 计数器：for (let i = 0n; i < 3n; i++) → 3（修前定抛 TypeError）", () => {
    const r = call(
      `export function f() { let n = 0; for (let i = 0n; i < 3n; i++) { n++; } return n; }`,
      "f",
    );
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("string 计数器：for (let i = \"5\"; i < \"9\"; i++) → 4（修前折 1024）", () => {
    const r = call(
      `export function f() { let n = 0; for (let i = "5"; i < "9"; i++) { n++; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("序列步进：for (let i = 0; i < 3; i++, n++) { n += 10 } → 33（修前折 11）", () => {
    const r = call(
      `export function f() {
        let n = 0;
        for (let i = 0; i < 3; i++, n++) { n += 10; }
        return n;
      }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 33 });
  });

  it("序列步进只计数：for (let i = 0; i < 3; i++, c++) {} → 3（修前折 4 = 超跑）", () => {
    const r = call(
      `export function f() { let c = 0; for (let i = 0; i < 3; i++, c++) { } return c; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("普通步进不受影响：for (let i = 0; i < 3; i++) → 3", () => {
    const r = call(`export function f() { let n = 0; for (let i = 0; i < 3; i++) { n++; } return n; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("小数步进：for (let i = 0; i < 1; i += 0.25) → 4", () => {
    const r = call(`export function f() { let n = 0; for (let i = 0; i < 1; i += 0.25) { n++; } return n; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 4 });
  });

  it("bigint 递减：for (let i = 3n; i > 0n; i--) → 3", () => {
    const r = call(`export function f() { let n = 0; for (let i = 3n; i > 0n; i--) { n++; } return n; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("嵌套循环步进：i×j 两层 → 6", () => {
    const r = call(
      `export function f() { let n = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 2; j++) { n++; } } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });
});
