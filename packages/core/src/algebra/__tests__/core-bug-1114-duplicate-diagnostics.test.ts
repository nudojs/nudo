/**
 * Bug 1114 —— **重复诊断**：同一实参位上同一条违例被报两次。
 *
 * 症状 A（typeof 通道 + eq 通道双报）：
 * `lit(1n)` 契约收到 `1` ⇒ 同时发「typeof x = "bigint"」与「x = 1n」。
 * 根因：`checkReqs` 里 `hasVarTypeof` 守卫**只覆盖** eq 通道的
 * `r === undefined`（类型级兜底）回退；本次 eq 是**判得假**（`1 !== 1n`）
 * ⇒ 守卫失效 ⇒ 两条都报。
 *
 * 症状 B（shape 通道 + 谓词通道双报）：
 * `shape({id:number().gt(0)})` 收到 `null` / `undefined` ⇒ 同时发
 * 「object shape at x」（结构通道）与「x.id > 0」（谓词通道的字段界）。
 *
 * 修法（**同一实参位**内让位，别的形参位不受影响）：
 * - **数值界**通道在 typeof 通道**已报**时让位（类型都不对时「x > 0」这类
 *   界判据对实参没有意义 ⇒ 同一条违例只报一次）；
 * - 结构通道**已报「实参不是 object」** ⇒ 同一实参位的谓词通道让位
 *   （`checkShapeReqs` 把这批形参下标回传，谓词通道按集合跳过）。
 *
 * ⚠ **值义务（eq）通道不让位**（`lit(1n)` 收到 `1` 仍报 2 条）—— 见文末
 * 「未修的一半」。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
});

const SIDE = `import { number, lit, shape } from "@nudojs/core";
export const bigOne = lit(1n);
export const idShape = shape({ id: number().gt(0) });
export const positive = number().gt(0);
`;

function check(src: string, file = "/t/dup.js") {
  const imp = `/// @nudo:import { bigOne, idShape, positive } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

/** 调用点前置条件违例 */
function violated(r: { issues: { code: string }[] }): { expected?: string }[] {
  return r.issues
    .filter((i) => i.code === "nudo:constraint-violated")
    .map((i) => i as { expected?: string });
}

describe("Bug 1114 —— 同一实参位不重复报同一条违例", () => {
  it("shape({id:number().gt(0)}) 收到 null ⇒ 只报一条（结构通道）", () => {
    const r = check(`/** @nudo:contract x idShape */
function s(x) { return x; }
export function use() { return s(null); }
`);
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("object shape at x");
  });

  it("shape({id:number().gt(0)}) 收到 undefined ⇒ 只报一条（结构通道）", () => {
    const r = check(`/** @nudo:contract x idShape */
function s(x) { return x; }
export function use() { return s(undefined); }
`);
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("object shape at x");
  });

  it("number().gt(0) 收到 boolean ⇒ 只报一条（typeof 通道；数值界让位）", () => {
    const r = check(`/** @nudo:contract x positive */
function s(x) { return x; }
export function use() { return s(true); }
`);
    expect(violated(r).length).toBe(1);
  });

  it("负控制：真的是数值界违例时仍报（且只报一条）", () => {
    const r = check(`/** @nudo:contract x positive */
function s(x) { return x; }
export function use() { return s(-1); }
`);
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x > 0");
  });

  it("负控制：不同形参位各报各的（让位只压同一实参位）", () => {
    const r = check(`/** @nudo:contract x positive */
/** @nudo:contract y positive */
function s(x, y) { return x + y; }
export function use() { return s(-1, -2); }
`);
    expect(violated(r).length).toBe(2);
  });
});

/**
 * ⚠ **未修**的一半（口径冲突，保留既有门禁行为）：
 *
 * `lit(1n)` 收到 `1` ⇒ 同时发「typeof x = "bigint"」与「x = 1n」。
 *
 * 这**不是**重复：契约 `lit(1n)` 是「`typeof x = "bigint"` ∧ `x = 1n`」**两条
 * 独立义务**；类型不符**与**值不符是**两个事实**。族 48（主 agent 追认
 * 2026-10-23）明确要求 bigint 字面量契约**补齐 typeof 义务** ⇒ 类型不符时
 * **多报一条**「类型义务」诊断；既有门禁
 * `core-bug-1020-bigint-lit-contract-tautology` 与
 * `eval-bug-1046-bigint-prim` 钉住条数（各 2 条）。
 *
 * ⇒ 本项**保持现状**（不把 eq / 值义务通道纳入让位范围），在此钉住口径。
 */
describe("Bug 1114 未修的一半 —— 值义务（eq）与类型义务是两条独立义务", () => {
  it("lit(1n) 收到 1 ⇒ 报两条（类型义务 + 值义务，族 48 口径）", () => {
    const r = check(`/** @nudo:contract x bigOne */
function k(x) { return x; }
export function use() { return k(1); }
`);
    const vs = violated(r);
    expect(vs.length).toBe(2);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
  });
});
