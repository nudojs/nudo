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
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, resetGeneralizeMemo } from "@nudojs/core";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

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
