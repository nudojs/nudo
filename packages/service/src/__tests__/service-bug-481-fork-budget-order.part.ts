/**
 * Bug 481 —— `nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级
 * 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒
 * 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标
 * 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。
 *
 * 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算单例 /
 * session-cache-limits 的 fromProject 单槽），而写入只发生在 memo-miss 路径。
 *
 * 修法：memo **命中**路径同样重写这两个进程级槽（每次解析到项目配置都以
 * 本次解析结果为准 ⇒ 「最后一次查找 = 本次使用」自洽）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  findProjectConfig,
  evictProjectConfigMemo,
  currentBForkBudgetLimit,
  applyBForkBudgetFromConfig,
} from "../evaluator/config.ts";
import { getSessionCacheLimits, resetSessionCacheLimitState } from "../session-cache-limits.ts";
import { tmpProject } from "./tmp-project.ts";

function project(prefix: string, nudo: unknown): string {
  const root = tmpProject(prefix, { "package.json": JSON.stringify({ name: "p", nudo }) });
  return root;
}

describe("Bug 481 — 项目级预算/上限必须随每次解析重写（顺序无关）", () => {
  beforeEach(() => {
    evictProjectConfigMemo();
    resetSessionCacheLimitState();
  });
  afterEach(() => {
    // 进程级单槽是全局的：收尾复位，避免污染同文件后续用例
    applyBForkBudgetFromConfig(null, {});
    resetSessionCacheLimitState();
  });

  it("A → B → A（memo 命中）：预算回到 A 的值（不是 B 的最后写入者）", () => {
    const a = project("nudo-bug481-a-", { analysis: { maxForks: 11 } });
    const b = project("nudo-bug481-b-", { analysis: { maxForks: 22 } });

    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(11);
    findProjectConfig(b);
    expect(currentBForkBudgetLimit()).toBe(22);
    // 旧实现：memo 命中直接返回、不重写 → 仍是 B 的 22
    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(11);
    findProjectConfig(b);
    expect(currentBForkBudgetLimit()).toBe(22);
  });

  it("A → B → A：会话 LRU 上限同样随本次解析回到 A", () => {
    const a = project("nudo-bug481-sa-", { sessionCache: { maxFiles: 7 } });
    const b = project("nudo-bug481-sb-", { sessionCache: { maxFiles: 9 } });

    findProjectConfig(a);
    expect(getSessionCacheLimits({}).maxFiles).toBe(7);
    findProjectConfig(b);
    expect(getSessionCacheLimits({}).maxFiles).toBe(9);
    findProjectConfig(a);
    expect(getSessionCacheLimits({}).maxFiles).toBe(7);
  });

  it("无 nudo 键的目录：预算回落默认（不是上一个项目的值）", () => {
    const a = project("nudo-bug481-na-", { analysis: { maxForks: 11 } });
    const plain = tmpProject("nudo-bug481-nb-", {
      "package.json": JSON.stringify({ name: "plain" }),
    });

    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(11);
    findProjectConfig(plain);
    // 旧实现：memo 命中不重写 → 仍是 11（上一个项目的预算泄漏）
    expect(currentBForkBudgetLimit()).not.toBe(11);
  });

  // ── 负控制：单项目重复解析不得改变结论 ──────────────────────────
  it("同一项目重复解析：预算稳定", () => {
    const a = project("nudo-bug481-stable-", { analysis: { maxForks: 33 } });
    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(33);
    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(33);
    findProjectConfig(join(a, "src"));
    expect(currentBForkBudgetLimit()).toBe(33);
  });

  it("env NUDO_MAX_FORKS 仍压过项目配置（优先级不变）", () => {
    const a = project("nudo-bug481-env-", { analysis: { maxForks: 11 } });
    const saved = process.env.NUDO_MAX_FORKS;
    process.env.NUDO_MAX_FORKS = "77";
    try {
      findProjectConfig(a);
      expect(currentBForkBudgetLimit()).toBe(77);
    } finally {
      if (saved === undefined) delete process.env.NUDO_MAX_FORKS;
      else process.env.NUDO_MAX_FORKS = saved;
    }
  });
});
