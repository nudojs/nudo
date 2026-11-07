/**
 * Bug 897 回归（vite-plugin 构建期）：check 面必须把**项目配置**里的
 * L2 门禁档位（`package.json#nudo.check.entryThrows` / `ignoreThrows`）
 * 传给 `checkSource` —— 与 CLI / LSP **同口径**。
 *
 * 病灶：插件调 `checkSource` 时**不传** `entryThrows` / `ignoreThrows`
 * ⇒ `checkSource` 用默认最严档（`entryThrows:"error"`、`ignoreThrows:[]`）
 * ⇒ 项目配置的 `nudo.check.*` 被无视（插件自己却读了**同源**配置的
 * `autoBind` ⇒ 配置找得到，只是没把门禁档位一起带过去）
 * ⇒ 同一个仓库 `nudo check` 绿、`vite build` 红，`failOnError: true` 时
 * `this.error` 抛异常 ⇒ **构建中断**。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts` 的
 * `assembleCheckOutcome`）：从**同一份**项目配置
 * （`findProjectConfig(dirname(id))?.config`）取 `checkConfig(...)` 的
 * `entryThrows` / `ignoreThrows` 并传给 `checkSource`
 * —— 口径与 LSP 的 `validation.ts` / `agent-tools.ts` 逐字一致。
 *
 * 负控制：没有配置时仍是默认最严档（`error`）⇒ 门禁未被整体关掉。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: never[]) => unknown {
  if (typeof h === "function") return h as (...args: never[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: never[]) => unknown }).handler;
  }
  throw new Error("hook not callable");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

/** 会真抛的入口（读未约束全局 ⇒ L2 may-throw）。 */
const ENTRY_SRC = `export function getName(user) {
  return user.name;
}
`;

type Run = { warns: string[]; errors: string[]; thrown?: string };

async function runPlugin(
  dir: string,
  options: Record<string, unknown>,
): Promise<Run> {
  const plugin = nudoPlugin(options);
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    // 真实 Rollup/Vite 语义：this.error 抛异常
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
    info: () => {},
  };
  const file = join(dir, "a.js");
  const out: Run = { warns, errors };
  try {
    await transformOf(plugin).call(ctx, ENTRY_SRC, file);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  return out;
}

function project(dir: string, nudo?: Record<string, unknown>): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "nudo-vite-bug-897", private: true, ...(nudo ? { nudo } : {}) }),
    "utf-8",
  );
  writeFileSync(join(dir, "a.js"), ENTRY_SRC, "utf-8");
}

describe("Bug 897: vite-plugin 读项目配置的 L2 门禁档位（entryThrows / ignoreThrows）", () => {
  it("entryThrows=warning ⇒ 报 warning 而不是 error（与 CLI 同口径）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897-"));
    try {
      project(dir, { check: { entryThrows: "warning" } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:entry-may-throw");
      // 档位是 warning ⇒ 不得走 this.error（否则 failOnError 会中断构建）
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
      expect(r.warns.join("\n")).toContain("warning:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entryThrows=warning + failOnError=true ⇒ 构建不中断（不再抛）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897b-"));
    try {
      project(dir, { check: { entryThrows: "warning" } });
      const r = await runPlugin(dir, { failOnError: true });
      expect(r.thrown).toBeUndefined();
      expect(r.errors).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignoreThrows=[TypeError] ⇒ 该 throw 类不再报 nudo:entry-may-throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897c-"));
    try {
      project(dir, { check: { ignoreThrows: ["TypeError"] } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).not.toContain("nudo:entry-may-throw");
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entryThrows=off ⇒ L2 门禁诊断整段缺席", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897d-"));
    try {
      project(dir, { check: { entryThrows: "off" } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).not.toContain("nudo:entry-may-throw");
      expect(r.errors).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：没有 nudo.check 配置时仍是默认最严档（error）—— 门禁未被整体关掉", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897e-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: true });
      expect(r.errors.join("\n")).toContain("nudo:entry-may-throw");
      expect(r.thrown).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("profile=adoption 预设 ⇒ 落到 warning 档（与 CLI / LSP 的预设解析同口径）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897f-"));
    try {
      project(dir, { check: { profile: "adoption" } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:entry-may-throw");
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
