/**
 * Bug 1129（并发 review F23 / P2）—— `leq` 的函数 arity 只比较**必选参数个数**，
 * 漏掉「**可选参数之后的必选参数**」。
 *
 * 现象：`(a = 1, b) => b.toFixed()`（`optionalParams = [true, false]` ⇒ 必选
 * 参数个数 = 1）被接受为**单参**目标（`fnAbs(["x"])`）；而原生
 * `g = (x) => f(x); g(1)` **抛 TypeError**（`b` 是 `undefined` ⇒
 * `b.toFixed()` 炸）⇒ `leq` 的判定比原生**松** ⇒ 假绿。
 *
 * 根因：`packages/core/src/algebra/leq.ts` 的 `fnRequiredArity` 数的是
 * 「**有几个**必选参数」，而 arity 义务要的是「**最后一个必选参数在第几位**」
 * —— 前者把 `(a = 1, b)` 记成 1（后者是 2）。
 *
 * 修法：按**最后一个必选参数的位置**比较（= 最小实参元数，TS 语义：
 * 可选参数之后的参数仍必选）。`optionalParams` 缺省时回退名字后缀判据
 * （`...rest` / `x?`），`requiredFnArity` 的**公开行为一字不改**。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { leqAbs } from "../leq.ts";
import { abs, type Abs, type Shape } from "../abs.ts";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** fn shape（可选带 `optionalParams` 标记——写侧口径，同 Bug 399 钉） */
function fnAbs(params: string[], optionalParams?: boolean[]): Abs {
  const shape = {
    k: "fn" as const,
    params,
    ...(optionalParams ? { optionalParams } : {}),
  };
  return abs(shape as Shape, undefined, undefined, "exact");
}

describe("Bug 1129 — fn arity 按「最后一个必选参数的位置」比较", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("原生 oracle：可选参数之后的必选参数 ⇒ 少传就炸", () => {
    const f = (a = 1, b: number): string => b.toFixed();
    // TS 侧也拒绝少传（`b` 是必选位）⇒ 用 @ts-expect-error 记下这条**类型级**事实；
    // 运行时（JS 语义）同样炸：`b` 为 undefined ⇒ `b.toFixed()` TypeError。
    // @ts-expect-error TS2554: 必选位 `b` 不可省
    const g = (x: number): string => f(x);
    expect(() => g(1)).toThrow(TypeError);
    // 传够两个就不炸
    expect(f(1, 2)).toBe("2");
  });

  it("(a = 1, b) ⊭ 单参目标（最小实参元数 = 2）", () => {
    const src = fnAbs(["a", "b"], [true, false]);
    const r = leqAbs(src, fnAbs(["x"]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 2");
  });

  it("(a = 1, b) ⩽ 双参目标（目标给够两个 ⇒ 可赋值）", () => {
    const src = fnAbs(["a", "b"], [true, false]);
    expect(leqAbs(src, fnAbs(["x", "y"])).ok).toBe(true);
  });

  it("既有口径不变：(a, b = 1) ⩽ 单参目标（必选只有 a）", () => {
    const src = fnAbs(["a", "b"], [false, true]);
    expect(leqAbs(src, fnAbs(["x"])).ok).toBe(true);
    expect(leqAbs(src, fnAbs([])).ok).toBe(false);
  });

  it("可选参数之后的必选参数算进最小元数：(a, b = 1, c) ⇒ 最小 3", () => {
    const src = fnAbs(["a", "b", "c"], [false, true, false]);
    expect(leqAbs(src, fnAbs(["x", "y"])).ok).toBe(false);
    expect(leqAbs(src, fnAbs(["x", "y", "z"])).ok).toBe(true);
  });

  it("rest 吸收多余实参：(a, ...rest) ⇒ 最小 1", () => {
    const src = fnAbs(["a", "...rest"], [false, true]);
    expect(leqAbs(src, fnAbs(["x"])).ok).toBe(true);
  });

  it("缺省标记时回退名字后缀判据：可选位在**前**也算必选位之后 ⇒ 最小 2", () => {
    expect(leqAbs(fnAbs(["a?", "b"]), fnAbs(["x"])).ok).toBe(false);
    expect(leqAbs(fnAbs(["a?", "b"]), fnAbs(["x", "y"])).ok).toBe(true);
  });

  it("端到端：把 (a = 1, b) 赋给「只需 1 个实参」的 fn ⇒ assign-mismatch（修前：静默）", () => {
    const r = checkSource(
      "/t/bug1129.js",
      `export function outer() {
  let f = (x) => x;
  f = (a = 1, b) => b;
  return f;
}
`,
      pTrue,
      { fromFile: "/t/bug1129.js" },
    );
    expect(r.issues.map((i) => i.code)).toContain("nudo:assign-mismatch");
  });
});
