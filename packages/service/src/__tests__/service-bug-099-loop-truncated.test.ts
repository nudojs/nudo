/**
 * BUG-099（loop 面）回归：循环迭代预算截断必须在 **test 面**报**专用码**。
 *
 * 症状（修前）：`nudo check` 对「退出条件恒具体为真」的循环报
 * `nudo:loop-truncated`，而 `nudo test` 只把放宽后的结果（如 `-1024`）
 * 当正常观测打印、零诊断；即使把循环标签按调用截断映射，也会被
 * `label.startsWith("#")` 的兜底静默吞掉（`#loop-iterations` 带 `#` 前缀）。
 *
 * 归因口径（与 core `checkSource` 同）：循环预算**不是**递归、**不是**调用
 * 预算 —— `@nudo:budget calls=/depth=` 抬不动，suggestion 不得指向它。
 *
 * 断言面：
 * 1. 恒具体真的循环 ⇒ 恰好一条 `nudo:loop-truncated`（info），锚在文件起点
 *    （事件不绑函数——collector 只给 `#loop-iterations` 标签，check 面对同一
 *    事件同样不给位置）；
 * 2. 措辞与 check 面同款（iteration budget），且**不**冒充递归截断；
 * 3. 同一次分析内多次求值不重复出诊断；
 * 4. 无循环截断的文件零误报。
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

/** 出口条件恒具体为真（`i` 单调下行、从不可能 ≥ n）⇒ 抽象展开到上限 */
const INFINITE_LOOP = `export function infiniteDec(n) {
  let i = 0;
  while (i < n) { i = i - 1; }
  return i;
}
infiniteDec(5);
`;

/** 无循环 ⇒ 不得出现任何截断诊断 */
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

describe("BUG-099: 循环迭代截断 → analysis 诊断（test 面）", () => {
  it("恒具体真的循环产出 nudo:loop-truncated（info，锚在函数声明处）", async () => {
    const dir = tmpProject("nudo-bug099-loop-");
    const file = join(dir, "loop.js");
    writeFileSync(file, INFINITE_LOOP);

    const result = await analyzeFileAsync(file, INFINITE_LOOP);
    const loops = result.diagnostics.filter((d) => d.code === "nudo:loop-truncated");

    // 一个循环标签 ⇒ 一条诊断（分析内多次求值不重复）
    expect(loops).toHaveLength(1);
    const [d] = loops;
    expect(d!.severity).toBe("info");
    // 锚点：循环截断事件**不绑函数**（collector 只给 `#loop-iterations` 标签，
    // check 面对同一事件也不给位置/函数归因）⇒ 观测面落在文件起点（1 基行 1、列 0），
    // 不假装知道是哪一行循环。
    expect(d!.range.start.line).toBe(1);
    expect(d!.range.start.column).toBe(0);
    // 措辞与 check 面同款；不得冒充递归截断
    expect(d!.message).toContain("iteration budget");
    expect(d!.message).not.toContain("Recursive evaluation");
    // 预算归因：循环迭代上限不受 @nudo:budget 控制 ⇒ suggestion 不得指向它
    expect(d!.suggestions?.join(" ")).not.toContain("@nudo:budget");
    // 其余截断码不得为同一事件冒名顶替
    expect(result.diagnostics.some((x) => x.code === "nudo:recursion-truncated")).toBe(false);
    expect(result.diagnostics.some((x) => x.code === "nudo:fork-truncated")).toBe(false);
  });

  it("无截断文件零误报", async () => {
    const dir = tmpProject("nudo-bug099-loop-clean-");
    const file = join(dir, "plain.js");
    writeFileSync(file, PLAIN);

    const result = await analyzeFileAsync(file, PLAIN);
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).not.toContain("nudo:loop-truncated");
    expect(codes).not.toContain("nudo:recursion-truncated");
  });
});
