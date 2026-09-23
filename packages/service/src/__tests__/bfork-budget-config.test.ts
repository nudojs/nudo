/**
 * fork 预算可配置：env NUDO_MAX_FORKS > package.json#nudo.analysis.maxForks > 默认 5000。
 * core 保持无 IO——由 service 读取后 setBForkBudgetLimit 进 core。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  analysisConfig,
  applyBForkBudgetFromConfig,
  currentBForkBudgetLimit,
} from "../evaluator/config.ts";
import {
  setBForkBudgetLimit,
  getBForkBudgetLimit,
  MAX_B_TOTAL_FORKS,
} from "@nudojs/core";

describe("analysis.maxForks config", () => {
  beforeEach(() => {
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
  });
  afterEach(() => {
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
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
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
  });
  afterEach(() => {
    setBForkBudgetLimit(MAX_B_TOTAL_FORKS);
  });

  it("env NUDO_MAX_FORKS wins over package.json layer", () => {
    const n = applyBForkBudgetFromConfig(
      { analysis: { maxForks: 200 } },
      { NUDO_MAX_FORKS: "42" } as NodeJS.ProcessEnv,
    );
    expect(n).toBe(42);
    expect(getBForkBudgetLimit()).toBe(42);
    expect(currentBForkBudgetLimit()).toBe(42);
  });

  it("package.json layer applies when env is absent", () => {
    const n = applyBForkBudgetFromConfig(
      { analysis: { maxForks: 7 } },
      {} as NodeJS.ProcessEnv,
    );
    expect(n).toBe(7);
    expect(getBForkBudgetLimit()).toBe(7);
  });

  it("falls back to default 5000 when both layers absent/invalid", () => {
    expect(applyBForkBudgetFromConfig(null, {} as NodeJS.ProcessEnv)).toBe(5000);
    expect(
      applyBForkBudgetFromConfig(
        { analysis: { maxForks: 0 } },
        { NUDO_MAX_FORKS: "nope" } as NodeJS.ProcessEnv,
      ),
    ).toBe(5000);
    expect(getBForkBudgetLimit()).toBe(5000);
  });

  it("invalid env value is ignored (config layer still applies)", () => {
    const n = applyBForkBudgetFromConfig(
      { analysis: { maxForks: 33 } },
      { NUDO_MAX_FORKS: "abc" } as NodeJS.ProcessEnv,
    );
    expect(n).toBe(33);
  });
});
