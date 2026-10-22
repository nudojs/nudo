/**
 * Bug 915（族 11 片 S7 延伸）：**同一份 `lit(1n)` 契约，标量实参位与
 * 字段位 / 元素位必须是同一个裁决**。
 *
 * 背景：S6 把**标量位**的 bigint 义务补齐了（`BigIntLiteral` 取参快路径 +
 * `or` 臂逐支求值）⇒ `f(2n)` 报违例。但**字段位 / 元素位**走域隶属通道，
 * 该通道的守卫只放行 number / string / boolean / null / undefined
 * ⇒ **bigint 字面量实参被直接跳过** ⇒ `shape({ v: lit(1n) })` 收到
 * `{ v: 2n }` **零诊断**（假绿）⇒ 同一份契约两个位置两种裁决（违反 915）。
 *
 * 钉住三向对照（标量位 / 字段位 / 元素位）：
 * - 违约实参（`2n` / `{ v: 2n }` / `[2n]`）⇒ **都报违例**，且条数一致；
 * - 合法实参（`1n` / `{ v: 1n }` / `[1n]`）⇒ **都零诊断**（不得新增诊断）；
 * - union 成员位（`union(lit(1n), lit(2n))`）⇒ 域外 bigint 报违例；
 * - 既有裁决不得回退：`-0` / `0` 的字面量同一性（S3 的 915 修法）仍然放行，
 *   number / string 撞 `lit(1n)` 仍然报违例。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { literalMeetsConstraint } from "../domain-membership.ts";
import { litC } from "../constraint.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDECAR = `import { lit, shape, array, fn, any, union } from "@nudojs/core";
export const scalarLitN = fn({ x: lit(1n) }, any());
export const fieldLitN = fn({ o: shape({ v: lit(1n) }) }, any());
export const elemLitN = fn({ a: array(lit(1n)) }, any());
export const fieldUnionN = fn({ o: shape({ v: union(lit(1n), lit(2n)) }) }, any());
`;

const DECLS = `
export function scalarLitN(x) { return x; }
export function fieldLitN(o) { return o; }
export function elemLitN(a) { return a; }
export function fieldUnionN(o) { return o; }
`;

/** 跑一次调用点扫描，返回 constraint-violated 诊断条数 */
function violations(calls: string): number {
  const { loadModule } = makeFiles({ "/t/lib.nudo.js": SIDECAR });
  const src = `${DECLS}${calls}\n`;
  const r = checkSource("/t/lib.js", src, pTrue, { loadModule, fromFile: "/t/lib.js" });
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 915（延伸）：bigint 字面量契约在字段位 / 元素位与标量位同一裁决", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("域隶属单元层：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 值域已放开）", () => {
    expect(literalMeetsConstraint(1n, litC(1n))).toBe(true);
    expect(literalMeetsConstraint(2n, litC(1n))).toBe(false);
    expect(literalMeetsConstraint(1, litC(1n))).toBe(false);
  });

  it("标量位：f(2n) 报违例、f(1n) 放行（S6 已落，不得回退）", () => {
    expect(violations("scalarLitN(2n);")).toBe(1);
    expect(violations("scalarLitN(1n);")).toBe(0);
  });

  it("字段位：f({ v: 2n }) 报违例、f({ v: 1n }) 放行（915 延伸）", () => {
    expect(violations("fieldLitN({ v: 2n });")).toBe(1);
    expect(violations("fieldLitN({ v: 1n });")).toBe(0);
  });

  it("元素位：f([2n]) 报违例、f([1n]) 放行（915 延伸）", () => {
    expect(violations("elemLitN([2n]);")).toBe(1);
    expect(violations("elemLitN([1n]);")).toBe(0);
  });

  it("三向对照：同一份 lit(1n) 契约在三个位置的裁决条数一致", () => {
    const scalar = violations("scalarLitN(2n);");
    const field = violations("fieldLitN({ v: 2n });");
    const elem = violations("elemLitN([2n]);");
    expect(scalar).toBe(1);
    expect(field).toBe(scalar);
    expect(elem).toBe(scalar);
    // 合法实参：三处都零诊断
    expect(violations("scalarLitN(1n); fieldLitN({ v: 1n }); elemLitN([1n]);")).toBe(0);
  });

  it("union 成员位：域外 bigint 报违例、域内 bigint 放行", () => {
    expect(violations("fieldUnionN({ v: 3n });")).toBe(1);
    expect(violations("fieldUnionN({ v: 1n });")).toBe(0);
    expect(violations("fieldUnionN({ v: 2n });")).toBe(0);
  });

  it("既有裁决不得回退：number / string 撞 lit(1n) 仍报违例", () => {
    expect(violations("fieldLitN({ v: 2 });")).toBe(1);
    expect(violations("fieldLitN({ v: \"x\" });")).toBe(1);
    expect(violations("elemLitN([2]);")).toBe(1);
  });

  it("既有裁决不得回退：-0 与 0 的字面量同一性（S3 的 915 修法）仍然放行", () => {
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, fn, any } from "@nudojs/core";
export const fieldLitZero = fn({ o: shape({ v: lit(0) }) }, any());`,
    });
    const src = `
export function fieldLitZero(o) { return o; }
fieldLitZero({ v: -0 });
`;
    const r = checkSource("/t/lib.js", src, pTrue, { loadModule, fromFile: "/t/lib.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });
});
