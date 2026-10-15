/**
 * issue #158：调用截断归因（cycle ≠ 预算）+ check --json budget 块 B 路径可观测。
 * - cycle（同 name+arg 指纹已在栈上）：文案/suggestion/action 不得指向抬预算
 * - depth / calls：真预算——@nudo:budget 可抬，指明可抬的维
 * - stats：B 命名调用截断必须进 truncated/evalCallTruncated/reasons——
 *   `truncated:false` 与 nudo:recursion-truncated 不得共存
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  checkSource,
  pTrue,
  serializeCheckJson,
  serializeCheckJsonMulti,
  formatCheckReport,
  actionsForIssue,
  runTranspiled,
  callTranspiledExportFull,
  resetEvalCallBudget,
  $lit,
} from "@nudojs/core";
import {
  setAbsTruncationCollector,
  resetAbsCallBudget,
  enterCall,
  exitCall,
  withFnBudgetOverride,
  withEvalBudgetOverride,
  getAbsCallBudgetStats,
} from "@nudojs/core/internal";

afterEach(() => {
  resetAbsCallBudget();
  resetEvalCallBudget();
  setAbsTruncationCollector(null);
});

describe("#158 A enterCall 归因：cycle 先于 depth/calls", () => {
  it("同 key 二次进入报 cycle；超深度报 depth；超总量报 calls", () => {
    const seen: Array<{ label: string; reason?: string }> = [];
    setAbsTruncationCollector((label, reason) => seen.push({ label, reason }));
    resetAbsCallBudget();

    // cycle：同 key 二次进入（深度/总调用都远未超限）
    expect(enterCall("k|f|x", "f")).toBe(true);
    expect(enterCall("k|f|x", "f")).toBe(false);
    expect(seen.at(-1)).toEqual({ label: "f", reason: "cycle" });
    exitCall();

    // depth：不同 key，深度 1 封顶
    withFnBudgetOverride({ depth: 1 }, () => {
      expect(enterCall("k|g|a", "g")).toBe(true);
      expect(enterCall("k|g|b", "h")).toBe(false);
      expect(seen.at(-1)).toEqual({ label: "h", reason: "depth" });
      exitCall();
    });

    // calls：总调用 1 封顶（前面已计入 ≥2 次成功进入）
    withFnBudgetOverride({ calls: 1, depth: 64 }, () => {
      expect(enterCall("k|i|1", "i")).toBe(false);
      expect(seen.at(-1)).toEqual({ label: "i", reason: "calls" });
    });

    const stats = getAbsCallBudgetStats();
    expect(stats.reasons).toContain("cycle");
    expect(stats.reasons).toContain("depth");
    expect(stats.reasons).toContain("calls");
    expect(stats.cycleTruncated).toBe(true);
    expect(stats.callTruncated).toBe(true);
    expect(stats.truncated).toBe(true);
  });
});

describe("#158 B evalEnterCall 归因", () => {
  it("同抽象实参自递归 → cycle（collector 带原因，stats 不再自相矛盾）", () => {
    const seen: Array<{ label: string; reason?: string }> = [];
    setAbsTruncationCollector((label, reason) => seen.push({ label, reason }));
    resetAbsCallBudget();
    resetEvalCallBudget();

    const src = `export function sameArgs(x) { sameArgs(x); return x; }`;
    const run = runTranspiled(src, { mode: "analyze" });
    // 返回值是形参本身（不依赖被截断的内层调用），外层帧 conf 可以仍是
    // exact——截断事实以 collector / stats 为准
    callTranspiledExportFull(run, "sameArgs", [$lit(1)] as never[]);
    expect(seen.some((s) => s.label === "sameArgs" && s.reason === "cycle")).toBe(true);

    const stats = getAbsCallBudgetStats();
    expect(stats.evalCallTruncated).toBe(true);
    expect(stats.cycleTruncated).toBe(true);
    // #158 核心：B 截断必须让 truncated=true（旧口径此处恒 false）
    expect(stats.truncated).toBe(true);
    expect(stats.reasons).toContain("cycle");
    expect(stats.evalCalls).toBeGreaterThan(0);
    expect(stats.evalCalls).toBeLessThanOrEqual(stats.maxEvalCalls);
  });

  it("实参逐层变化 + 深度封顶 → depth（@nudo:budget 可抬）", () => {
    const seen: Array<{ label: string; reason?: string }> = [];
    setAbsTruncationCollector((label, reason) => seen.push({ label, reason }));
    resetAbsCallBudget();
    resetEvalCallBudget();

    const src = `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }`;
    const run = runTranspiled(src, { mode: "analyze" });
    withEvalBudgetOverride({ depth: 1 }, () => {
      const r = callTranspiledExportFull(run, "down", [$lit(3)] as never[]);
      expect(r.result.conf).toBe("opaque");
    });
    expect(seen.some((s) => s.label === "down" && s.reason === "depth")).toBe(true);
    expect(getAbsCallBudgetStats().reasons).toContain("depth");
  });
});

describe("#158 check 面：归因文案 + budget 块自洽", () => {
  const CYC_SRC = `export function sameArgs(x) { sameArgs(x); return x; }\n`;

  it("sameArgs 报 call cycle（不再是 depth/size budget），budget.truncated=true", () => {
    const r = checkSource("/t/cyc158.js", CYC_SRC, pTrue);
    const issue = r.issues.find((i) => i.code === "nudo:recursion-truncated");
    expect(issue).toBeDefined();
    expect(issue!.reason).toBe("cycle");
    expect(issue!.message).toContain("call cycle");
    expect(issue!.message).not.toContain("depth/size budget");
    expect(issue!.suggestion).toContain("will not change this");
    // #158 自洽不变量：有 recursion-truncated ⇒ budget.truncated
    expect(r.budget!.truncated).toBe(true);
    expect(r.budget!.evalCallTruncated).toBe(true);
    expect(r.budget!.cycleTruncated).toBe(true);
    expect(r.budget!.reasons).toContain("cycle");
    expect(r.budget!.evalCalls).toBeGreaterThan(0);
  });

  it("check --json wire：issue.reason + budget 块 B 路径字段", () => {
    const json = serializeCheckJson(checkSource("/t/cyc158-json.js", CYC_SRC, pTrue));
    const issue = json.issues.find((i) => i.code === "nudo:recursion-truncated");
    expect(issue).toBeDefined();
    expect(issue!.reason).toBe("cycle");
    expect(json.budget!.truncated).toBe(true);
    expect(json.budget!.evalCallTruncated).toBe(true);
    expect(json.budget!.cycleTruncated).toBe(true);
    expect(json.budget!.reasons).toContain("cycle");
    expect(json.budget!.evalCalls).toBeGreaterThan(0);
    // 多文件信封同样聚合 B 截断
    const multi = serializeCheckJsonMulti([json]);
    expect(multi.summary.budgetTruncated).toBe(true);
    expect(multi.budget!.evalCallTruncated).toBe(true);
  });

  it("具体深递归报 call-depth budget（reason=depth，建议指明 depth 维）", () => {
    const src = `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }\ndown(100);\n`;
    const r = checkSource("/t/depth158.js", src, pTrue);
    const issue = r.issues.find((i) => i.code === "nudo:recursion-truncated");
    expect(issue).toBeDefined();
    expect(issue!.reason).toBe("depth");
    expect(issue!.message).toContain("call-depth budget");
    expect(issue!.suggestion).toContain("@nudo:budget depth=");
    expect(r.budget!.reasons).toContain("depth");
  });

  it("人类面 budget 块：cycle 归因（非预算）+ cycle 提示，不打未触发的 eval calls 计数", () => {
    const text = formatCheckReport(checkSource("/t/cyc158-fmt.js", CYC_SRC, pTrue));
    // #health-budget：归因只打真正触发的那条预算——cycle 不是预算，
    // 打「非预算」标签而非计数段（cycle 截断 ≠ eval calls 到顶）
    expect(text).toContain("call cycle — not a budget limit");
    expect(text).toContain("call cycles");
    expect(text).not.toContain("eval calls");
  });

  it("actionsForIssue 按 reason 分流：cycle 不指向抬预算", () => {
    const cyc = actionsForIssue({ code: "nudo:recursion-truncated", reason: "cycle" });
    expect(cyc[0]!.label).toContain("cannot lift");
    const dep = actionsForIssue({ code: "nudo:recursion-truncated", reason: "depth" });
    expect(dep[0]!.label).toContain("@nudo:budget depth");
    const cal = actionsForIssue({ code: "nudo:recursion-truncated", reason: "calls" });
    expect(cal[0]!.label).toContain("@nudo:budget calls");
  });
});

describe("#158 后续：循环迭代截断 ≠ 递归/调用预算", () => {
  const LOOP_SRC = `export function infiniteDec(n) {\n  let i = 0;\n  while (i < n) { i = i - 1; }\n  return i;\n}\ninfiniteDec(5);\n`;

  it("infinite concrete loop 报 nudo:loop-truncated（不再冒充递归/预算）", () => {
    const r = checkSource("/t/loop158.js", LOOP_SRC, pTrue);
    const loop = r.issues.find((i) => i.code === "nudo:loop-truncated");
    expect(loop).toBeDefined();
    // 旧路径的假归因必须消失：不是递归、不指向 @nudo:budget
    expect(loop!.message).not.toContain("Recursive evaluation");
    expect(loop!.suggestion).not.toContain("@nudo:budget");
    expect(r.issues.find((i) => i.code === "nudo:recursion-truncated")).toBeUndefined();
  });

  it("budget 块自洽：loopTruncated=true 计入 truncated（json/人类面/多文件）", () => {
    const r = checkSource("/t/loop158-json.js", LOOP_SRC, pTrue);
    expect(r.budget!.truncated).toBe(true);
    expect(r.budget!.loopTruncated).toBe(true);
    const json = serializeCheckJson(r);
    expect(json.budget!.loopTruncated).toBe(true);
    expect(json.budget!.truncated).toBe(true);
    const multi = serializeCheckJsonMulti([json]);
    expect(multi.budget!.loopTruncated).toBe(true);
    expect(multi.summary.budgetTruncated).toBe(true);
    const text = formatCheckReport(r);
    expect(text).toContain("loop iterations");
  });

  it("actionsForIssue：loop-truncated 不指向调用预算旋钮", () => {
    const acts = actionsForIssue({ code: "nudo:loop-truncated" });
    expect(acts[0]!.label).not.toContain("@nudo:budget calls");
    expect(acts[0]!.label).toContain("@nudo:case");
  });
});
