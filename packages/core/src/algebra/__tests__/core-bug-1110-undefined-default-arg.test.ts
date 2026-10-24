/**
 * Bug 1110 —— 显式 `undefined` 传给**带默认值**的形参被当成「值就是 undefined」
 * ⇒ 契约面报假红（P1）。
 *
 * 复现：`/** @nudo:contract x positive *\/ function d1(x = 5)`，`d1(undefined)`
 * ⇒ 报「实参 undefined」+「x > 0」两条约束错 + 虚假元数警告。
 *
 * 根因（`scan/literal-args.ts` 的 `parseCallArgs` 的 Identifier `undefined`
 * 分支）：它把 `undefined` 当成**实参值**抽成 `absLit(undefined)`；但 JS 语义是
 * 「带默认值的形参收到显式 `undefined` ⇒ **走默认值**」（`d1(undefined)` ≡ `d1()`）
 * ⇒ 运行时 x = 5（满足 `x > 0`）⇒ 报违例是假红。
 *
 * 修法：复用 `defaultArgAbss` —— 显式 `undefined` 的实参位**改用默认值**再执法。
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

function check(src: string, file = "/t/undef.js") {
  const imp = `/// @nudo:import { positive } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 1110 —— 显式 undefined 走默认值", () => {
  it("d1(undefined)（x = 5，契约 x > 0）⇒ 零诊断（默认值 5 满足契约）", () => {
    const r = check(`/** @nudo:contract x positive */
function d1(x = 5) { return x; }
export function use() { return d1(undefined); }
`);
    expect(violations(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("默认值本身违约时仍要报（d2(undefined)，x = -5，契约 x > 0）", () => {
    const r = check(`/** @nudo:contract x positive */
function d2(x = -5) { return x; }
export function use() { return d2(undefined); }
`);
    expect(violations(r)).toBe(1);
  });

  it("负控制：没有默认值的形参收 undefined ⇒ 仍按 undefined 执法（报 typeof 违例）", () => {
    const r = check(`/** @nudo:contract x positive */
function d3(x) { return x; }
export function use() { return d3(undefined); }
`);
    expect(violations(r)).toBeGreaterThan(0);
  });
});
