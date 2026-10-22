/**
 * Bug 431 —— union 契约的 **prim 成员**：成员实例化成 `typeof` 原子
 * （`union(number(), string())` ⇒ `or(typeof(x,"number"), typeof(x,"string"))`）
 * ⇒ 执法侧判不了 `typeof` 原子 ⇒ or 聚合臂拿到 `unknown` ⇒
 * **整条 union 契约零义务**（不在成员域内的实参全放行 = 假绿）。
 *
 * 症状（族 11 / S1 修前实测，闸① oracle）：
 *   - `union(number(), string())`  收到 `true` ⇒ 0 违例（**假绿**）
 *   - `union(number(), boolean())` 收到 `"x"`  ⇒ 0 违例（**假绿**）
 *   - `union(number(), lit("a"))`  收到 `true` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-preds.ts` 的 `judgeLiteralPred` 只认 eq / 数值界原子，
 * 没有 `typeof`（`ptypeof` 构造器产物）分支 ⇒ 类型级成员判不了。
 *
 * 修法（S1，`scan/literal-preds.ts`）：`judgeLiteralPred` 加 `typeof` 分支 ——
 * 按实参 Abs 的 prim 形状（prim / obj / arr / tuple / fn + nullish 分档）算出
 * JS `typeof` 名，再与谓词的 `type` 比。
 *
 * ⚠ **不在本钉范围内（消费侧 `scan/literal-shapes.ts`，S2 在途）**：
 * 实参**不是标量字面量**（如 `{}` / `[]`）时，or 聚合臂仍被 `lv` 值类型门
 * 挡在门外 ⇒ 那几种实参仍零义务（假绿）。本钉只钉**标量实参**这一族。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, string, boolean, lit, union } from "@nudojs/core";
export const numOrStr = union(number(), string());
export const numOrBool = union(number(), boolean());
export const numOrA = union(number(), lit("a"));
`;

const IMP = `/// @nudo:import { numOrStr, numOrBool, numOrA } from "./std431.nudo.js"\n`;

const FILE = "/t/std431.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std431", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: { code: string }[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("Bug 431 —— union 契约的 prim 成员（typeof 原子可判定）", () => {
  it("union(number(), string()) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrStr", "true"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ typeof x = "string")');
    expect(vs[0]?.actual).toContain("true");
  });

  it("union(number(), boolean()) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrBool", '"x"'));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ typeof x = "boolean")');
  });

  it("union(number(), lit('a')) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrA", "true"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = "a")');
  });

  it("union(number(), string()) 收到 's' ⇒ 放行（成员域内的实参不误伤）", () => {
    const r = check(call("numOrStr", '"s"'));
    expect(violated(r).length).toBe(0);
  });

  it("union(number(), string()) 收到 1 ⇒ 放行（成员域内的实参不误伤）", () => {
    const r = check(call("numOrStr", "1"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f(true); }`);
    expect(violated(r).length).toBe(0);
  });
});
