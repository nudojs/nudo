/**
 * Bug 1106 —— 裸名 callee 的解析**不看作用域** ⇒ 无契约也触发元数**假红**
 * （P1）。
 *
 * 复现（已核实）：`function log(level,msg){}` +
 * `export function run(log){ log("hi") }` ⇒ 报 `[ERROR L2 log] log expects 2
 * argument(s), got 1` —— 但 `run` 的形参 `log` **遮蔽**了顶层声明的 `log`
 * ⇒ 这次调用的是**形参**（不是顶层那个 2 参函数）⇒ 元数检查不该套上去。
 *
 * 根因（`scan-call-graph.ts` 的 `resolveCalleeFn` 的 Identifier 分支）：
 * `knownFns.has(name)` 就当被调函数 ⇒ **完全无视**词法作用域。
 *
 * 报告点出的 5 类遮蔽来源（全部钉住）：参数 / 局部 `const` / 嵌套函数 /
 * for-of 绑定 / 解构绑定。
 *
 * 修法：解析裸名 callee 时**尊重作用域** —— 沿作用域链（内层 → 外层）找绑定：
 * 命中别名（`const f = knownFn`）⇒ 用别名；命中同名声明 ⇒ **遮蔽** ⇒ 不解析成
 * 顶层声明的那个函数（fail-closed：不猜）。
 *
 * ⚠ 同一复现里还有一条 `nudo:entry-may-throw`（`run (export): may throw
 * TypeError`）：那是**求值引擎**对「调用未受约束的值」的 fail-closed 判定
 * （`check.ts` / `exec/**` 面，不在本修复范围）⇒ 本钉只断言**元数**通道。
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

function check(src: string, file = "/t/callee-scope.js") {
  return checkSource(file, src, pTrue, {});
}

const TOP = `function log(level, msg) { return level; }
`;

describe("Bug 1106 —— 裸名 callee 尊重词法作用域", () => {
  it("形参同名 ⇒ 不套顶层函数的元数", () => {
    const r = check(`${TOP}
export function run(log) { log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("局部 const 同名 ⇒ 不套顶层函数的元数", () => {
    const r = check(`${TOP}
export function run() { const log = (a, b) => a; log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("嵌套函数同名 ⇒ 不套顶层函数的元数", () => {
    const r = check(`${TOP}
export function run() { function log(a, b) { return a; } log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("for-of 绑定同名 ⇒ 不套顶层函数的元数", () => {
    const r = check(`${TOP}
export function run(xs) { for (const log of xs) { log("hi"); } }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("解构绑定同名 ⇒ 不套顶层函数的元数", () => {
    const r = check(`${TOP}
export function run(o) { const { log } = o; log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  });

  it("负控制：没有同名遮蔽 ⇒ 顶层函数的元数照常检查（真违规仍报）", () => {
    const r = check(`${TOP}
export function run() { log("hi"); }
`);
    expect(argCountIssues(r)).toBe(1);
  });

  it("负控制：别名绑定仍按别名解析（const f = log ⇒ f() 查 log 的元数）", () => {
    const r = check(`${TOP}
export function run() { const f = log; f("hi"); }
`);
    expect(argCountIssues(r)).toBe(1);
  });
});
