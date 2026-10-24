/**
 * Bug 431 / 1020 —— **非标量实参**撞标量 / union 契约时的义务（假绿那一半）。
 *
 * 症状（族 11 / S6 修前实测，闸① oracle）：
 *   - `union(number(), string())` 收到 `{}` ⇒ 0 违例（**假绿**）
 *   - `union(number(), string())` 收到 `[]` ⇒ 0 违例（**假绿**）
 *   - `lit(1n)`              收到 `{}` ⇒ 0 违例（**假绿**）
 *   - `lit(1n)`              收到 `[]` ⇒ 0 违例（**假绿**）
 *   - `union(lit(1), lit(2))` 收到 `{}` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-shapes.ts` 的 `checkReqs` 里 `lv` **值类型门**
 * （`if (lv === undefined) continue;` + `typeof lv === number|string|boolean`）
 * 把对象 / 数组 / bigint 实参挡在 eq / or 分支外 ⇒ 那些实参对 `lit(...)`
 * 契约**零义务**。
 *
 * ⚠ **区分「不可判定」与「确定违例」**：对象 / 数组 / 函数实参对**标量**
 * 字面量契约是**确定违例**（`{}` 永远不是 `1`），不是「不知道」⇒ 不能因为
 * 取不到标量值就跳过（那是假绿）。
 *
 * 修法（S6）：
 *   - `eq` 分支：实参是精确字面量 ⇒ 按**字面量同一性**比；实参不是字面量
 *     但**形态确定** ⇒ **类型级**判定（形态 ≠ 字面量端类型 ⇒ 确定违例）。
 *   - `or` 分支：`or` 聚合臂**移出** `lv` 值类型门（对所有实参可达）⇒
 *     `typeof` 成员 / nullish 成员 / 字面量成员都能参与逐支求值。
 *
 * ── 任务③：`or` 聚合臂的 `unknown` 语义收紧 ─────────────────────────────
 * 聚合规则从「含 undefined 不猜」收紧为「**全部成员都判不了**才算不可判定」：
 * 只要**有一个成员能判为 false** ⇒ 确定违例（要报）。
 * ⇒ `union(number(), lit(null))` 收到 `{}`：`typeof` 成员判 false（object ≠
 * number）、`lit(null)` 成员判不了 ⇒ **仍然报违例**。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, string, lit, union } from "@nudojs/core";
export const numOrStr = union(number(), string());
export const litOneN = lit(1n);
export const litUnion1 = union(lit(1), lit(2));
export const numOrNull = union(number(), lit(null));
`;

const IMP = `/// @nudo:import { numOrStr, litOneN, litUnion1, numOrNull } from "./std431.nudo.js"\n`;

const FILE = "/t/std431.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std431", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: CheckIssue[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("Bug 431 / 1020 —— 非标量实参撞标量 / union 契约不再零义务", () => {
  it("union(number(), string()) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrStr", "{}"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ typeof x = "string")');
  });

  it("union(number(), string()) 收到数组 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrStr", "[]"));
    expect(violated(r).length).toBe(1);
  });

  it("lit(1n) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litOneN", "{}"));
    const vs = violated(r);
    // 族 48（主 agent 追认，2026-10-23）：bigint 字面量契约**补齐了缺失的
    // `typeof` 类型义务** ⇒ 与 number/string/boolean 兄弟 prim **同款**
    // ⇒ 首条消息由 `x = 1n` 变为 `typeof x = "bigint"`。
    // 本用例的**核心主张**（对象实参违反 lit(1n) 契约 ⇒ 必判违例）**不变**，
    // **违例条数不变**（仍是 1 条）—— 变的只是**首条消息的措辞**。
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
  });

  it("lit(1n) 收到数组 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litOneN", "[]"));
    expect(violated(r).length).toBe(1);
  });

  it("union(lit(1), lit(2)) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litUnion1", "{}"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1 ∨ x = 2)");
  });

  it("任务③：一个成员判 false、其余判不了 ⇒ 仍判违例（unknown 语义收紧）", () => {
    // `typeof` 成员判 false（object ≠ number）、`lit(null)` 成员判不了
    const r = check(call("numOrNull", "{}"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = null)');
  });

  it("负控制：union(number(), string()) 收到 number ⇒ 放行", () => {
    const r = check(call("numOrStr", "1"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(number(), string()) 收到 string ⇒ 放行", () => {
    const r = check(call("numOrStr", '"s"'));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(lit(1), lit(2)) 收到 1 ⇒ 放行", () => {
    const r = check(call("litUnion1", "1"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(lit(1), lit(2)) 收到 3 ⇒ 判违例（两个成员都判 false）", () => {
    const r = check(call("litUnion1", "3"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1 ∨ x = 2)");
  });

  it("负控制：union(number(), lit(null)) 收到 null ⇒ 放行（null 成员为真）", () => {
    const r = check(call("numOrNull", "null"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：没有契约的形参收到对象 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f({}); }`);
    expect(violated(r).length).toBe(0);
  });
});
