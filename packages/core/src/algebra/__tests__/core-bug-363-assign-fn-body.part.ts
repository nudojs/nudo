// MERGED (topic-related bug pins): core-bug-363-assign-fn-body.test.ts + core-bug-363-assign-pred-fp.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, abs, v, ptypeof } from "../index.ts";
import { structuralAssignIssues } from "../check/check-assign.ts";
import type { AbsAssignRecord } from "../ast-records.ts";

describe("[merged] core-bug-363-assign-fn-body.test.ts", () => {
/**
 * Bug 363 回归：`nudo:assign-mismatch` 必须覆盖**函数体内**的赋值。
 *
 * 机制（Bug 363）：赋值记录收集器（`setEvalAssignCollector`）的**作用域窗口**
 * 只包住**模块顶层求值**；而函数体在 `generalizeFromAst`（check.ts 的函数
 * 循环里）就**早于**收集器安装求过一遍 ⇒ 函数体内的 `$assignRecord` 全部
 * 落空 ⇒ `nudo:assign-mismatch` 只覆盖顶层（真实代码里赋值的主要发生地
 * 恰恰是函数体 ⇒ 假绿）。
 *
 * 修法（check.ts / checkSourceInner）：收集器的安装点**前移到函数循环之前**
 * （窗口 = 函数循环 + 其后的顶层求值段）；窗口扩大带来的「同一赋值点被多次
 * 求值」由 `dedupeAssignRecords`（点位 + prev/next 值）折叠。
 */



/** 函数体内的赋值（真实代码的主要形态） */
const FN_BODY = `export function g() { let n = 1; n = "str"; return n; }`;

/** 模块顶层的赋值（修前唯一被覆盖的面） */
const TOP_LEVEL = ["let n = 1;", 'n = "str";'].join("\n");

/** 顶层赋值 + 函数体赋值（两条都该报，且各一条） */
const MIX = [
  "let n = 1;",
  'n = "str";',
  'export function f() { let m = 1; m = "str"; return m; }',
].join("\n");

/** 顶层赋值 + 一个函数体赋值 + 第二个函数调用第一个（同一赋值点被多次求值） */
const MIX_CALLED = [
  "let n = 1;",
  'n = "str";',
  'export function g() { let m = 1; m = "str"; return m; }',
  "export function h() { return g(); }",
].join("\n");

function assignIssues(src: string, file = "bug-363.js") {
  return checkSource(file, src, pTrue, { entryThrows: "off" }).issues.filter(
    (i) => i.code === "nudo:assign-mismatch",
  );
}

describe("Bug 363：assign-mismatch 必须覆盖函数体内的赋值", () => {
  it("函数体内的标量改型 ⇒ 报 nudo:assign-mismatch（修前 0 条）", () => {
    const issues = assignIssues(FN_BODY);
    expect(issues.length).toBe(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toBe("n: assignment ⊭ existing shape");
    // 位置 = 函数体内那处赋值（第 1 行）
    expect(issues[0]!.line).toBe(1);
  });

  it("函数体内的对象改型 ⇒ 报 nudo:assign-mismatch", () => {
    const issues = assignIssues(
      `export function f() { let a = {x:1}; a = {y:2}; return a; }`,
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("a: assignment ⊭ existing shape");
  });

  it("函数体内改写模块级绑定 ⇒ 报 nudo:assign-mismatch", () => {
    const issues = assignIssues(
      [
        'let config = {host:"localhost",port:8080};',
        'export function f(){ config = {host:"y"}; return config; }',
      ].join("\n"),
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("config: assignment ⊭ existing shape");
  });

  it("控制组：模块顶层赋值仍然报（修前覆盖面不得回退）", () => {
    const issues = assignIssues(TOP_LEVEL);
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("n: assignment ⊭ existing shape");
  });

  it("顶层 + 函数体各报一条（不多不少）", () => {
    const issues = assignIssues(MIX);
    expect(issues.map((i) => i.message).sort()).toEqual([
      "m: assignment ⊭ existing shape",
      "n: assignment ⊭ existing shape",
    ]);
  });

  it("同一赋值点被多次求值 ⇒ 只报一条（窗口扩大不得制造同文双计）", () => {
    const issues = assignIssues(MIX_CALLED);
    expect(issues.map((i) => i.message).sort()).toEqual([
      "m: assignment ⊭ existing shape",
      "n: assignment ⊭ existing shape",
    ]);
  });
});
});

describe("[merged] core-bug-363-assign-pred-fp.test.ts", () => {
/**
 * 族 07 收口片 Z —— `nudo:assign-mismatch` 在**形状兼容**时的假阳性
 * （真实包 `ms@2.1.3`）。
 *
 * 形态（`ms` 的 `parse(str) { str = String(str); … }`，`ms/index.js:49`）：
 *   - 新值 `String(str)`：shape `prim string`、**pred 无信息**；
 *   - 旧值 `str`：shape `prim string`、pred `typeof text = "string"`
 *     ——那是**调用点派生的精化**（`parseAge("2d")` 对**调用方**变量 `text`
 *     的事实），**不是**绑定 `str` 自身的值域约束。
 * 两者**形状相同**⇒ 结构上完全可赋值（运行时 `String(str)` 确实是 string），
 * 但判定走 `leqAbs(next, prev)` ⇒ 还要判 **pred 蕴含** ⇒ 新值没有那条精化
 * ⇒ 判失败 ⇒ 报「assignment ⊭ existing shape」⇒ **真实包 `ms` 假红**
 * （`nudo check docs/examples/retire-real/after/src/age.js` 从 exit 0 变 exit 1）。
 *
 * 修法（core/algebra/check-assign.ts）：assign 通道的义务是**形状级**的
 * （诊断自己的措辞就是「assignment ⊭ **existing shape**」）⇒ 期望侧只取
 * `prev` 的**形状**（`shapeOnly`），`prev.pred` 不参与。
 *
 * 两侧都守住：
 * - 形状兼容 + 旧值带**调用点派生 pred** ⇒ **不**报；
 * - 形状改型（标量改型 / 元素改型）与缺槽 ⇒ **仍**报
 *   （金标 assign-prim-mismatch-violates / assign-missing-slot-violates）。
 *
 * 反向闸：本钉在「族 07 接线前」的基线上必须红（函数体内的赋值面是
 * Bug 363 的产品承诺，钉住它 ⇒ 覆盖面被回退时也会红）。
 */





/** 旧值：shape `prim string` + 调用点派生的 pred（关于调用方变量 `text`） */
const prevWithCallSitePred = abs(
  { k: "prim", type: "string" },
  v("text"),
  ptypeof(v("text"), "string"),
  "path",
);

/** 新值：`String(str)` 的结果 —— shape `prim string`、无 pred */
const nextPlainString = abs({ k: "prim", type: "string" }, undefined, undefined, "path");

function record(prev: AbsAssignRecord["prev"], next: AbsAssignRecord["next"]): AbsAssignRecord {
  return { name: "str", prev, next, line: 49 };
}

const assignIssues = (src: string, file: string) =>
  checkSource(file, src, pTrue, { entryThrows: "off" }).issues.filter(
    (i) => i.code === "nudo:assign-mismatch",
  );

describe("族 07 收口片 Z：形状兼容的赋值不得报 nudo:assign-mismatch（ms 假阳性）", () => {
  it("判定层：形状兼容 + 旧值带调用点派生 pred ⇒ 不报（修前 1 条）", () => {
    const out = structuralAssignIssues([record(prevWithCallSitePred, nextPlainString)]);
    expect(out).toEqual([]);
  });

  it("判定层控制组：形状改型（string → number）⇒ 仍报", () => {
    const out = structuralAssignIssues([
      record(prevWithCallSitePred, abs({ k: "prim", type: "number" }, undefined, undefined, "path")),
    ]);
    expect(out.length).toBe(1);
    expect(out[0]!.message).toBe("str: assignment ⊭ existing shape");
    expect(out[0]!.severity).toBe("error");
  });

  it("产品面：标量改型（let n = 1; n = \"str\"）⇒ 仍报（金标 assign-prim-mismatch）", () => {
    const issues = assignIssues('let n = 1;\nn = "str";', "prim.js");
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("n: assignment ⊭ existing shape");
  });

  it("产品面：缺槽（let a = {x:1}; a = {y:2}）⇒ 仍报", () => {
    const issues = assignIssues("let a = {x:1};\na = {y:2};", "slot.js");
    expect(issues.length).toBe(1);
    expect(issues[0]!.suggestion).toBe("missing slot x");
  });

  it("控制组：函数体内的赋值面仍被覆盖（族 07 Bug 363 的覆盖面不得回退）", () => {
    const issues = assignIssues(
      'export function g() { let n = 1; n = "str"; return n; }',
      "fn-body.js",
    );
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toBe("n: assignment ⊭ existing shape");
  });
});
});
