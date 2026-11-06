/**
 * Bug 636 回归：fork 预算的**生效值**（env `NUDO_MAX_FORKS` 优先）必须进
 * 磁盘缓存键。
 *
 * 病灶：缓存键（`checkCacheKey` 的 `analysisCfg.maxForks`）喂的是
 * `analysisConfig(config).maxForks`，而它**只认 package.json**；真正生效的
 * 上限来自 env（`applyBForkBudgetFromConfig` 同口径：env > config > 5000）
 * ⇒ 改 env 不改键 ⇒ 命中轮返回**上一轮**的陈旧 budget（反向：新预算
 * **根本没执行**，`nudo:fork-truncated` 缺失）。
 *
 * 修法（packages/service/src/evaluator/config.ts）：新增纯函数
 * `effectiveMaxForks(config, env)`，`analysisConfig()` 的 `maxForks`
 * 改用它 ⇒ 键随 env 变。
 *
 * 负控制：config-only 维度（无 env）行为不变；非法 env 仍回落默认 5000。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { analysisConfig, effectiveMaxForks } from "../evaluator/config.ts";
import { checkCacheKey } from "../disk-cache.ts";

const ENV_KEY = "NUDO_MAX_FORKS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("Bug 636: effectiveMaxForks —— env 优先的 fork 预算生效值", () => {
  it("env NUDO_MAX_FORKS 优先于 package.json#nudo.analysis.maxForks", () => {
    process.env[ENV_KEY] = "7";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(7);
  });

  it("无 env 时回落 package.json 值；两者都无则回落默认 5000", () => {
    delete process.env[ENV_KEY];
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(100);
    expect(effectiveMaxForks(undefined)).toBe(5000);
    expect(effectiveMaxForks({})).toBe(5000);
  });

  it("env 非法（非整数 / <1）⇒ 回落默认 5000（不回配置键）", () => {
    for (const bad of ["abc", "0", "-3"]) {
      process.env[ENV_KEY] = bad;
      expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(5000);
    }
  });

  it("env 是小数 ⇒ 向下取整（与 applyBForkBudgetFromConfig 同口径）", () => {
    process.env[ENV_KEY] = "1.5";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(1);
  });

  it("空串 env 按「未设」处理（回落到 package.json 值）", () => {
    process.env[ENV_KEY] = "";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(100);
  });

  it("显式 env 参数优先于 process.env（纯函数、可测）", () => {
    process.env[ENV_KEY] = "7";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } }, {})).toBe(100);
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } }, { NUDO_MAX_FORKS: "9" })).toBe(9);
  });
});

describe("Bug 636: analysisConfig().maxForks 是 env 生效值（缓存键的输入）", () => {
  it("env 改 fork 预算 ⇒ analysisConfig().maxForks 随之变", () => {
    delete process.env[ENV_KEY];
    expect(analysisConfig({ analysis: { maxForks: 100 } }).maxForks).toBe(100);
    process.env[ENV_KEY] = "3";
    expect(analysisConfig({ analysis: { maxForks: 100 } }).maxForks).toBe(3);
  });

  it("缓存键随 env 生效的 fork 预算翻转（命中轮不得返回陈旧 budget）", () => {
    const cfg = { analysis: { maxForks: 100 } };
    const src = "export function pick(a, b, c) { return a + b + c; }\n";
    const keyOf = (): string =>
      checkCacheKey("/tmp/nudo-bug-636/lib.js", src, {
        autoBind: true,
        analysisCfg: {
          mode: "exports",
          evalMissingSlot: "off",
          callSiteBudget: 3,
          entryThrows: "error",
          ignoreThrows: "",
          // 与 CLI 喂键口径一致：`aCfg.maxForks`（= analysisConfig().maxForks）
          maxForks: analysisConfig(cfg).maxForks,
        },
      });
    delete process.env[ENV_KEY];
    const keyNoEnv = keyOf();
    process.env[ENV_KEY] = "1";
    const keyEnv = keyOf();
    expect(keyEnv).not.toBe(keyNoEnv);
  });

  it("缓存键**自身**兜底：调用方喂陈旧的 maxForks，键仍随 env 生效值变", () => {
    const src = "export function pick(a, b, c) { return a + b + c; }\n";
    const keyWith = (maxForks: number): string =>
      checkCacheKey("/tmp/nudo-bug-636/lib.js", src, {
        autoBind: true,
        analysisCfg: {
          mode: "exports",
          evalMissingSlot: "off",
          callSiteBudget: 3,
          entryThrows: "error",
          ignoreThrows: "",
          maxForks,
        },
      });
    delete process.env[ENV_KEY];
    const keyNoEnv = keyWith(5000);
    process.env[ENV_KEY] = "1";
    // 调用方喂的是**陈旧**值（5000）⇒ 键仍必须变（否则命中轮返回陈旧 budget）
    const keyEnv = keyWith(5000);
    expect(keyEnv).not.toBe(keyNoEnv);
  });
});
