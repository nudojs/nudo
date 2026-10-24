/**
 * 溢出数值字面量（`1e400`）不再折成 `null` 回归（报告 Bug 150）。
 *
 * Babel 把 `1e400` 解析为 `NumericLiteral{value: Infinity}`（raw 仍是
 * "1e400"）。转译侧用 `JSON.stringify(expr.value)` 把字面量渲染回源码文本
 * ——而 `JSON.stringify(Infinity)` 返回 4 个字符的 `"null"`（JSON 无
 * Infinity 表示），该文本被原样拼进生成代码 ⇒ 生成 `$lit(null)`（JS 的
 * **null** 字面量，不是字符串 "null"）。
 *
 * 修法：数值字面量不用 JSON.stringify 渲染——非有限数按 intrinsics.ts 同
 * 口径发 `1/0` / `-1/0`（无标识符依赖）；-0 单独保号。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("溢出数值字面量（1e400 → Infinity）", () => {
  it("1e400 → Infinity（修前折 null）", () => {
    const r = call(`export function f() { return 1e400; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: Infinity });
  });

  it("-1e400 → -Infinity（修前折 -0）", () => {
    const r = call(`export function f() { return -1e400; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: -Infinity });
  });

  it("Number(1e400) → Infinity（修前折 0）", () => {
    const r = call(`export function f() { return Number(1e400); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: Infinity });
  });

  it("String(1e400) → \"Infinity\"（修前折 \"null\"）", () => {
    const r = call(`export function f() { return String(1e400); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "Infinity" });
  });

  it("有限大数不受影响：1e21 → 1e21", () => {
    const r = call(`export function f() { return 1e21; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1e21 });
  });

  it("1e308 → 1e308", () => {
    const r = call(`export function f() { return 1e308; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1e308 });
  });

  it("普通数值不受影响：42 → 42、1.5 → 1.5", () => {
    const a = call(`export function f() { return 42; }`, "f");
    expect(litValue(a.result)).toEqual({ ok: true, value: 42 });
    const b = call(`export function f() { return 1.5; }`, "f");
    expect(litValue(b.result)).toEqual({ ok: true, value: 1.5 });
  });

  it("负零保号：1/(-0) → -Infinity", () => {
    const r = call(`export function f() { return 1/(-0); }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: -Infinity });
  });
});
