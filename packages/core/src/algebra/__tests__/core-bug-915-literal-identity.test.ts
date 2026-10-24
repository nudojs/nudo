/**
 * Bug 915：同一份 `lit(0)` 契约，**标量实参位**用 `===`（`-0` 放行），
 * **对象字段位 / 数组元素位**走域隶属通道用 `Object.is`（`-0` 报错）⇒
 * 同一条执法路径内部两套字面量同一性（且 domain-membership 的注释自称
 * 「与 leq 同口径」而实现不是）。
 *
 * 钉住：域隶属面的字面量同一性 = `===` + NaN 特例（与 term.ts 的
 * `termEquals` 同口径）：
 * - `-0` 与 `0` 同值（`===`）
 * - NaN 与自身同值（NaN 特例——`===` 对 NaN 为 false）
 * - 真正不同的字面量仍不满足（防「放宽过头」漏判）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { literalMeetsConstraint } from "../domain-membership.ts";
import { litC } from "../constraint.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 915 字面量同一性（域隶属面：字段位 / 数组元素位）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("lit(0) 接受 -0、lit(-0) 接受 0（=== 口径，与标量实参位一致）", () => {
    expect(literalMeetsConstraint(-0, litC(0))).toBe(true);
    expect(literalMeetsConstraint(0, litC(-0))).toBe(true);
  });

  it("lit(0) 不接受 1 / -1（不因统一口径而漏判）", () => {
    expect(literalMeetsConstraint(1, litC(0))).toBe(false);
    expect(literalMeetsConstraint(-1, litC(0))).toBe(false);
  });

  it("lit(NaN) 接受 NaN（NaN 特例；=== 对 NaN 为 false）", () => {
    expect(literalMeetsConstraint(NaN, litC(NaN))).toBe(true);
    expect(literalMeetsConstraint(0, litC(NaN))).toBe(false);
  });

  it("字段位 / 数组元素位的 -0 不再报违例（同一执法路径一种裁决）", () => {
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, array, fn, any } from "@nudojs/core";
export const fldLit = fn({ o: shape({ v: lit(0) }) }, any());
export const arrLit = fn({ a: array(lit(0)) }, any());`,
    });
    const src = `
export function fldLit(o) { return o; }
export function arrLit(a) { return a; }
fldLit({ v: -0 });
arrLit([-0]);
`;
    const r = checkSource("/t/lib.js", src, pTrue, { loadModule, fromFile: "/t/lib.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("字段位 / 数组元素位真正违约仍报（不放宽过头）", () => {
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, array, fn, any } from "@nudojs/core";
export const fldLit = fn({ o: shape({ v: lit(0) }) }, any());
export const arrLit = fn({ a: array(lit(0)) }, any());`,
    });
    const src = `
export function fldLit(o) { return o; }
export function arrLit(a) { return a; }
fldLit({ v: 1 });
arrLit([1]);
`;
    const r = checkSource("/t/lib.js", src, pTrue, { loadModule, fromFile: "/t/lib.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(2);
  });
});
