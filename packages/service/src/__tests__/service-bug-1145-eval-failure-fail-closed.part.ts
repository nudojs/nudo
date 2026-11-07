/**
 * Bug 1145 回归：**模块级求值失败**（闸门无法裁决该文件的回落）必须被**按文件**
 * 观测到——否则闸门看不到任何入口 ⇒ 零诊断 + exit 0（**假绿**：合法代码与
 * 违约代码都判绿）。
 *
 * 病灶：core 的回落计数是**进程级**的（`getEvalFallbackStats()`）⇒ 无法定位
 * 到文件 ⇒ 分析编排层没有「本文件求值失败」的信号 ⇒ 门禁无从 fail-closed。
 *
 * 修法（service 观测面）：`analyzeFileWithEvalFailures` 为**每个文件**装一个
 * 回落 collector，把该文件分析期间的回落按文件收集起来。
 *
 * **标签 ≠ 可见性**（BUG-073 之后的两维口径）：core 的回落事件带两个维度——
 * 标签 `reason`（谁的责任：`unsupported:*` 能力边界 / `module-throw` 程序
 * 自身抛 / `internal` 引擎缺陷）与可见性 `gateFatal`（闸门能不能裁决该文件）。
 * 失败信号按**可见性**收（`internal` 恒进；`module-throw` 仅装载期逃逸进；
 * `unsupported:*` 不进）。
 *
 * 断言面：
 * 1. 模块级求值失败（装载期逃逸）⇒ 观测面**看见**该文件的回落
 *    （reason=module-throw，file=被分析文件）——这是闸门 fail-closed 的
 *    信号源（**标签**随 BUG-073 改为 module-throw：**可见性**不变）；
 * 2. **假红防线**：`unsupported:*`（能力边界）回落 **不**进失败信号；
 * 3. **假红防线**：**建模内抛**（NudoThrow ⇒ 引擎知道程序在抛 ⇒ 归
 *    `nudo:module-throw` 通道）**不**进失败信号；
 * 4. 干净文件 ⇒ 零回落（不得凭空造失败）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
  resetSidecarLoadFailureCache,
  takeInterfaceDiags,
  takeRefineDiags,
} from "@nudojs/core";
import { resetAbsCallBudget, resetEvalForkBudget } from "@nudojs/core/internal";
import { analyzeFileWithEvalFailures } from "../analyzer-orchestrate.ts";
import { tmpProject } from "./tmp-project.ts";

/**
 * 模块级求值**必然失败**的源：模块顶层调用未定义的值 ⇒ 宿主运行时抛原生
 * TypeError ⇒ core 记一条 `internal` 回落 ⇒ 该模块全部导出丢失。
 * （不依赖任何具体 bug 编号：只依赖「模块顶层求值抛错 ⇒ internal 回落」这条
 * 引擎契约。）
 */
const MODULE_EVAL_FAILS = `export const boom = undefined();

export function add(a, b) {
  return a + b;
}
`;

/** 能力边界回落（`unsupported:*`）：TS namespace 不 lowering ⇒ 回落但**不是**引擎缺陷。 */
const UNSUPPORTED_ONLY = `export namespace N {
  export const a = 1;
}

export function add(a, b) {
  return a + b;
}
`;

/** 程序自身抛（`module-throw`）：catch 可吸收 ⇒ 既有口径**不是**闸门失败。 */
const MODULE_THROWS = `export const boom = null.missing;

export function add(a, b) {
  return a + b;
}
`;

/** 干净文件：零回落。 */
const CLEAN = `export function add(a, b) {
  return a + b;
}
`;

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

describe("1145 · service 观测面：模块级求值失败按文件可见", () => {
  it("模块级求值失败 ⇒ 观测面看见该文件的 module-throw 回落（装载期逃逸）", () => {
    const dir = tmpProject("nudo-1145-fail-");
    const file = `${dir}/boom.js`;
    const { evalFailures } = analyzeFileWithEvalFailures(file, MODULE_EVAL_FAILS);
    expect(evalFailures.length).toBeGreaterThan(0);
    // **重钉（BUG-073 §修复方向：用户代码抛出的原生异常归 `module-throw`，
    // 不再算引擎缺陷；BUG-072 §修复方向：「模块未分析 ⇒ 不得给绿灯」）**：
    // 模块体里的原生异常（这里 `undefined()` ⇒ TypeError）是**用户代码自身
    // 抛**，标签由 `internal` 改为 `module-throw`（不是引擎缺陷 ⇒ 不该报
    // 「engine bug」）。
    // **可见性不变**（1145 / BUG-072 的契约）：装载期逃逸 ⇒ 该模块装载失败
    // （导出全丢）⇒ 闸门无法裁决该文件 ⇒ 仍进失败信号（fail-closed）。
    expect(evalFailures.every((f) => f.reason === "module-throw")).toBe(true);
    // 失败信号必须**能定位到文件**
    expect(evalFailures.every((f) => f.file === file)).toBe(true);
    expect(evalFailures[0]!.message.length).toBeGreaterThan(0);
  });

  it("假红防线：unsupported:* 回落**不**进失败信号", () => {
    const dir = tmpProject("nudo-1145-unsupported-");
    const file = `${dir}/unsupported.js`;
    const { evalFailures } = analyzeFileWithEvalFailures(file, UNSUPPORTED_ONLY);
    expect(evalFailures).toEqual([]);
  });

  it("假红防线：module-throw（程序自身抛）**不**进失败信号", () => {
    const dir = tmpProject("nudo-1145-throw-");
    const file = `${dir}/throw.js`;
    const { evalFailures } = analyzeFileWithEvalFailures(file, MODULE_THROWS);
    expect(evalFailures).toEqual([]);
  });

  it("干净文件 ⇒ 零回落（不得凭空造失败）", () => {
    const dir = tmpProject("nudo-1145-clean-");
    const file = `${dir}/clean.js`;
    const { analysis, evalFailures } = analyzeFileWithEvalFailures(file, CLEAN);
    expect(evalFailures).toEqual([]);
    expect(analysis.functions.map((f) => f.name)).toContain("add");
  });
});
