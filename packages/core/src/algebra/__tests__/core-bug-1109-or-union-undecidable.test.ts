/**
 * Bug 1109 —— `or`（union / nullable）契约中「**不可判定**」的成员被当成失败
 * ⇒ 假红（P1）。
 *
 * 复现：`union(number().gt(0), lit("a"))` 收到**非字面量 number**
 * （`n = Number(process.argv[2])`）⇒ 报 `(x > 0 ∨ x = "a")`（act = number）。
 *
 * 根因（`scan/literal-shapes.ts` 的 `judgeOrMember` + `checkReqs` 的 `or`
 * 聚合臂）：
 * - `instantiateOnTerm` 对「prim + preds」的成员**不带** typeof 原子 ⇒
 *   `union(number().gt(0), lit("a"))` 实例化成 `or(gt(x,0), eq(x,"a"))`；
 * - `gt(x,0)` 对**非字面量** number 实参**不可判定**（值未知）；
 * - `eq(x,"a")` 的类型级兜底按形态判 ⇒ number ≠ string ⇒ **false**；
 * - 旧聚合规则「**任一支 false ⇒ 违例**」⇒ 把「不可判定且域兼容（number）」
 *   的成员误判成违例 ⇒ 假红（实参完全可能满足 `x > 0` 那支）。
 *
 * 修法：三值聚合改成「**全部**成员确定假才报」；成员「不可判定」时再看**域
 * 类型**（`memberDomainKind`）：域与实参形态**兼容**（或判不出）⇒ 整条 union
 * 保持未决 ⇒ 跳过（fail-closed：不猜）。`unionPredDecides`（结构通道让位闸）
 * 同步改成同一口径 ⇒ 两条通道不会双报 / 互不越权。
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

const SIDE = `import { number, string, lit, union } from "@nudojs/core";
export const posOrLit = union(number().gt(0), lit("a"));
export const litOrLit = union(lit(1), lit("a"));
export const numOrStr = union(number(), string());
export const posOrNull = union(number().gt(0), lit(null));
`;

function check(src: string, file = "/t/union.js") {
  const imp = `/// @nudo:import { posOrLit, litOrLit, numOrStr, posOrNull } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("Bug 1109 —— union 的不可判定成员不再被当成失败", () => {
  it("union(number().gt(0), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）", () => {
    const r = check(`/** @nudo:contract x posOrLit */
function u(x) { return x; }
const n = Number(process.argv[2]);
export function use() { return u(n); }
`);
    expect(violations(r)).toBe(0);
  });

  it("union(lit(1), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）", () => {
    const r = check(`/** @nudo:contract x litOrLit */
function u(x) { return x; }
const n = Number(process.argv[2]);
export function use() { return u(n); }
`);
    expect(violations(r)).toBe(0);
  });

  it("负控制：字面量不在 union 内 ⇒ 仍报违例", () => {
    const r = check(`/** @nudo:contract x litOrLit */
function u(x) { return x; }
export function use() { return u("b"); }
`);
    expect(violations(r)).toBe(1);
  });

  it("负控制：类型完全不符（boolean 实参 vs union(number(), string())）⇒ 仍报违例", () => {
    const r = check(`/** @nudo:contract x numOrStr */
function u(x) { return x; }
export function use() { return u(true); }
`);
    expect(violations(r)).toBe(1);
  });

  it("负控制：满足其中一支（字面量 'a'）⇒ 不报", () => {
    const r = check(`/** @nudo:contract x posOrLit */
function u(x) { return x; }
export function use() { return u("a"); }
`);
    expect(violations(r)).toBe(0);
  });
});

/**
 * A3 残留回归钉（review F34 其它线索）：`union(number().gt(0), lit(null))`
 * 收到**对象 / 数组**实参时，数值界成员「不可判定」且 null 成员类型为假
 * ⇒ 旧口径会把「不可判定」当「不违反」静默放过。三值聚合修法后，域不兼容
 * （object / array vs number|null）⇒ **不得**静默 ⇒ 必须报 1 条违例；
 * 合法成员（null / 正数字面量）仍不报。
 */
describe("Bug 1109 残留 —— union(number().gt(0), lit(null)) 的域不兼容实参不得静默", () => {
  it.each([["{}"], ["[]"]])(
    "对象/数组实参 %s ⇒ 恰好 1 条 nudo:constraint-violated",
    (arg) => {
      const r = check(`/** @nudo:contract x posOrNull */
function u(x) { return x; }
export function use() { return u(${arg}); }
`);
      expect(violations(r)).toBe(1);
    },
  );

  it.each([["null"], ["1"]])("合法成员 %s ⇒ 不报", (arg) => {
    const r = check(`/** @nudo:contract x posOrNull */
function u(x) { return x; }
export function use() { return u(${arg}); }
`);
    expect(violations(r)).toBe(0);
  });
});
