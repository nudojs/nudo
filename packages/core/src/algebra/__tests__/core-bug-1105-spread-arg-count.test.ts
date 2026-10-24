/**
 * Bug 1105 —— 非字面量展开实参 `f(...args)` 被计为 **1 个**实参 ⇒
 * `nudo:arg-count` **假红**（P0：合法代码被判违约 ⇒ 卡死用户 CI）。
 *
 * 根因（`scan/literal-args.ts` 的 `parseCallArgs`）：`SpreadElement` 分支对
 * **非数组字面量**的展开只 push 一个 `absUnknown()` ⇒ `absArgs.length` = 1 ⇒
 * `scan-literal-calls.ts` 的 `syntacticArgCount` = 1 ⇒ 元数检查报
 * “expects 2 argument(s), got 1”。
 *
 * 同源三症状：
 * - a) `add(...xs)`（xs = [1,2]）同样误计成 1 个实参；
 * - b) **空洞** `three(...[1,,3])`：原生展开产出 `1, undefined, 3` **三个**实参，
 *   此前空洞被 `continue` 跳过 ⇒ 计成 2 个 ⇒ 假红；
 * - c) **幻影槽位**破坏 rest 聚合：`few(1, ...more)` 的 rest 聚合出
 *   `[1, unknown]` ⇒ 长度 2 ⇒ 违反 `length(xs) <= 1`（假红）。
 *
 * 修法：
 * - 出现非数组字面量展开 ⇒ 实参**个数不可判** ⇒ `argCount = undefined`
 *   ⇒ 元数检查整条跳过（fail-closed：不猜；实参义务检查照跑）；
 * - 数组字面量展开的**空洞**用 `absLit(undefined)` 计入实参数；
 * - rest / length 边界在展开处**停止**（展开后的槽位个数不可知 ⇒ 不计入
 *   已知长度）。
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

const SIDE = `import { number, array } from "@nudojs/core";
export const few = array(number()).max(1);
`;

function check(src: string, file = "/t/spread.js") {
  const imp = `/// @nudo:import { few } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

/** 元数检查（`nudo:arg-count`）的 issue */
function argCountIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:arg-count").length;
}

/** 契约违例的 issue */
function violationIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 1105 —— 展开实参的元数 / 长度边界", () => {
  it("f(...args) 展开到 2 参函数 ⇒ 不报元数错（个数不可判 ⇒ 跳过）", () => {
    const r = check(`function impl(a, b) { return [a, b]; }
export function wrap(...args) { return impl(...args); }
`);
    expect(argCountIssues(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("add(...xs)（xs 是局部数组）⇒ 不报元数错", () => {
    const r = check(`function add(a, b) { return a + b; }
export function use() { const xs = [1, 2]; return add(...xs); }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("数组字面量展开的空洞算一个实参（three(...[1,,3]) ⇒ 3 个）", () => {
    const r = check(`function three(a, b, c) { return a; }
export function use() { return three(...[1, , 3]); }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("rest 长度边界在展开处停止（few(1, ...more) 不违反 length <= 1）", () => {
    const r = check(`/** @nudo:contract xs few */
function few(...xs) { return xs; }
export function use() { const more = [1, 2, 3]; return few(1, ...more); }
`);
    expect(violationIssues(r)).toBe(0);
  });

  it("负控制：真·少传实参仍然报元数错（不掩盖真违规）", () => {
    const r = check(`function impl(a, b) { return [a, b]; }
export function use() { return impl(1); }
`);
    expect(argCountIssues(r)).toBe(1);
  });

  it("负控制：数组字面量展开的实参个数仍按展开后计（f(...[1,2,3]) 对 2 参函数 ⇒ 多传警告）", () => {
    const r = check(`function impl(a, b) { return [a, b]; }
export function use() { return impl(...[1, 2, 3]); }
`);
    expect(argCountIssues(r)).toBeGreaterThan(0);
  });
});
