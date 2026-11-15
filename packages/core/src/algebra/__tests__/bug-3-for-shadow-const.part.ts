/**
 * Bug 3 回归：`for (let s = …)` 的 test / update 与循环体一样必须用
 * **去影**后的 const 面（循环变量是状态线程形参，遮蔽外层同名 const）。
 * 此前 `s += 1` 命中 isConstAssignTarget ⇒ 误报确定 TypeError、签名塌 never。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 3 — for 头去影外层 const", () => {
  it("s += 1 步进不再误折 TypeError（原生 3）", () => {
    expect(
      val(`export function f() {
        const s = 100;
        let out = 0;
        for (let s = 0; s < 3; s += 1) out += s;
        return out;
      }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("n = n + 1 通用步进形态同样 total", () => {
    expect(
      val(`export function f() {
        const n = 100;
        let out = 0;
        for (let n = 0; n < 3; n = n + 1) out += n;
        return out;
      }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("test 里的复合赋值（(s+=1)<3）也不误报", () => {
    expect(
      val(`export function f() {
        const s = 100;
        let c = 0;
        for (let s = 0; (s += 1) < 3;) c++;
        return c;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：写真正的 const 仍抛 TypeError", () => {
    const r = val(`export function f() { const s = 1; s = 2; return s; }`);
    expect(r.ok).toBe(false);
  });
});
