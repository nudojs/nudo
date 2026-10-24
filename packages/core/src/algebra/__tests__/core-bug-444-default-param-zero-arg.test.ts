/**
 * Bug 444 —— **默认值形参**的默认值**本身违反自身契约**时，零实参调用
 * **整条跳过执法** ⇒ `nudo check` 0 error / exit 0（引擎自己算出了 `-5`
 * 却不对账 —— 假绿）。
 *
 * 根因：`scan-literal-calls.ts`（薄壳）两处零实参早退
 * （`checkOneCall` / `checkExternalCall` 的 `absArgs.length === 0`）
 * ⇒ 形参位 / 返回位契约**一律不查**；而「默认值本身是否满足契约」
 * 完全可以在分析期静态判定（默认值是源码里的字面量）。
 *
 * 修法（S0）：零实参调用时用**被调函数的默认值形参**补齐实参位
 * （`scan/literal-args.ts` 的 `defaultArgAbss` 从被调函数 AST 的
 * `AssignmentPattern` 取默认值表达式并静态求值）⇒ 补齐后再走原执法链。
 *
 * 边界（刻意保守，fail-closed）：
 * - **只认简单默认值**（`f(x = -5)`）。解构模式的默认值
 *   （`f({ port = 3000 } = {})`）的 right 是**整个模式的对象**（`{}`），
 *   不含内层默认值 ⇒ 拿它去过契约会误报「缺字段 port」⇒ 不填。
 * - 无默认值的形参位补 `absUnknown()` 占位（无信息 ⇒ 不发明义务）。
 * - 取不到默认值 ⇒ 保持修复前行为（整条跳过）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { makeFiles } from "./nudo-constraints.ts";
import { callLit } from "./eval-helpers.ts";

const SIDE = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`;

/** checkSource + 侧车（共享脚手架 makeFiles，不内联副本） */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  const { loadModule } = makeFiles({ "/t/std444.nudo.js": SIDE });
  return checkSource("/t/std444.js", src, pTrue, {
    loadModule,
    fromFile: "/t/std444.js",
    autoBind: true,
  });
}

/** 契约违例（调用点前置条件）诊断 */
function violations(r: {
  issues: { code: string; severity: string; actual?: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && i.severity === "error",
  );
}

describe("Bug 444 —— 零实参调用用默认值补齐实参位再执法", () => {
  it("★ `f(x = -5)` + 契约 x > 0 + 零实参调用 ⇒ 报违例（改前零诊断）", () => {
    const r = check(`
export function f(x = -5) { return x; }
export function g() { return f(); }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("-5");
    expect(vs[0].expected).toContain("x > 0");
  });

  it("★ 顶层零实参调用同样执法（作用域不再决定裁决）", () => {
    const r = check(`
export function f(x = -5) { return x; }
f();
`);
    expect(violations(r).length).toBe(1);
  });

  it("负控制：默认值满足契约（`x = 5`）⇒ 不报违例", () => {
    const r = check(`
export function f(x = 5) { return x; }
export function g() { return f(); }
`);
    expect(violations(r).length).toBe(0);
  });

  it("对照：显式传违约实参 ⇒ 照常报违例（既有路径没被弄坏）", () => {
    const r = check(`
export function f(x = 5) { return x; }
export function g() { return f(-3); }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("-3");
  });

  it("负控制：**无默认值**的形参 + 零实参调用 ⇒ 不发明违例（缺参是另一条缺陷）", () => {
    const r = check(`
export function f(x) { return x; }
export function g() { return f(); }
`);
    expect(violations(r).length).toBe(0);
  });

  it("负控制：解构默认值（`{ port = 3000 } = {}`）⇒ 不发明违例", () => {
    const r = check(`
export function f({ port = 3000 } = {}) { return port; }
export function g() { return f(); }
`);
    expect(violations(r).length).toBe(0);
  });

  it("默认值位对齐：第二个形参有默认值 ⇒ 按形参位补齐（不串位）", () => {
    const r = check(`
export function f(a, x = -5) { return x; }
export function g() { return f(); }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("-5");
  });

  it("引擎自己确实算出了 -5（默认值 Abs 与运行时一致）", () => {
    // 共享脚手架 eval-helpers：零实参调用 ⇒ 运行时取默认值 -5
    const rec = callLit(`export function f(x = -5) { return x; }`, "f");
    expect(rec.result.term?.op).toBe("lit");
    const t = rec.result.term;
    expect(t?.op === "lit" ? t.value : undefined).toBe(-5);
  });
});
