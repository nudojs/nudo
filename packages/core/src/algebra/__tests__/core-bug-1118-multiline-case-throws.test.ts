/**
 * Bug 1118 回归 —— **多行** `@nudo:case … !! throws` 声明**丢失** ⇒ 闸门**假红**。
 *
 * 缺陷（假红）：
 *   `scanThrowsDecl` 的同行后缀正则要求 case 的两个括号**在同一行**
 *   （`\([^\n]*\)`），续行口径又要求**前一行**以 `@nudo:case` 开头 ⇒
 *   ```
 *   @nudo:case "neg" (
 *   0
 *   ) !! throws TypeError
 *   ```
 *   的申报**整条丢失** ⇒ `extractDeclaredThrows` 消费不到 ⇒ 用户**已申报**
 *   仍被 `nudo:entry-may-throw`（error 级）卡住 ⇒ CI 闸门**假红**。
 *
 * 修法（directive-scan.ts）：**先在完整注释文本里找到 case 实参的平衡终点**
 * （`extractBalancedParens`），**再**识别后缀 —— 不再靠「单行同括号」或
 * 「上一行是 case 行」推断；单行写法行为**逐字不变**。
 *
 * ⚠ 位置锚（Bug 1033）**不放宽**：散文行、case **名字**内部的同形文本、
 * `=> 1 !! throws`（后缀落在期望表达式一侧）仍然**不产申报**。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { scanThrowsDecl } from "../directive-scan.ts";
import { extractDeclaredThrows } from "../refine.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 缓存重置（仓库惯例）：同名文件跑不同源码 ⇒ 模块执行缓存 / memo 会串台 */
beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
});

/** 多行 case 声明（实参跨行 ⇒ 旧口径读不到后缀） */
const MULTILINE_CASE = `/**
 * @nudo:case "neg" (
 * 0
 * ) !! throws TypeError
 */
export function boom(n) {
  if (n < 0) throw new TypeError("n");
  return n;
}
`;

/** 同一函数，**不写**声明 ⇒ 闸门必须执法（对照组：证明断言不空转） */
const NO_DECL = `export function boom(n) {
  if (n < 0) throw new TypeError("n");
  return n;
}
`;

const l2 = (src: string, file: string): number =>
  checkSource(file, src, pTrue, {}).issues.filter((i) => i.code === "nudo:entry-may-throw")
    .length;

describe("Bug 1118 — 多行 `@nudo:case … !! throws` 声明不再丢失", () => {
  it("扫描层：多行实参的 case 后缀产出申报（修前：undefined）", () => {
    expect(
      scanThrowsDecl(['@nudo:case "neg" (', "0", ") !! throws TypeError"]),
    ).toBe("TypeError");
    // 无 kind ⇒ 任意 throw（`*`）
    expect(scanThrowsDecl(['@nudo:case "neg" (', "0", ") !! throws"])).toBe("*");
  });

  it("消费层：extractDeclaredThrows 消费得到多行形态的申报", () => {
    expect(extractDeclaredThrows(MULTILINE_CASE, "boom")).toEqual(["TypeError"]);
  });

  it("闸门层：已申报 ⇒ 不再假红（无声明 ⇒ 照常执法，对照组）", () => {
    expect(l2(MULTILINE_CASE, "/t/bug-1118-declared.js")).toBe(0);
    expect(l2(NO_DECL, "/t/bug-1118-undeclared.js")).toBe(1);
  });

  it("闸门层：多行形态 + 续行形态（`)` 行之后的下一行）都放行", () => {
    const cont = `/**
 * @nudo:case "neg" (
 * 0
 * )
 * !! throws TypeError
 */
export function boom(n) {
  if (n < 0) throw new TypeError("n");
  return n;
}
`;
    expect(extractDeclaredThrows(cont, "boom")).toEqual(["TypeError"]);
    expect(l2(cont, "/t/bug-1118-cont.js")).toBe(0);
  });

  it("护栏：单行写法行为逐字不变（`*` / kind / 续行）", () => {
    expect(scanThrowsDecl(['@nudo:case "neg" (0) !! throws'])).toBe("*");
    expect(scanThrowsDecl(['@nudo:case "neg" (0) !! throws Error'])).toBe("Error");
    expect(scanThrowsDecl(['@nudo:case "neg" (0)', "!! throws Error"])).toBe("Error");
  });

  it("护栏：位置锚不放宽（Bug 1033 口径）——散文 / case 名内部 / 期望侧都不产申报", () => {
    expect(scanThrowsDecl(["Note: this helper uses !! throws"])).toBeUndefined();
    expect(scanThrowsDecl(['@nudo:case "regression: !! throws" (1)'])).toBeUndefined();
    // `=> 1 !! throws`：后缀落在期望表达式一侧 ⇒ 不是指令位置
    expect(scanThrowsDecl(['@nudo:case "b" (0) => 1 !! throws'])).toBeUndefined();
    // 多行写法同样不放宽：散文行 / case 名内部的同形文本
    expect(
      scanThrowsDecl(['@nudo:case "regression: !! throws" (', "1", ")"]),
    ).toBeUndefined();
    expect(
      scanThrowsDecl(["@nudo:case \"neg\" (", "0", ")", "Note: this helper uses !! throws"]),
    ).toBeUndefined();
  });
});
