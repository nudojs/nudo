/**
 * BUG-099 回归：引擎「放弃求值」必须在 **test 面可观测**。
 *
 * 症状（修前）：同一份递归源码，`nudo check` / `nudo health` 都报「求值被
 * 截断」，而 `nudo test`（人类面 + `--json`）**零诊断** —— 把放宽后的类型
 * （`0 | number | string`）当一次正常观测打印，断言段还报「0 failed」全绿。
 * 三个面对同一件事给出互斥结论；`nudo test --freeze` 还会把「引擎放弃」
 * 永久固化成 `@nudo:case` 事实。
 *
 * 根因：截断观测在 service 侧只被收进一个局部集合就地丢弃（从未映射成
 * 诊断），而 `nudo:recursion-truncated` 全仓唯一产地是 core 的 `checkSource`；
 * `nudo test` 从不调用它。文档承诺（website/docs/guides/performance.md）：
 * 「truncation never degrades results silently」。
 *
 * 修法：analysis 作用域安装截断 collector（`eval-run` 的嵌套 collector 改为
 * **链式转发**，否则单槽 collector 会把分析层的观察面静默掐断），结束时把
 * 事件映射成与 check 面**同码 / 同级 / 同措辞**的诊断。
 *
 * 断言面：
 * 1. 递归截断产出 `nudo:recursion-truncated`（severity info），锚在被求值
 *    函数声明处（1 基行号）；
 * 2. 归因措辞与 core check 一致（cycle ⇒ 明说抬预算无效）；
 * 3. 同一事件多次求值不重复出诊断（Map 按 label 去重）；
 * 4. 无截断的文件零误报（collector 是全局单槽，装错就全仓噪声）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
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

/** 自递归：抽象实参 `n - 1` 仍落在 `number` ⇒ 同指纹已在栈上（cycle 归因） */
const SELF_RECURSION = `export function loop(n) {
  if (n <= 0) return 0;
  return loop(n - 1) + 1;
}
`;

/** 无递归、无预算压力 ⇒ 不得出现任何截断诊断 */
const PLAIN = `export function add(a, b) {
  return a + b;
}
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  clearEvalCache();
  clearAbsModuleCache();
});

describe("BUG-099: 截断观测 → analysis 诊断（test 面）", () => {
  it("自递归截断产出 nudo:recursion-truncated（info，锚在函数声明处）", async () => {
    const dir = tmpProject("nudo-bug099-");
    const file = join(dir, "self.js");
    writeFileSync(file, SELF_RECURSION);

    const result = await analyzeFileAsync(file, SELF_RECURSION);
    const trunc = result.diagnostics.filter((d) => d.code === "nudo:recursion-truncated");

    // 一次事件 ⇒ 一条诊断（分析内多次求值不得重复出诊断）
    expect(trunc).toHaveLength(1);
    const [d] = trunc;
    expect(d!.severity).toBe("info");
    // 锚点：函数名起始（1 基行号，0 列不是合法列是另一回事；行号必须 ≥ 1）
    expect(d!.range.start.line).toBe(1);
    expect(d!.range.start.column).toBe(7);
    expect(d!.message).toContain("Recursive evaluation of 'loop'");
    // 归因措辞与 core check 面一致：cycle 不是预算，抬 @nudo:budget 无效
    expect(d!.message).toContain("(cycle — budget cannot lift this)");
    expect(d!.suggestions?.join(" ")).toContain("raising @nudo:budget will not change this");
    // 不得冒充 fork 预算
    expect(result.diagnostics.some((x) => x.code === "nudo:fork-truncated")).toBe(false);
  });

  it("无截断文件零误报", async () => {
    const dir = tmpProject("nudo-bug099-clean-");
    const file = join(dir, "plain.js");
    writeFileSync(file, PLAIN);

    const result = await analyzeFileAsync(file, PLAIN);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).not.toContain("nudo:recursion-truncated");
    expect(codes).not.toContain("nudo:fork-truncated");
  });
});
