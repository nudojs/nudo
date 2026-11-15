/**
 * Bug 291 回归（**主 agent 接线面**）：宿主函数 → Abs 的**稳定门面**。
 *
 * 接线（主 agent 已落地，本文件只钉行为，不改源码）：
 * `exec/runtime/state.ts` 的 `asAbsVal` 对宿主函数走 `WeakMap` 缓存
 * （`hostFnAbsCache`）⇒ 同一宿主函数**恒同一 Abs** ⇒ 以 Abs 为键的旁表
 * （propFlags / extState / userFnSlots）跨调用不再丢失。
 *
 * 原生依据（node v26.10.0 实测）：同一函数**恒同一身份**（`g === g` 真、
 * `Object.isFrozen(g)` 恒定）；freeze / seal 的标志挂在**函数对象本身**上，
 * 与「谁在读它」无关：
 * - `function g(){} Object.freeze(g); Object.isFrozen(g)` → true；
 * - `function g(){} Object.freeze(g); Object.isSealed(g)` → true（freeze ⇒ seal）；
 * - `function g(){} Object.seal(g); Object.isSealed(g)`   → true；
 * - `function g(){} const a = g; Object.freeze(g); Object.isFrozen(a)` → true
 *   （别名读同一对象 ⇒ 标志可见）；
 * - 跨函数边界同样可见：helper 里 freeze ⇒ 外面读 isFrozen → true；
 *   helper 里读 isFrozen → true；
 * - `g === g` → true；两次读 `const a = g; const b = g; a === b` → true。
 *
 * 修前：每次 `asAbsVal(hostFn)` 都新建 Abs ⇒ 旁表跨读丢失 ⇒
 * `Object.isFrozen(g)` 折 false（标志留在第一次新建的 Abs 上，再读是全新
 * Abs ⇒ 查不到）；`g === g` 落「不可判」（`strictEqAbs` 对 fn 只在**同一
 * Abs 引用**上折 true）。
 *
 * 对照（同族既有行为）：函数表达式（`$fnVal` 造的稳定 fn Abs）freeze 后
 * `Object.isFrozen` 恒 true。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 端到端取一段函数体的字面量结果 */
function v(body: string): { ok: boolean; value?: unknown } {
  return litValue(call(`export function f() { ${body} }`, "f").result);
}

describe("Bug 291 — 宿主函数 → Abs 的稳定门面", () => {
  it("函数声明 freeze 后 isFrozen 可见（修前折 false）", () => {
    expect(v(`function g(){} Object.freeze(g); return Object.isFrozen(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("函数声明 freeze 后 isSealed 亦为 true（原生：freeze ⇒ seal）", () => {
    expect(v(`function g(){} Object.freeze(g); return Object.isSealed(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("函数声明 seal 后 isSealed 可见（修前折 false）", () => {
    expect(v(`function g(){} Object.seal(g); return Object.isSealed(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("别名读：const a = g 后 freeze，isFrozen(a) 仍为 true（修前折 false）", () => {
    expect(
      v(`function g(){} const a = g; Object.freeze(g); return Object.isFrozen(a);`),
    ).toEqual({ ok: true, value: true });
  });

  it("跨调用可见：helper 里 freeze ⇒ 外面读 isFrozen 为 true", () => {
    expect(
      v(
        `function g(){} function freezeIt(){ Object.freeze(g); } freezeIt(); return Object.isFrozen(g);`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("跨调用可见：helper 里读 isFrozen 为 true（标志随同一 Abs 门面）", () => {
    expect(
      v(
        `function g(){} function read(){ return Object.isFrozen(g); } Object.freeze(g); return read();`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("跨调用可见：helper 里 seal ⇒ 外面读 isSealed 为 true", () => {
    expect(
      v(
        `function g(){} function sealIt(){ Object.seal(g); } sealIt(); return Object.isSealed(g);`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("同引用读：g === g 折 true（修前不可判）", () => {
    expect(v(`function g(){} return g === g;`)).toEqual({ ok: true, value: true });
  });

  it("同引用读：两次读同一宿主函数恒等（a === b 折 true）", () => {
    expect(v(`function g(){} const a = g; const b = g; return a === b;`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("同引用读：helper 返回的同一宿主函数与直接读恒等", () => {
    expect(
      v(`function g(){} function id(){ return g; } return id() === g;`),
    ).toEqual({ ok: true, value: true });
  });

  it("对照：函数表达式的既有行为（freeze 后 isFrozen 恒 true）", () => {
    expect(v(`const g = function(){}; Object.freeze(g); return Object.isFrozen(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：freeze / seal 之前 isFrozen / isSealed 均为 false", () => {
    expect(v(`function g(){} return Object.isFrozen(g);`)).toEqual({
      ok: true,
      value: false,
    });
    expect(v(`function g(){} return Object.isSealed(g);`)).toEqual({
      ok: true,
      value: false,
    });
  });
});
