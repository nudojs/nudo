/**
 * Bug 429 —— union / nullable 契约的**成员义务**：or 析取臂对 **nullish 成员**
 * 判不了 ⇒ 聚合臂的 `unknown` 抑制 ⇒ **整条 union 契约零义务**（越界实参全放行）。
 *
 * 症状（族 11 / S1 修前实测，闸① oracle）：
 *   - `union(number().gt(0), lit(null))` 收到 `0`   ⇒ 0 违例（**假绿**）
 *   - `nullable(number().gt(0))`         收到 `0`   ⇒ 0 违例（**假绿**）
 *   - `union(number(), lit(null))`        收到 `"x"` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-preds.ts` 的 `judgeLiteralPred` 判不了 nullish 的 eq 原子
 * （裸值表达不了 `undefined` ⇒ 此前只能取 undefined 哨兵）⇒ or 聚合臂拿到
 * `unknown` ⇒ 「含 undefined 不猜」⇒ 整条契约被跳过。
 *
 * 修法（S1，`scan/literal-preds.ts`）：`judgeLiteralPred` 的 eq 分支先走
 * `predEqNullish`（契约端 tagged 形态）+ 实参的**精确字面量**（实参端）分档判定
 * —— `null` 与 `undefined` 是**两个域**（`===` 天然区分）。
 *
 * ── 与 434 的形态分工（族 11 / S5 已钉）──────────────────────────────────
 * | 形态 | 契约长什么样 | 执法通道 | 归属 |
 * |---|---|---|---|
 * | 裸字面量 | 契约**自身**就是 `lit(null)` | 单条 eq 原子 | 434（S5 已钉） |
 * | union / nullable | 契约**含** nullish **成员** | or 析取分支 | **本钉（429）** |
 *
 * ⚠ **不在本钉范围内（消费侧 `scan/literal-shapes.ts`，S2 在途）**：
 * nullish 实参撞上 union 契约时仍会**假红**（「确定 undefined」早退臂对 `or`
 * 无条件报违例 ⇒ 合法 `null` 也报）。该臂要改成**逐支求值**（任一支真即过）
 * 才行 —— 需要 `nullishKindOf` 分档，不是本片能单独收口的。本钉因此**只钉
 * 成员义务（假绿那一半）**，不钉假红那一半（钉了就是钉住中间形态）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, lit, union, nullable } from "@nudojs/core";
export const posOrNull = union(number().gt(0), lit(null));
export const maybePositive = nullable(number().gt(0));
export const numOrNull = union(number(), lit(null));
`;

const IMP = `/// @nudo:import { posOrNull, maybePositive, numOrNull } from "./std429.nudo.js"\n`;

const FILE = "/t/std429.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std429", SIDE, FILE));
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

describe("Bug 429 —— union / nullable 契约的成员义务（or 析取臂不再被 unknown 抑制）", () => {
  it("union(number().gt(0), lit(null)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("posOrNull", "0"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null)");
    expect(vs[0]?.actual).toContain("0");
  });

  it("nullable(number().gt(0)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("maybePositive", "0"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null ∨ x = undefined)");
  });

  it("union(number(), lit(null)) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrNull", '"x"'));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = null)');
  });

  it("union(number(), lit(null)) 收到 1 ⇒ 放行（成员义务不误伤合法实参）", () => {
    const r = check(call("numOrNull", "1"));
    expect(violated(r).length).toBe(0);
  });

  it("union(number().gt(0), lit(null)) 收到 3 ⇒ 放行（成员义务不误伤合法实参）", () => {
    const r = check(call("posOrNull", "3"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f(0); }`);
    expect(violated(r).length).toBe(0);
  });
});
