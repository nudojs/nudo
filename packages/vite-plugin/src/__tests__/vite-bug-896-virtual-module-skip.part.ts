/**
 * Bug 896 —— Vite **虚拟模块 id**（`\0` 前缀 / `virtual:` 前缀）触发侧车加载失败
 * ⇒ 干净模块被判 **error**；`failOnError: true` 时**抛错中断构建**。
 *
 * 根因：`transform` 入口不判「虚拟模块」⇒ 插件把 id 原样拼成侧车路径
 * （`./<id>.nudo.js`）⇒ 路径含 **NUL** ⇒ 必然读不到 ⇒ 报
 * `nudo:module-unreadable` 级的 **error**（改前实测文案：
 * `cannot read module '<abs>/\0virtual:mod2.nudo.js' (ERR_INVALID_ARG_VALUE)`）。
 *
 * 修法：`scope.ts` 的 `scopeDecision` **第一步**判虚拟模块 ⇒ 直接跳过
 * （reason = `"virtual"`）。虚拟模块没有真实文件、没有同目录侧车 ⇒ 不该分析。
 */
import { describe, it, expect, vi } from "vitest";
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

/** 干净源码（无指令、无入口面 ⇒ 控制组必须零诊断）。 */
const CLEAN = `export const a = 1;
`;

describe("Bug 896 —— 虚拟模块 id 必须被跳过（不再触发侧车加载失败）", () => {
  it("\\0 前缀虚拟 id + 干净源码 + failOnError: true ⇒ 不抛、零诊断", async () => {
    const plugin = nudoPlugin({ failOnError: true });
    const warnFn = vi.fn();
    const errorFn = vi.fn((m: string) => {
      throw new Error(m);
    });
    const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

    const result = await transformOf(plugin).call(ctx, CLEAN, "\0virtual:mod2.js");

    expect(result).toBeNull();
    expect(errorFn).not.toHaveBeenCalled();
    expect(warnFn).not.toHaveBeenCalled();
  }, 30_000);

  it("\\0 前缀虚拟 id + 干净源码 + 默认档 ⇒ 零诊断（改前是 1 条 error 级）", async () => {
    const plugin = nudoPlugin();
    const warnFn = vi.fn();
    const errorFn = vi.fn();
    const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

    await transformOf(plugin).call(ctx, CLEAN, "\0virtual:mod2.js");

    const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msgs).not.toContain("module-unreadable");
    expect(warnFn).not.toHaveBeenCalled();
    expect(errorFn).not.toHaveBeenCalled();
  }, 30_000);

  it("virtual: 前缀虚拟 id（无 NUL）同样被跳过", async () => {
    const plugin = nudoPlugin();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };

    await transformOf(plugin).call(ctx, CLEAN, "virtual:mod2.js");

    expect(warnFn).not.toHaveBeenCalled();
  }, 30_000);

  it("对照组：同源码的普通文件 id 依旧零诊断（跳过不是「全都不分析」）", async () => {
    const plugin = nudoPlugin();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };

    const result = await transformOf(plugin).call(ctx, CLEAN, "/plain/virtual-mod2.js");

    expect(result).toBeNull();
    expect(warnFn).not.toHaveBeenCalled();
  }, 30_000);
});
