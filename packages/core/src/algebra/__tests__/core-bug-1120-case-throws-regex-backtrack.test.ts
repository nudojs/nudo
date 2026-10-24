/**
 * Bug 1120 回归 —— case 行尾 `!! throws` 后缀正则**二次回溯**（性能 / DoS）。
 *
 * 根因（directive-scan.ts，`CASE_THROWS_SUFFIX_TAIL_RE`）：
 *   旧式 `/!!\s*throws(?:\s+[A-Za-z*][\w*|,\s]*)?\s*$/i` 里，kind 组
 *   `[\w*|,\s]*` **含空白**，其后又有结尾 `\s*$` ⇒ 同一段空白有**多种切分**
 *   ⇒ 回溯**二次方**（实测：5 万空格 ≈ 1.7s；10 万空格 ≈ 6.7s）⇒ 一条
 *   注释就能把 CI / `nudo check` 打爆（DoS）。
 *
 * 修法：kind 改成**无歧义**切分 —— token 内**不含空白**
 * （`[A-Za-z*][\w*|,]*`），空白只能落在 token **之间**（`token (空白 token)*`）
 *   ⇒ 空白切分**唯一** ⇒ 线性。
 *
 * ⚠ 语义**不变**：kind 组只用于**剥掉**后缀（组内容被丢弃）⇒ 剥除结果与
 *   旧式逐字一致（本断言逐字校验）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { scanCaseTags } from "../directive-scan.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 缓存重置（仓库惯例） */
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

/** 预算：修后线性（实测 ≈ 0ms）⇒ 给足余量仍远低于旧式的二次方耗时 */
const BUDGET_MS = 2000;

describe("Bug 1120 — case 行尾 `!! throws` 正则不再二次回溯", () => {
  it("后缀不在行尾（尾部有其它字符）⇒ 不剥除，且耗时线性", () => {
    const n = 100000;
    const src = '@nudo:case "x" (0) => 1 !! throws T' + " ".repeat(n) + "!";
    const t0 = performance.now();
    const tags = scanCaseTags(src);
    const elapsed = performance.now() - t0;
    expect(tags).toHaveLength(1);
    // 语义不变：后缀不在行尾 ⇒ 期望文本原样保留
    expect(tags[0]!.expectedText).toBe(`1 !! throws T${" ".repeat(n)}!`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("后缀在行尾（后接大段空白）⇒ 照常剥除，且耗时线性", () => {
    const n = 100000;
    const src = '@nudo:case "x" (0) => 1 !! throws TypeError' + " ".repeat(n);
    const t0 = performance.now();
    const tags = scanCaseTags(src);
    const elapsed = performance.now() - t0;
    expect(tags).toHaveLength(1);
    expect(tags[0]!.expectedText).toBe("1");
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("语义护栏：普通形态的剥除结果与旧式一致", () => {
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws TypeError')[0]!.expectedText).toBe("1");
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws')[0]!.expectedText).toBe("1");
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws Error, TypeError')[0]!.expectedText).toBe("1");
    expect(scanCaseTags('@nudo:case "x" (0) => 1 !! throws Error RangeError')[0]!.expectedText).toBe("1");
    // 非后缀文本不动
    expect(scanCaseTags('@nudo:case "x" (0) => 1')[0]!.expectedText).toBe("1");
  });
});
