/**
 * ABS-14 等价性门禁 · body 路径基线（**第一半**，2026-11-10 建）。
 *
 * 快路径尚未落地 ⇒ 本文件只钉住 body 侧。快路径合入时必须在同一夹具上
 * 调用 `diffAgainstBodyBaseline(fastPathPost)`，逐条 `equal === true`
 * 才允许启用「body 不可用 / 预算截断 / 跨模块复用」三条保守通道。
 * 见 `docs/design/plans/2026-11-09-abs-improvement-plan.md` §5 决策第 3 条。
 */
import { describe, it, expect } from "vitest";
import {
  ABS14_BASELINE_CASES,
  diffAgainstBodyBaseline,
  runBodyPath,
} from "./abs14-equivalence-baseline.ts";

describe("ABS-14 等价性门禁 · body 路径基线", () => {
  it("样本清单是门禁面：新增或删除都必须显式改这份断言", () => {
    expect(ABS14_BASELINE_CASES.map((c) => c.id)).toEqual([
      "arithmetic-return",
      "identity-alpha",
      "array-element",
      "hof-map-beta",
      "hof-map-number-to-string",
      "recursive-budget",
      "string-concat",
    ]);
  });

  for (const c of ABS14_BASELINE_CASES) {
    it(`${c.id}：${c.covers} → body 输出逐字节钉住`, () => {
      const run = runBodyPath(c);
      expect(run.summaryHits).toBe(0);
      expect(run.printed).toBe(c.expectedPost);
    });
  }

  it("同一 case 两次独立 body 运行逐字节一致（基线可复现）", () => {
    for (const c of ABS14_BASELINE_CASES) {
      expect(runBodyPath(c).printed).toBe(runBodyPath(c).printed);
    }
  });

  it("预算截断样本不写摘要（fail-closed 结果不得固化为可复用结论）", () => {
    const c = ABS14_BASELINE_CASES.find((x) => x.id === "recursive-budget");
    expect(c).toBeDefined();
    if (!c) return;
    expect(runBodyPath(c).summaryStores).toBe(0);
  });

  it("diffAgainstBodyBaseline 自比对通过（快路径接入模板可用）", () => {
    // 快路径尚不存在，用 body 路径自己充当「快路径」验证断言接口可跑。
    const diffs = diffAgainstBodyBaseline((c, phi) => runBodyPath(c, phi).post);
    expect(diffs.filter((d) => !d.equal)).toEqual([]);
  });
});
