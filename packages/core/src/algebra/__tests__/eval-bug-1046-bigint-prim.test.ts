/**
 * Bug 1046（core 面）—— bigint 字面量契约必须带 `prim: "bigint"`。
 *
 * 病灶：`litC(v)` 只给 number / string / boolean 标 prim，**bigint 字面量不带
 * prim** ⇒ `constraintOnTermAbs` 落到「有界但无 prim ⇒ 按 number 处理」的兜底
 * ⇒ 契约 Abs 的 shape 说 number、pred 说 bigint（`x = 1n`）：
 * - guard 面渲染成 `(typeof data === "number") && (data === 1n)` ⇒ 契约申报的
 *   **唯一合法值 `1n` 被守卫拒收**（假红）；
 * - dts 面把 bigint 契约的返回类型写成 `number`；
 * - union 成员面更糟：`samePrimLiteralUnionAbs` 按 `typeof v` 归类，bigint 落到
 *   兜底分支 ⇒ `union(lit(1n))` 的 shape 说 **boolean**。
 *
 * 修法：`litC` 补 bigint 分支 ⇒ `prim: "bigint"`，与 number / string / boolean
 * 字面量契约**同款口径**（`constraint-builders.test.ts` 钉的
 * `typeof x = "number" ∧ x = 42` 就是这条口径）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  litC,
  union,
  instantiateConstraint,
  constraintToEntryAbs,
} from "../constraint.ts";
import { formatAbs } from "../format.ts";
import { absToConstraint } from "../projection.ts";
import { predToString, pTrue } from "../pred.ts";
import { denoteGuard } from "../../internal.ts";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

/** 契约 Abs → 守卫体（service 的 guard-generator 用的就是同一个 denoteGuard） */
function guardOf(c: ReturnType<typeof litC>): (data: unknown) => boolean {
  const body = denoteGuard(constraintToEntryAbs(c, "x"), "data");
  // denoteGuard 的产物是可直接求值的表达式（`(typeof data === "bigint") && …`）
  return new Function("data", `return ${body};`) as (data: unknown) => boolean;
}

const SIDE = `import { lit } from "@nudojs/core";
export const bigOne = lit(1n);
`;

const IMP = `/// @nudo:import { bigOne } from "./std1046.nudo.js"\n`;

const FILE = "/t/std1046.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std1046", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: CheckIssue[] }): CheckIssue[] {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("Bug 1046 — bigint 字面量契约的 prim 标注", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
  });

  it("litC(1n)：builder 带 prim bigint（改前无 prim ⇒ Abs 落 number 兜底）", () => {
    expect(litC(1n).prim).toBe("bigint");
    // 负控制：其余 prim 口径不变
    expect(litC(1).prim).toBe("number");
    expect(litC("a").prim).toBe("string");
    expect(litC(true).prim).toBe("boolean");
    // nullish 字面量仍**无** prim（Bug 24：nullish 有独立编码，不落 number 兜底）
    expect(litC(null).prim).toBeUndefined();
    expect(litC(undefined).prim).toBeUndefined();
  });

  it("契约 Abs 的 shape 是 prim bigint（不是 number）", () => {
    const entry = constraintToEntryAbs(litC(1n), "x");
    expect(entry.shape).toEqual({ k: "prim", type: "bigint" });
    expect(formatAbs(entry)).toContain("bigint");
    expect(formatAbs(entry)).not.toContain("number");
  });

  it('guard 面：渲染含 typeof data === "bigint"，且 guard(1n) === true（改前假红）', () => {
    const entry = constraintToEntryAbs(litC(1n), "x");
    const body = denoteGuard(entry, "data");
    expect(body).toContain('typeof data === "bigint"');
    expect(body).not.toContain('typeof data === "number"');
    const guard = guardOf(litC(1n));
    expect(guard(1n)).toBe(true);
    expect(guard(1)).toBe(false);
    expect(guard("1n")).toBe(false);
  });

  it("union 成员：union(lit(1n)) 的 shape 也是 prim bigint（改前落 boolean 兜底）", () => {
    const u = union(litC(1n));
    expect(constraintToEntryAbs(u, "x").shape).toEqual({ k: "prim", type: "bigint" });
    const u2 = union(litC(1n), litC(2n));
    expect(constraintToEntryAbs(u2, "x").shape).toEqual({ k: "prim", type: "bigint" });
    const body = denoteGuard(constraintToEntryAbs(u2, "x"), "data");
    expect(body).toContain('typeof data === "bigint"');
  });

  it("实例化口径：bigint 字面量契约带 typeof 义务（与 number/string/boolean 同款）", () => {
    expect(predToString(instantiateConstraint(litC(1n), "x"))).toBe(
      'typeof x = "bigint" ∧ x = 1n',
    );
    // 负控制：既有 prim 的实例化口径不变
    expect(predToString(instantiateConstraint(litC(1), "x"))).toBe(
      'typeof x = "number" ∧ x = 1',
    );
  });

  it("schema 面入口：absToConstraint 对 prim bigint 仍返回 undefined（zod 面走 eq 主导支）", () => {
    // zod / standard 面按「pred 主导」投影：bigint prim 无解码器 ⇒ 仍落 eq 支
    // ⇒ 节点仍是 {k:"lit", value:1n}（Bug 1046 的 zod 面判定，见 service 侧钉）。
    expect(absToConstraint(constraintToEntryAbs(litC(1n), "x"))).toBeUndefined();
  });

  it("门禁接受集不变：lit(1n) 收到 1n ⇒ 零违例", () => {
    const r = check(call("bigOne", "1n"));
    expect(violated(r)).toHaveLength(0);
  });

  it("门禁：bigint 字面量契约收到非 bigint 实参 ⇒ 报违例（literal 义务仍在）", () => {
    const r = check(call("bigOne", "1"));
    const vs = violated(r);
    expect(vs.length).toBeGreaterThan(0);
    // literal 义务（`x = 1n`）仍被报出来——不只是类型义务
    expect(vs.some((v) => String(v.expected).includes("1n"))).toBe(true);
  });
});
