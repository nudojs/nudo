/**
 * Bug 368 回归：赋值记录通道的 `prev` 可能是**裸宿主值**（不是 Abs）。
 *
 * 机制：env 全局以 `let k = __nudoEnv[k]` 注入，其中**构造器 / 函数型全局**
 * （parseInt / String / Promise / setTimeout …）在 env 里是**裸宿主函数**
 * （不是 Abs）。顶层 `let g = parseInt;` 于是把裸宿主函数存进 g；转译层
 * 插桩把绑定变量的**原始运行时值**当 `prev` 传给 `$assignRecord`
 * ⇒ `structuralAssignIssues` 的 `if (!r.prev) continue` 只挡 undefined/null，
 * 挡不住「真值但不是 Abs」⇒ `r.prev.shape.k` 抛 TypeError
 * ⇒ **整轮 `nudo check` 被腰斩**（排在崩溃文件之后的源文件根本不被检查）。
 *
 * 修法（check-assign.ts / structuralAssignIssues）：读 `.shape` 前先过
 * `isAbsLike` 闸；非 Abs 载荷**无信息可比** ⇒ fail-closed 跳过（不判、不崩）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { structuralAssignIssues } from "../check-assign.ts";
import { abs, type Abs } from "../abs.ts";
import type { AbsAssignRecord } from "../ast-records.ts";
import { val } from "./eval-helpers.ts";

/** 顶层绑定先取 env 全局（裸宿主函数）再被重赋值 —— Bug 368 的触发形态 */
const ENV_GLOBAL_REASSIGN = [
  "let g = parseInt;",
  "g = 1;",
  "export function f() {",
  "  return g;",
  "}",
].join("\n");

/** 排在崩溃文件之后的文件：必须仍然被检查（整轮不被腰斩的证据） */
const AFTER_CRASH = [
  "let n = 1;",
  'n = "str";',
  "export function useN() {",
  "  return n;",
  "}",
].join("\n");

/** 判定层单测用的记录：prev 槽塞裸宿主值（无 shape / conf） */
function recordWithHostPrev(): AbsAssignRecord {
  return {
    name: "g",
    prev: parseInt as unknown as Abs,
    next: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
    line: 2,
  } as AbsAssignRecord;
}

describe("Bug 368：赋值记录 prev 是裸宿主值 ⇒ 判定层不得抛（整轮门禁不得腰斩）", () => {
  it("产品面：顶层 env 全局重赋值 ⇒ checkSource 不抛", () => {
    let report: ReturnType<typeof checkSource> | undefined;
    expect(() => {
      report = checkSource("bug-368-env.js", ENV_GLOBAL_REASSIGN, pTrue, {
        entryThrows: "off",
      });
    }).not.toThrow();
    expect(report).toBeDefined();
    // fail-closed：宿主值无信息可比 ⇒ 不产生 assign-mismatch（但不崩）
    expect(
      (report?.issues ?? []).filter((i) => i.code === "nudo:assign-mismatch"),
    ).toEqual([]);
  });

  it("产品面：其它 env 全局（构造器 / Promise）同样不抛", () => {
    for (const g of ["String", "Number", "Promise", "setTimeout", "isNaN"]) {
      const src = `let g = ${g};\ng = 1;`;
      expect(() => {
        checkSource(`bug-368-${g}.js`, src, pTrue, { entryThrows: "off" });
      }).not.toThrow();
    }
  });

  it("整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断", () => {
    const seen: string[] = [];
    let aborted = false;
    for (const [name, src] of [
      ["a-crash.js", ENV_GLOBAL_REASSIGN],
      ["b-after.js", AFTER_CRASH],
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

  it("判定层：prev 是裸宿主值 ⇒ 不抛、不报（fail-closed）", () => {
    let out: ReturnType<typeof structuralAssignIssues> = [];
    expect(() => {
      out = structuralAssignIssues([recordWithHostPrev()]);
    }).not.toThrow();
    expect(out).toEqual([]);
  });

  it("原生语义未变：重赋值后 g 就是 1", () => {
    const v = val(ENV_GLOBAL_REASSIGN);
    expect(v.ok).toBe(true);
    expect(v.ok ? v.value : undefined).toBe(1);
  });

  it("控制组：Abs↔Abs 的标量改型仍报 nudo:assign-mismatch（守卫未吃掉通道信号）", () => {
    const r = checkSource("bug-368-control.js", AFTER_CRASH, pTrue, {
      entryThrows: "off",
    });
    const mismatch = r.issues.filter((i) => i.code === "nudo:assign-mismatch");
    expect(mismatch.length).toBe(1);
    expect(mismatch[0].severity).toBe("error");
    expect(mismatch[0].message).toBe("n: assignment ⊭ existing shape");
  });
});
