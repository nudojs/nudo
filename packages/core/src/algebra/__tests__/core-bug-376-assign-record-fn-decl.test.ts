/**
 * Bug 376 回归：赋值右侧是**函数声明**时，记录里的 `next` 是**宿主函数值**
 * （不是 Abs）⇒ `r.next.shape.k` 抛 TypeError ⇒ `nudo check` 整轮崩溃
 * （零诊断、exit 1）。
 *
 * 机制：转译后的函数声明在运行时是普通宿主函数对象（`typeof h === "function"`，
 * 但**不是 Abs**）⇒ 赋值记录把宿主原生函数塞进 `next`
 * ⇒ 判定层直接读 `r.next.shape.k` ⇒ 抛。
 * 函数表达式 / 箭头常量在引擎里是 **Abs fn** ⇒ 不崩 ⇒ **同一个语言构造两种结果**。
 *
 * 修法（check-assign.ts / structuralAssignIssues）：读 `.shape` 前先过
 * `isAbsLike` 闸；非 Abs 载荷**无信息可比** ⇒ fail-closed 跳过（不判、不崩）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { structuralAssignIssues } from "../check-assign.ts";
import { abs, litValue, type Abs } from "../abs.ts";
import type { AbsAssignRecord } from "../ast-records.ts";
import { call } from "./eval-helpers.ts";

/** 赋值右侧是函数声明 —— Bug 376 的触发形态 */
const FN_DECL_RHS = [
  "function h(x = 1) {",
  "  return x;",
  "}",
  "let f = () => 2;",
  "f = h;",
  "export function z() {",
  "  return f();",
  "}",
].join("\n");

/** 函数表达式：引擎里是 Abs fn ⇒ 走正常判定面（控制组） */
const FN_EXPR_RHS = [
  "let f = () => 2;",
  "f = function (x) {};",
  "export function z() {",
  "  return f();",
  "}",
].join("\n");

/** 判定层单测用的记录：next 槽塞裸宿主函数（无 shape / conf） */
function recordWithHostNext(): AbsAssignRecord {
  const hostFn = function h(x = 1) {
    return x;
  };
  return {
    name: "f",
    prev: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
    next: hostFn as unknown as Abs,
    line: 5,
  } as AbsAssignRecord;
}

describe("Bug 376：赋值右侧是函数声明 ⇒ 判定层不得抛（整轮门禁不得腰斩）", () => {
  it("产品面：函数声明作右侧 ⇒ checkSource 不抛", () => {
    let report: ReturnType<typeof checkSource> | undefined;
    expect(() => {
      report = checkSource("bug-376-fn-decl.js", FN_DECL_RHS, pTrue, {
        entryThrows: "off",
      });
    }).not.toThrow();
    expect(report).toBeDefined();
    // fail-closed：宿主函数无信息可比 ⇒ 不产生 assign-mismatch（但不崩）
    expect(
      (report?.issues ?? []).filter((i) => i.code === "nudo:assign-mismatch"),
    ).toEqual([]);
  });

  it("整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断", () => {
    const seen: string[] = [];
    let aborted = false;
    for (const [name, src] of [
      ["a-crash.js", FN_DECL_RHS],
      ["b-after.js", 'let m = 1;\nm = "str";\nexport function useM() { return m; }'],
    ] as const) {
      if (aborted) {
        seen.push(`${name}:NOT-CHECKED`);
        continue;
      }
      try {
        const r = checkSource(name, src, pTrue, { entryThrows: "off" });
        seen.push(`${name}:CHECKED:${r.issues.map((i) => i.code).join(",")}`);
      } catch {
        aborted = true;
        seen.push(`${name}:THREW`);
      }
    }
    expect(seen[0]).toMatch(/^a-crash\.js:CHECKED:/);
    expect(seen[1]).toBe("b-after.js:CHECKED:nudo:assign-mismatch");
  });

  it("判定层：next 是裸宿主函数 ⇒ 不抛、不报（fail-closed）", () => {
    let out: ReturnType<typeof structuralAssignIssues> = [];
    expect(() => {
      out = structuralAssignIssues([recordWithHostNext()]);
    }).not.toThrow();
    expect(out).toEqual([]);
  });

  it("原生语义未变：f 变成 h 之后 f() 取 h 的默认形参值", () => {
    const rec = call(FN_DECL_RHS, "z");
    const v = litValue(rec.result);
    expect(v.ok).toBe(true);
    expect(v.ok ? v.value : undefined).toBe(1);
  });

  it("控制组：函数表达式作右侧仍报 nudo:assign-mismatch（守卫未吃掉通道信号）", () => {
    const r = checkSource("bug-376-control.js", FN_EXPR_RHS, pTrue, {
      entryThrows: "off",
    });
    const mismatch = r.issues.filter((i) => i.code === "nudo:assign-mismatch");
    expect(mismatch.length).toBe(1);
    expect(mismatch[0].severity).toBe("error");
    expect(mismatch[0].message).toBe("f: assignment ⊭ existing shape");
  });
});
