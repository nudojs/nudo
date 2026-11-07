/**
 * BUG-022 回归：被调方的**调用点域**不得被「首次 settle」截断。
 *
 * 症状（修前）：同一组函数，只改**声明顺序**就得到不同的调用点域 ——
 * 被调方先定义时只留下第一个调用方的调用点（`callee(2)` / `callee(3)` 被
 * 静默丢弃），于是 `nudo test` 少报见证、`nudo contract --emit` 写出偏窄的
 * 契约（合法调用被判违约），`nudo contract --draft` 沿「官方推荐路径」直接
 * 产出假红。
 *
 * 根因：`settleEntryOnlyCandidates()` 在**首次命中证据**时就把候选移出注册表
 * ⇒ 域 = 「第一次结算时已知的记录前缀」，与文件里的声明顺序强相关。被调方
 * 先被处理（还没有调用点证据）⇒ 回落 entry@；随后每个调用方处理完才补进
 * 记录，但注册表里已经没有该候选了。
 *
 * 修法：候选**保留**在注册表里，每轮结算用**当前全部**记录重合成（新增记录
 * 才重算），直到分析结束。
 *
 * 断言面（顺序无关性 = 语义等价代码应得等价结论）：
 * 1. 两种声明顺序下被调方的调用点见证数、实参域、结果域**完全一致**；
 * 2. `combinedAbs`（导出面 / dts / 契约用到的推断域）一致；
 * 3. `nudo:interface-entry-only` 不再误报被调方（它已有了调用点域）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  formatShape,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
} from "@nudojs/core";
import { resetAbsCallBudget } from "@nudojs/core/internal";
import { analyzeFileAsync } from "@nudojs/service";
import { clearEvalCache } from "../eval-run.ts";
import { clearAbsModuleCache } from "../abs-modules-graph.ts";
import { tmpProject } from "./tmp-project.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  clearEvalCache();
  clearAbsModuleCache();
});

/** 被调方**先**定义（修前：域被截断成 1 条） */
const CALLEE_FIRST = `export function callee(a) {
  return a + 1;
}
export function caller1() {
  return callee(1);
}
export function caller2() {
  return callee(2);
}
export function caller3() {
  return callee(3);
}
`;

/** 同一组函数，被调方**后**定义（修前的正确形态，作为对照） */
const CALLEE_LAST = `export function caller1() {
  return callee(1);
}
export function caller2() {
  return callee(2);
}
export function caller3() {
  return callee(3);
}
export function callee(a) {
  return a + 1;
}
`;

async function analyze(source: string) {
  const dir = tmpProject("nudo-b022-");
  const file = join(dir, "m.js");
  writeFileSync(file, source, "utf-8");
  return analyzeFileAsync(file, source, undefined, undefined, undefined, "all");
}

/** 调用点见证的（实参域, 结果域）集合——见证名带行号，顺序无关比较用值 */
function callsiteDomain(
  result: Awaited<ReturnType<typeof analyze>>,
  fnName: string,
): { args: string[]; rets: string[] } {
  const fn = result.functions.find((f) => f.name === fnName);
  expect(fn, `${fnName} 必须被分析到`).toBeDefined();
  const calls = fn!.cases.filter((c) => c.source === "callsite");
  return {
    args: calls.map((c) => c.argAbs.map((a) => formatShape(a)).join(",")).sort(),
    rets: calls.map((c) => formatShape(c.abs)).sort(),
  };
}

describe("BUG-022 · 调用点域与声明顺序无关", () => {
  it("被调方先定义：三个调用点全部留证（不再只剩第一条）", async () => {
    const r = await analyze(CALLEE_FIRST);
    const { args, rets } = callsiteDomain(r, "callee");
    expect(args).toEqual(["1", "2", "3"]);
    expect(rets).toEqual(["2", "3", "4"]);
  });

  it("两种声明顺序的调用点域与 combinedAbs 完全一致", async () => {
    const first = await analyze(CALLEE_FIRST);
    const last = await analyze(CALLEE_LAST);

    expect(callsiteDomain(first, "callee")).toEqual(callsiteDomain(last, "callee"));

    const combined = (r: Awaited<ReturnType<typeof analyze>>) => {
      const fn = r.functions.find((f) => f.name === "callee")!;
      expect(fn.combinedAbs).toBeDefined();
      return formatShape(fn.combinedAbs!);
    };
    expect(combined(first)).toBe(combined(last));
    expect(combined(first)).toBe("2 | 3 | 4");
  });

  it("有调用点域的被调方不再误报 nudo:interface-entry-only", async () => {
    const r = await analyze(CALLEE_FIRST);
    const calleeEntryOnly = r.diagnostics.filter(
      (d) => d.code === "nudo:interface-entry-only" && d.message.includes("'callee'"),
    );
    expect(calleeEntryOnly).toEqual([]);
    // 负控制：真的没有调用点的导出函数仍如实报 entry-only（不静默）
    const caller1EntryOnly = r.diagnostics.filter(
      (d) => d.code === "nudo:interface-entry-only" && d.message.includes("'caller1'"),
    );
    expect(caller1EntryOnly).toHaveLength(1);
  });
});
