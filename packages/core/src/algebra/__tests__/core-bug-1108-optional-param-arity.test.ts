/**
 * Bug 1108 —— TS `x?: T` 与 JSDoc `[x]` 的形参被当成**必需**参数 ⇒ 元数检查
 * **假红**（P1）。
 *
 * 复现（已核实）：`/** @param {number} [x] *\/ function h(x){}` +
 * `export function caller(){ return h(); }` ⇒ 报 `[ERROR L3 h] h expects 1
 * argument(s), got 0` —— 但 JSDoc 的方括号 = **可省略** ⇒ `h()` 是合法调用。
 *
 * 根因（`param-surface.ts` 的 `formalParamsFromNodes`）：标识符形参一律写死
 * `optional: false` ⇒ 必选元数（`diagnostics.ts` 的 `arityFace` 据
 * `formals[].optional` 算）把可省略的形参算成必填 ⇒ 元数检查假红。
 *
 * 修法（两路来源）：
 * - **JSDoc**：`@param {T} [x]` / `@param {T} [x=1]` 的方括号形态 = 可选；
 * - **TS**：`x?: T` 的 `?` 标记 —— 注意 AST 的 `optional` 标志在 parse 阶段的
 *   类型擦除里已被**删掉**（TS-only 字段）⇒ 只能从**源码文本**判定（绑定名 /
 *   模式之后的 `?`；默认值与类型注解里的 `?` 不误判）。
 *
 * 形参表来自泛化结果（memo 共享）⇒ 只换一份带 `optional` 的副本，不改原对象。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
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

/** 元数检查（`nudo:arg-count`）的 issue 数 */
function argCountIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:arg-count").length;
}

function check(src: string, file: string) {
  return checkSource(file, src, pTrue, {});
}

describe("Bug 1108 —— 可省略形参不计入必选元数", () => {
  it("JSDoc @param {number} [x] ⇒ h() 不报元数错", () => {
    const r = check(
      `/** @param {number} [x] */
function h(x) {}
export function caller() { return h(); }
`,
      "/t/jsdoc-optional.js",
    );
    expect(argCountIssues(r)).toBe(0);
  });

  it("JSDoc @param {string} [y=\"a\"] ⇒ 带默认值的方括号形态也算可选", () => {
    const r = check(
      `/** @param {string} [y="a"] */
function h(y) {}
export function caller() { return h(); }
`,
      "/t/jsdoc-optional-default.js",
    );
    expect(argCountIssues(r)).toBe(0);
  });

  it("TS x?: number ⇒ h() 不报元数错", () => {
    const r = check(
      `function h(x?: number) {}
export function caller() { return h(); }
`,
      "/t/ts-optional.ts",
    );
    expect(argCountIssues(r)).toBe(0);
  });

  it("TS export function h(x?: number) ⇒ 同样不报（JSDoc/TS 挂在 export 上）", () => {
    const r = check(
      `export function h(x?: number) {}
export function caller() { return h(); }
`,
      "/t/ts-optional-export.ts",
    );
    expect(argCountIssues(r)).toBe(0);
  });

  it("负控制：必需形参少传实参仍然报元数错", () => {
    const r = check(
      `function h(x) {}
export function caller() { return h(); }
`,
      "/t/required.js",
    );
    expect(argCountIssues(r)).toBe(1);
  });

  it("负控制：JSDoc 的非方括号 @param 是必填 ⇒ 仍报元数错", () => {
    const r = check(
      `/** @param {number} x */
function h(x) {}
export function caller() { return h(); }
`,
      "/t/jsdoc-required.js",
    );
    expect(argCountIssues(r)).toBe(1);
  });
});
