/**
 * Bug 904 —— `failOnError: true` 只报**第一条** error，其余 error 级诊断被
 * **静默丢弃** ⇒ 构建摘要说「2 error(s)」而报错里只有 1 条。
 *
 * 根因：`fatal` 是**单个字符串**、`??` 短路只留首条 ⇒ 第二条 error 诊断在
 * 构建日志里**一条都没出现**（用户无从定位；CI 日志与摘要自相矛盾）。
 *
 * 修法：`fatal` 改**消息数组**（S0 已备好），**首条**由宿主 `this.error`
 * 抛出（红构建），**其余 error 级诊断逐条 `this.warn` 出来**（本层内完成，
 * `index.ts` 不动）⇒ 摘要计数与实际上报条数**一致**。
 *
 * 钉：两条 error ⇒ 1 条 `this.error`（抛）+ 1 条 `this.warn`；
 * 汇总行仍是「2 error(s)」⇒ 报数与上报条数一致。
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
  throw new Error("plugin hook missing");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

/** 两个入口函数各自触发 L2 `nudo:entry-may-throw` ⇒ 两条 error 级诊断。 */
const SRC = `export function a(u) {
  return u.name;
}
export function b(u) {
  return u.id;
}
`;

describe("Bug 904 —— failOnError 档下每条 error 诊断都要上报", () => {
  it("两条 error ⇒ 首条 this.error 抛出 + 其余逐条 this.warn（不静默丢弃）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-904-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const plugin = nudoPlugin({ failOnError: true });
      const warnFn = vi.fn();
      const errorFn = vi.fn((m: string) => {
        throw new Error(m);
      });
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

      await expect(transformOf(plugin).call(ctx, SRC, id)).rejects.toThrow(/entry-may-throw/);

      // 首条走 this.error（抛）
      expect(errorFn).toHaveBeenCalledTimes(1);
      const first = String(errorFn.mock.calls[0]?.[0] ?? "");
      expect(first).toContain("a (export)");
      expect(first).toContain("nudo:entry-may-throw");

      // 其余 error 逐条 warn —— 此前**一条都没有**（904 的核心症状）
      const warned = warnFn.mock.calls.map((c) => String(c[0]));
      expect(warned.length, JSON.stringify(warned)).toBe(1);
      expect(warned[0]).toContain("b (export)");
      expect(warned[0]).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("摘要计数与实际上报条数一致（2 error(s) ⇒ 1 抛 + 1 warn）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-904-count-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const plugin = nudoPlugin({ failOnError: true });
      const warns: string[] = [];
      const errors: string[] = [];
      const infos: string[] = [];
      const ctx = {
        warn: (m: string) => warns.push(String(m)),
        error: (m: string) => {
          errors.push(String(m));
          throw new Error(m);
        },
        info: (m: string) => infos.push(String(m)),
      };

      // buildStart 先清缓存，再 transform（诊断进缓存），最后 buildEnd 汇总
      hookFn(plugin.buildStart).call(ctx);
      await transformOf(plugin).call(ctx, SRC, id).catch(() => undefined);
      hookFn(plugin.buildEnd).call(ctx);

      const summary = infos.find((m) => m.includes("Analysis complete"));
      expect(summary, JSON.stringify({ warns, errors, infos })).toBeDefined();
      expect(summary).toContain("2 error(s)");
      // 报数 2 ⇒ 实际上报 2 条 error 级诊断（1 抛 + 1 warn）
      const reported = errors.length + warns.filter((w) => w.includes(" error: ")).length;
      expect(reported).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("failOnError: false（默认档）口径不变：每条 error 降 warn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-904-default-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };
      await transformOf(plugin).call(ctx, SRC, id);
      const warned = warnFn.mock.calls.map((c) => String(c[0]));
      expect(warned.filter((w) => w.includes(" error: ")).length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
