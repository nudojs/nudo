/**
 * Bug 87 回归：语句位 `Object.defineProperty/defineProperties(o.p, …)` 的
 * member 目标写回。emitArrMutatorRebinds 的 defineProperty 臂原本只认
 * Identifier 第一实参——member 目标（o.p / a[0] / C.prototype / o.p.q）的
 * 描述符安装在 `$invoke` 返回的新容器上但没有写回根绑定，后续 `o.p.m`
 * 读的是旧容器 → 折 exact undefined。修复：member 目标经 memberPathOf
 * 走不可变更新链写回根（Identifier 分支保持原样）。
 *
 * node 实测 ground truth（见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

function expectVal(body: string, expected: unknown) {
  const rec = call(`export function f() {\n${body}\n}`);
  expect(rec.throws?.shape?.k ?? "never", `throws face for: ${body}`).toBe("never");
  expect(litValue(rec.result), `value for: ${body}`).toEqual({ ok: true, value: expected });
}

describe("Object.defineProperty/defineProperties member-target writeback (Bug 87)", () => {
  it("member 目标 o.p 写回：data 描述符可读", () => {
    // node: const o = { p: {} }; Object.defineProperty(o.p, "m", { value: 4 }); o.p.m → 4
    expectVal(`const o = { p: {} }; Object.defineProperty(o.p, "m", { value: 4 }); return o.p.m;`, 4);
  });

  it("member 目标 o.p 写回：getter 描述符可读", () => {
    // node: get() { return 7; } → o.p.m → 7
    expectVal(`const o = { p: {} }; Object.defineProperty(o.p, "m", { get() { return 7; } }); return o.p.m;`, 7);
  });

  it("computed member 目标 a[0] 写回", () => {
    // node: 4
    expectVal(`const a = [{}]; Object.defineProperty(a[0], "m", { value: 4 }); return a[0].m;`, 4);
  });

  it("深层 member 目标 o.p.q 写回", () => {
    // node: 4
    expectVal(`const o = { p: { q: {} } }; Object.defineProperty(o.p.q, "m", { value: 4 }); return o.p.q.m;`, 4);
  });

  it("defineProperties（复数）member 目标同形态", () => {
    // node: 4
    expectVal(
      `const o = { p: {} }; Object.defineProperties(o.p, { m: { value: 4, enumerable: true } }); return o.p.m;`,
      4,
    );
  });

  it("class prototype 目标写回（绑定读）", () => {
    // node: class C {} Object.defineProperty(C.prototype, "m", { value: 4 }); C.prototype.m → 4
    expectVal(`class C {} Object.defineProperty(C.prototype, "m", { value: 4 }); return C.prototype.m;`, 4);
  });

  // controls：既有路径不回归
  it("control：Identifier 目标（Bug 19 形态）仍写回", () => {
    expectVal(`const p = {}; Object.defineProperty(p, "m", { value: 4 }); return p.m;`, 4);
  });

  it("control：freeze 就地标记不写回也不误删", () => {
    expectVal(`const o = { p: { m: 1 } }; Object.freeze(o.p); return o.p.m;`, 1);
  });
});
