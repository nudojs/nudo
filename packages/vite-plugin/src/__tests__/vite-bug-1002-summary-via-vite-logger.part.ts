/**
 * Bug 1002 —— vite-plugin 的 `buildEnd` 汇总行走 `console.log` ⇒ **绕过 Vite 的
 * `build.logLevel`** ⇒ 用户设了 `logLevel: "silent"` 仍然**只**剩下
 * `[nudo] Analysis complete: N error(s)` 一行，而那 N 条**诊断一条都没被打印**
 * ⇒ 静默失效 + 汇总与日志互相矛盾。
 *
 * 根因：插件的输出**分了两条通道** —— 逐条诊断走 Vite 的 `this.warn`
 * （受 logLevel 管辖），汇总行走裸 `console.log`（**不受管辖**）。
 *
 * 修法：汇总行改走 **Vite logger**（`ctx.info` → `ctx.warn` 兜底）⇒
 * `logLevel: "silent"` 下**什么都不输出**（含汇总行）。
 *
 * 钉：汇总行走 ctx.info（**不**走 console.log）；宿主没有 info 通道时降级到
 * ctx.warn；console.log 一律收不到汇总行。
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

/** L2 入口面 ⇒ 至少一条 error 级诊断 ⇒ buildEnd 有汇总行可发。 */
const SRC = `export function getName(user) {
  return user.name;
}
`;

async function fixture(): Promise<{ dir: string; id: string }> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-1002-"));
  const id = join(dir, "entry.js");
  writeFileSync(id, SRC, "utf-8");
  return { dir, id };
}

describe("Bug 1002 —— buildEnd 汇总行走 Vite logger（受 build.logLevel 管辖）", () => {
  it("汇总行走 ctx.info（vite logger），不再走裸 console.log", async () => {
    const { dir, id } = await fixture();
    try {
      const plugin = nudoPlugin();
      const warns: string[] = [];
      const infos: string[] = [];
      const ctx = {
        warn: (m: string) => warns.push(String(m)),
        error: (m: string) => {
          throw new Error(m);
        },
        info: (m: string) => infos.push(String(m)),
      };

      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      let logged: string[] = [];
      try {
        await transformOf(plugin).call(ctx, SRC, id);
        hookFn(plugin.buildEnd).call(ctx);
        // ⚠ `mockRestore()` 会**清空** `mock.calls` ⇒ 必须在 restore 之前取。
        logged = spy.mock.calls.map((c) => String(c[0]));
      } finally {
        spy.mockRestore();
      }

      const summary = infos.find((m) => m.includes("Analysis complete"));
      expect(summary, JSON.stringify({ warns, infos })).toBeDefined();
      expect(summary).toMatch(/\[nudo\] Analysis complete: [0-9]+ error\(s\), [0-9]+ warning\(s\)/);
      // 汇总行**不得**再从 console.log 逃逸（否则 logLevel: "silent" 挡不住）
      expect(logged.filter((l) => l.includes("Analysis complete"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("宿主没有 info 通道时降级到 ctx.warn（仍不逃逸到 console.log）", async () => {
    const { dir, id } = await fixture();
    try {
      const plugin = nudoPlugin();
      const warns: string[] = [];
      const ctx = {
        warn: (m: string) => warns.push(String(m)),
        error: (m: string) => {
          throw new Error(m);
        },
      };

      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      let logged: string[] = [];
      try {
        await transformOf(plugin).call(ctx, SRC, id);
        hookFn(plugin.buildEnd).call(ctx);
        logged = spy.mock.calls.map((c) => String(c[0]));
      } finally {
        spy.mockRestore();
      }

      expect(warns.some((w) => w.includes("Analysis complete"))).toBe(true);
      expect(logged.filter((l) => l.includes("Analysis complete"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
