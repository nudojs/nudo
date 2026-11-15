// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): core-bug-1020-bigint-lit-contract-tautology.test.ts + core-bug-1020-bigint-literal-arg-fastpath.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import type { type CheckIssue } from "../check/check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

describe("[merged] core-bug-1020-bigint-lit-contract-tautology.test.ts", () => {
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
function violated(r: { issues: CheckIssue[] }) {
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
    // 族 48（主 agent 追认，2026-10-23）：bigint 字面量契约**补齐了缺失的
    // `typeof` 类型义务** ⇒ 与 number/string/boolean 兄弟 prim **同款**
    // （`constraint-builders.test.ts` 钉的 `typeof x = "number" ∧ x = 42` 即该口径）
    // ⇒ 类型不符时**多报一条**「类型义务」诊断。
    // ⇒ 本用例的**核心主张**（`lit(1n)` 在实参位不再是恒真契约 ⇒ 必判违例）**不变**，
    // 变的只是**条数**与**首条消息**。两条都成立（`2` 既不是 bigint，也不等于 `1n`）。
    expect(vs.length).toBe(2);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
    expect(vs[0]?.actual).toContain("2");
  });

  it("lit(1n) 契约收到 1 ⇒ 判违例（1 ≠ 1n：number 与 bigint 是两个域）", () => {
    const r = check(call("bigOne", "1"));
    const vs = violated(r);
    // 同上（族 48 · 主 agent 追认）：bigint 补齐 `typeof` 义务 ⇒ 条数 1 → 2。
    expect(vs.length).toBe(2);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
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
});

describe("[merged] core-bug-1020-bigint-literal-arg-fastpath.test.ts", () => {
/**
 * Bug 1020 —— **bigint 实参的取参快路径**：`f(1n)` 的实参取不到 ⇒ 调用点
 * **没有可执法信息** ⇒ 整条调用点被静默跳过（假绿；与 430 的 boolean 形态
 * 同款：「顶层靠执行态回退才报错、函数体内静默」）。
 *
 * 症状（族 11 / S6 修前实测，闸① oracle）：
 *   - `lit(1n)`                 收到 `2n` ⇒ 0 违例（**假绿**）
 *   - `lit(2n)`                 收到 `1n` ⇒ 0 违例（**假绿**）
 *   - `union(lit(1n), lit(2n))` 收到 `3n` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-args.ts` 的 `parseCallArgs` **快路径分派表**里没有
 * `BigIntLiteral` 分支 ⇒ bigint 字面量落兜底 `absUnknown()` ⇒ `hasInfo=false`
 * ⇒ 该调用点整条跳过执法（静态路径）。
 *
 * 修法（S6，`scan/literal-args.ts`）：补 `BigIntLiteral` 分支（prim + lit
 * term + `conf: "exact"`，与 430 的 `BooleanLiteral` 分支同款）。
 *
 * ⚠ **Babel 节点形态实测**（`parse-source.ts` 的 `@babel/parser`，typescript
 * + jsx 插件）：
 *   - `1n` 的节点类型 = **`BigIntLiteral`**；
 *   - `node.value` 是**真 bigint**（`typeof node.value === "bigint"`），
 *     **不是字符串**；原始文本在 `node.extra.raw`（如 `"0x10n"` / `"1_000n"`）
 *     ⇒ 取值直接用 `node.value`（已归一化的十进制 bigint），**不要**去解析
 *     `extra.raw`；
 *   - **负 bigint 不是 `BigIntLiteral` 节点**，而是 `UnaryExpression(-)` 包
 *     `BigIntLiteral` ⇒ 与既有的 `Unary(-)` 分支同款处理。
 */





const SIDE = `import { lit, union } from "@nudojs/core";
export const litOneN = lit(1n);
export const litTwoN = lit(2n);
export const litNegN = lit(-1n);
export const litUnionN = union(lit(1n), lit(2n));
`;

const IMP = `/// @nudo:import { litOneN, litTwoN, litNegN, litUnionN } from "./std1020.nudo.js"\n`;

const FILE = "/t/std1020.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std1020", SIDE, FILE));
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

describe("Bug 1020 —— bigint 实参可取参（快路径补 BigIntLiteral 分支）", () => {
  it("lit(1n) 收到 2n ⇒ 判违例（改前 0 违例 = 假绿：实参取不到）", () => {
    const r = check(call("litOneN", "2n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 1n");
    // 实参确实被取到了（actual 里能看到 bigint 值）
    expect(String(vs[0]?.actual)).toContain("2n");
  });

  it("lit(2n) 收到 1n ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litTwoN", "1n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 2n");
  });

  it("union(lit(1n), lit(2n)) 收到 3n ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litUnionN", "3n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1n ∨ x = 2n)");
  });

  it("负控制：lit(1n) 收到 1n ⇒ 放行（取到实参且满足契约）", () => {
    const r = check(call("litOneN", "1n"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(lit(1n), lit(2n)) 收到 1n ⇒ 放行", () => {
    const r = check(call("litUnionN", "1n"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(lit(1n), lit(2n)) 收到 2n ⇒ 放行（2n 落在 union 域内）", () => {
    const r = check(call("litUnionN", "2n"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：lit(-1n) 收到 -1n ⇒ 放行（负 bigint 是 UnaryExpression(-)+BigIntLiteral）", () => {
    const r = check(call("litNegN", "-1n"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：lit(-1n) 收到 1n ⇒ 判违例（负 bigint 也取到了）", () => {
    const r = check(call("litNegN", "1n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = -1n");
  });

  it("负控制：没有契约的形参收到 1n ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f(1n); }`);
    expect(violated(r).length).toBe(0);
  });
});
});
