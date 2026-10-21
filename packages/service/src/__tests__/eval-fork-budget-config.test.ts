/**
 * fork 预算可配置：env NUDO_MAX_FORKS > package.json#nudo.analysis.maxForks > 默认 5000。
 * core 保持无 IO——由 service 读取后 setEvalForkBudgetLimit 进 core。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  analysisConfig,
  applyBForkBudgetFromConfig,
  currentBForkBudgetLimit,
} from "../evaluator/config.ts";
import { setEvalForkBudgetLimit, getEvalForkBudgetLimit, MAX_EVAL_TOTAL_FORKS } from "@nudojs/core/internal";

describe("analysis.maxForks config", () => {
  beforeEach(() => {
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });
  afterEach(() => {
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });

  it("defaults to 5000 when absent", () => {
    expect(analysisConfig(undefined).maxForks).toBe(5000);
    expect(analysisConfig({}).maxForks).toBe(5000);
    expect(analysisConfig({ analysis: {} }).maxForks).toBe(5000);
  });

  it("reads package.json#nudo.analysis.maxForks", () => {
    expect(analysisConfig({ analysis: { maxForks: 100 } }).maxForks).toBe(100);
    expect(analysisConfig({ analysis: { maxForks: 100.9 } }).maxForks).toBe(100);
  });

  it("invalid maxForks falls back to default 5000", () => {
    for (const bad of [0, -3, NaN, Infinity]) {
      expect(analysisConfig({ analysis: { maxForks: bad } }).maxForks).toBe(5000);
    }
  });
});

describe("applyBForkBudgetFromConfig (env / package.json → core)", () => {
  beforeEach(() => {
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });
  afterEach(() => {
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });

  it("env NUDO_MAX_FORKS wins over package.json layer", () => {
    const n = applyBForkBudgetFromConfig(
      { analysis: { maxForks: 200 } },
      { NUDO_MAX_FORKS: "42" } as NodeJS.ProcessEnv,
    );
    expect(n).toBe(42);
    expect(getEvalForkBudgetLimit()).toBe(42);
    expect(currentBForkBudgetLimit()).toBe(42);
  });

  it("package.json layer applies when env is absent", () => {
    const n = applyBForkBudgetFromConfig(
      { analysis: { maxForks: 7 } },
      {} as NodeJS.ProcessEnv,
    );
    expect(n).toBe(7);
    expect(getEvalForkBudgetLimit()).toBe(7);
  });

  it("falls back to default 5000 when both layers absent/invalid", () => {
    expect(applyBForkBudgetFromConfig(null, {} as NodeJS.ProcessEnv)).toBe(5000);
    expect(
      applyBForkBudgetFromConfig(
        { analysis: { maxForks: 0 } },
        { NUDO_MAX_FORKS: "nope" } as NodeJS.ProcessEnv,
      ),
    ).toBe(5000);
    expect(getEvalForkBudgetLimit()).toBe(5000);
  });

  it("invalid env value falls back to the DEFAULT 5000 (not the config layer)", () => {
    // Bug 490：旧行为让非法 env 沿 ?? 链落到配置键（33），与文档
    // （config.md env 表「invalid falls back to the default」）和本文件
    // 头注释「非法值回默认」都不符——用户以为在用默认，实际悄悄用着配置值。
    // 修法：区分「env 未设」与「env 设了但非法」；后者直接回默认 + stderr 告警。
    const n = applyBForkBudgetFromConfig(
      { analysis: { maxForks: 33 } },
      { NUDO_MAX_FORKS: "abc" } as NodeJS.ProcessEnv,
    );
    expect(n).toBe(5000);
    expect(getEvalForkBudgetLimit()).toBe(5000);
  });
});
