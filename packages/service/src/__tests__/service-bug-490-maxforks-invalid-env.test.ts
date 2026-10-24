/**
 * Bug 490 —— `NUDO_MAX_FORKS` 给了**非法值**时，实现让
 * `nudo.analysis.maxForks` 顶上来；而文档与**源码自己的注释**都写
 * 「非法值回**默认**（5000）」——实现与二者都不符。
 *
 * 根因（config.ts applyBForkBudgetFromConfig）：`parseMaxForks` 把「非法」
 * 折成 `undefined`，与「**没设**」同值 ⇒ `??` 链无法区分「env 非法
 * （应回默认）」与「env 未设（应看配置）」。
 *
 * 修法：区分「env 未设（缺席 / 空串）」与「env 设了但非法」；后者直接回
 * 默认 5000 并给一条 stderr 提示（用户至少知道自己没在用配置值）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyBForkBudgetFromConfig,
  currentBForkBudgetLimit,
  evictProjectConfigMemo,
} from "../evaluator/config.ts";

function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

const CFG_200 = { analysis: { maxForks: 200 } };

describe("Bug 490 — 非法 NUDO_MAX_FORKS 回默认（不是配置键）", () => {
  beforeEach(() => {
    evictProjectConfigMemo();
  });

  it("非法 env + 合法配置键 → 回默认 5000 + stderr 提示", () => {
    let eff: number | undefined;
    const out = captureStderr(() => {
      eff = applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "abc" });
    });
    // 旧实现：非法 env 被折成 undefined → ?? 链落到配置键 → 200
    expect(eff).toBe(5000);
    expect(currentBForkBudgetLimit()).toBe(5000);
    expect(out).toContain("NUDO_MAX_FORKS: invalid value");
    expect(out).toContain("using 5000");
  });

  it("非法 env（0 / 负数 / 非数字）+ 配置键 → 一律回默认", () => {
    for (const raw of ["0", "-5", "abc", "1e"]) {
      evictProjectConfigMemo();
      let eff: number | undefined;
      captureStderr(() => {
        eff = applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: raw });
      });
      expect(eff, raw).toBe(5000);
    }
  });

  // ── 负控制：合法 env / env 未设的优先级不得被波及 ────────────────
  it("合法 env 压过配置键", () => {
    expect(applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "999" })).toBe(999);
    expect(applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "1" })).toBe(1);
  });

  it("env 未设 → 看配置键；配置键也没有 → 默认", () => {
    expect(applyBForkBudgetFromConfig(CFG_200, {})).toBe(200);
    expect(applyBForkBudgetFromConfig(undefined, {})).toBe(5000);
  });

  it("env 为空串 → 按「未设」处理（看配置键）", () => {
    expect(applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "" })).toBe(200);
  });

  it("配置键本身非法 → 回默认（既有语义不变）", () => {
    expect(applyBForkBudgetFromConfig({ analysis: { maxForks: 0 } }, {})).toBe(5000);
    expect(applyBForkBudgetFromConfig({ analysis: { maxForks: -1 } }, {})).toBe(5000);
  });
});
