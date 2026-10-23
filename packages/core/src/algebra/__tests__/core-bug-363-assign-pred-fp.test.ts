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
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, abs, v, ptypeof } from "../index.ts";
import { structuralAssignIssues } from "../check-assign.ts";
import type { AbsAssignRecord } from "../ast-records.ts";

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
