/**
 * Bug 1111 —— 默认值填充**只在零参调用**时发生（Bug 444 的不完整修复）⇒
 * 漏传尾部位置时**静默**（P1 **假绿**：违约代码被放过 ⇒ 门禁空转）。
 *
 * 复现：`/** @nudo:contract x positive *\/ function e4(a, x = -5)`：
 * - `e4()` 被报（对：x = -5 违约）—— Bug 444 的零参补齐生效；
 * - `e4(1)` **静默** —— 但运行时 x = -5（应当报）⇒ 假绿。
 *
 * 根因（`scan-literal-calls.ts` 的零参守卫 + `literal-args.ts` 的
 * `defaultArgAbss`）：默认值补齐的条件是 `absArgs.length === 0` ⇒ 只要调用点
 * 传了**任意**个实参，缺失的**尾部**位置就不会被默认值填上 ⇒ 契约面看到的
 * 该位是「缺失」⇒ 整条跳过 ⇒ 静默。
 *
 * 修法：补齐**所有缺失的尾部位置**（不只零参调用）；补齐后按形参位逐位执法。
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

const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

function check(src: string, file = "/t/defaults.js") {
  const imp = `/// @nudo:import { positive } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 1111 —— 默认值补齐覆盖缺失的尾部位置", () => {
  it("e4(1)（x = -5，契约 x > 0）⇒ 报违例（默认值违约不沉默）", () => {
    const r = check(`/** @nudo:contract x positive */
function e4(a, x = -5) { return x; }
export function use() { return e4(1); }
`);
    expect(violations(r)).toBe(1);
  });

  it("e4() 仍然报（Bug 444 的零参补齐不回归）", () => {
    const r = check(`/** @nudo:contract x positive */
function e4(a, x = -5) { return x; }
export function use() { return e4(); }
`);
    expect(violations(r)).toBe(1);
  });

  it("默认值合规时不报（x = 5，契约 x > 0，e4(1) ⇒ 零诊断）", () => {
    const r = check(`/** @nudo:contract x positive */
function e5(a, x = 5) { return x; }
export function use() { return e5(1); }
`);
    expect(violations(r)).toBe(0);
  });

  it("多个尾部位置都补齐（f(1) ⇒ b = -1、c = -2 都按默认值执法）", () => {
    const r = check(`/** @nudo:contract b positive */
/** @nudo:contract c positive */
function f(a, b = -1, c = -2) { return a; }
export function use() { return f(1); }
`);
    expect(violations(r)).toBe(2);
  });
});
