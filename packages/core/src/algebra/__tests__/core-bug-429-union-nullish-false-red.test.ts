/**
 * Bug 429 —— union / nullable 契约的**假红那一半**：`or` 析取臂对 nullish
 * 实参**无条件报违例** ⇒ **合法实参被报红**。
 *
 * 症状（族 11 / S6 修前实测，闸① oracle；S1 只钉了「假绿那一半」）：
 *   - `union(number().gt(0), lit(null))` 收到 `null`      ⇒ 1 违例（**假红**）
 *   - `nullable(number().gt(0))`         收到 `null`      ⇒ 1 违例（**假红**）
 *   - `nullable(number().gt(0))`         收到 `undefined` ⇒ 1 违例（**假红**）
 *   - `union(number(), lit(null))`        收到 `null`      ⇒ 1 违例（**假红**）
 *   - `union(number().gt(0), lit(undefined))` 收到 `undefined` ⇒ 1 违例（**假红**）
 *
 * 根因：`scan/literal-shapes.ts` 的 `checkReqs` 里「确定 undefined」早退臂
 * （nullish 实参）对 `gt/ge/lt/le/eq/**or**` 一律报违例 ⇒ 析取契约**没有
 * 逐支求值** ⇒ 落在 union 域内的合法 nullish 实参也被报红。
 *
 * 修法（S6，`scan/literal-shapes.ts`）：早退臂**不再**对 `or` 报违例 ⇒ `or`
 * 落到 `or` 聚合臂，**逐支求值**（任一支真即过）。
 *
 * ── 与 S1 的 429 钉的分工 ────────────────────────────────────────────────
 *   - `core-bug-429-union-nullish-member-obligation.test.ts`（S1 已钉）
 *     ⇒ **假绿那一半**（nullish 成员判不了 ⇒ 整条 union 零义务）
 *   - **本钉** ⇒ **假红那一半**（合法 nullish 实参撞 union 契约被报红）
 *
 * ⚠ **不要**把这个口径搬到别处：nullish 是**两个域**（`null` 与 `undefined`
 * 互不相等）——`union(number().gt(0), lit(null))` 收到 `undefined` 仍然**该
 * 报红**（本钉的负控制钉住了这一点）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, lit, union, nullable } from "@nudojs/core";
export const posOrNull = union(number().gt(0), lit(null));
export const posOrUndef = union(number().gt(0), lit(undefined));
export const maybePositive = nullable(number().gt(0));
export const numOrNull = union(number(), lit(null));
export const numOrUndef = union(number(), lit(undefined));
`;

const IMP = `/// @nudo:import { posOrNull, posOrUndef, maybePositive, numOrNull, numOrUndef } from "./std429b.nudo.js"\n`;

const FILE = "/t/std429b.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std429b", SIDE, FILE));
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

describe("Bug 429 —— union / nullable 契约的假红那一半（合法 nullish 实参不再报红）", () => {
  it("union(number().gt(0), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）", () => {
    const r = check(call("posOrNull", "null"));
    expect(violated(r).length).toBe(0);
  });

  it("nullable(number().gt(0)) 收到 null ⇒ 放行（改前 1 违例 = 假红）", () => {
    const r = check(call("maybePositive", "null"));
    expect(violated(r).length).toBe(0);
  });

  it("nullable(number().gt(0)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）", () => {
    const r = check(call("maybePositive", "undefined"));
    expect(violated(r).length).toBe(0);
  });

  it("union(number(), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）", () => {
    const r = check(call("numOrNull", "null"));
    expect(violated(r).length).toBe(0);
  });

  it("union(number(), lit(undefined)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）", () => {
    const r = check(call("numOrUndef", "undefined"));
    expect(violated(r).length).toBe(0);
  });

  it("union(number().gt(0), lit(undefined)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）", () => {
    const r = check(call("posOrUndef", "undefined"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：null 与 undefined 是两个域 —— posOrNull 收到 undefined 仍报违例", () => {
    const r = check(call("posOrNull", "undefined"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null)");
  });

  it("负控制：posOrUndef 收到 null 仍报违例", () => {
    const r = check(call("posOrUndef", "null"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = undefined)");
  });

  it("负控制：numOrNull 收到 undefined 仍报违例", () => {
    const r = check(call("numOrNull", "undefined"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = null)');
  });

  it("负控制：越界实参仍报违例（逐支求值不是「一律放行」）", () => {
    const r = check(call("posOrNull", "0"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null)");
  });

  it("负控制：没有契约的形参收到 null ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f(null); }`);
    expect(violated(r).length).toBe(0);
  });
});
