/**
 * Bug 1020 —— `lit(1n)`（bigint 字面量契约）在**实参位是恒真契约**：
 * 契约实例化成单条 `eq(x, 1n)` 原子，而 `scan/literal-preds.ts` 的
 * `predEqLiteral` 此前只取 number / string / boolean 三域 ⇒ bigint 字面量端
 * **取不到值** ⇒ 该 eq 原子永远不可判定 ⇒ **零义务**（`k(2)` 假绿）。
 *
 * 症状（族 11 / S1 修前实测，闸① oracle）：
 *   - `lit(1n)` 契约收到 `2` ⇒ 0 违例（**假绿**）
 *   - `union(lit(1n), lit(2n))` 收到 `2` ⇒ 0 违例（**假绿**）
 *
 * 修法（S1，`scan/literal-preds.ts`）：
 *   - `predEqLiteral` 的返回类型**放宽**到含 `bigint`（不收窄、不重排）；
 *   - `judgeLiteralPred` 的标量字面量域同步放行 `bigint`，eq 比较用
 *     字面量同一性口径（`===` + NaN 特例）。
 *
 * ── 口径收窄说明（族 11 裁决）──────────────────────────────────────────
 * - **渲染面已修**：`format.ts` 保留 `n` 后缀 ⇒ `expected: x = 1n`（本钉钉住）。
 * - 「bigint 实参零诊断」只在契约是 `lit(1n)` 时成立；契约是 `lit(1)` 时
 *   bigint 实参由 `typeof` 通道兜住（报 `typeof x = "number"`）。
 *   ⇒ 真正的残留缺口就是本钉钉的这条：`lit(1n)` 在实参位恒真。
 *
 * ⚠ **不在本钉范围内（消费侧 `scan/literal-shapes.ts`，S2 在途）**：
 * 实参**本身是 bigint** 时，`lv` 值类型门（number / string / boolean）仍把
 * eq / or 分支挡在门外 ⇒ `k(1n)` / `k(2n)` 这类实参仍零义务（假绿）；
 * 另外 bigint **实参**的快路径取参也不在本片（`scan/literal-args.ts` 是冻结层）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { lit, union } from "@nudojs/core";
export const bigOne = lit(1n);
export const bigUnion = union(lit(1n), lit(2n));
export const numOne = lit(1);
`;

const IMP = `/// @nudo:import { bigOne, bigUnion, numOne } from "./std1020.nudo.js"\n`;

const FILE = "/t/std1020.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std1020", SIDE, FILE));
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

describe("Bug 1020 —— lit(1n) 字面量契约不再是恒真契约（bigint 字面量端可判定）", () => {
  it("lit(1n) 契约收到 2 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("bigOne", "2"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 1n");
    expect(vs[0]?.actual).toContain("2");
  });

  it("lit(1n) 契约收到 1 ⇒ 判违例（1 ≠ 1n：number 与 bigint 是两个域）", () => {
    const r = check(call("bigOne", "1"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 1n");
  });

  it("union(lit(1n), lit(2n)) 收到 2 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("bigUnion", "2"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1n ∨ x = 2n)");
  });

  it("负控制：lit(1)（number 字面量）收到 2 ⇒ 判违例（既有行为不回退）", () => {
    const r = check(call("numOne", "2"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 1");
  });

  it("负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f(2); }`);
    expect(violated(r).length).toBe(0);
  });
});
