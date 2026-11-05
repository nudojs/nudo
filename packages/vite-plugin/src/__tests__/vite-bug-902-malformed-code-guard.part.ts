/**
 * Bug 902 —— `transform()` 对 `code = null` **抛未捕获异常**（异常在 `try` 之外，
 * 插件自己的兜底 `catch` 接不到）。
 *
 * 根因：`shouldAnalyzeFile` 的守卫是 `text !== undefined`（**漏掉 `null`**）⇒
 * `hasNudoDirectives(null)` ⇒ `stripStringsKeepComments(null)` 访问 `.length`
 * ⇒ node 措辞 `Cannot read properties of null (reading 'length')`；
 * 而该调用在插件 `transform` 的 `try` **之外** ⇒ 异常冒泡出钩子。
 *
 * 修法（**插件侧**，不改 `packages/service/src/analysis-scope.ts`）：
 * - `scope.ts` 的 `scopeDecision` 先做 `typeof code !== "string"` 前置检查；
 * - `shouldAnalyzeFile` 的调用**包进 try** ⇒ 任何守卫异常都降级为「跳过」。
 *
 * 钉：畸形入参（`null` / `undefined` / 数字）**一律不抛**、返回 `null`、零诊断。
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

const SRC = `export function getName(user) {
  return user.name;
}
`;

/** 夹具：带 `nudo.analysis.mode` 的工程目录（决定守卫走哪条分支）。 */
function fixture(mode: string): { dir: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-902-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: `bug902-${mode}`,
      private: true,
      nudo: { analysis: { mode } },
    }),
    "utf-8",
  );
  const id = join(dir, "x.js");
  writeFileSync(id, SRC, "utf-8");
  return { dir, id };
}

describe("Bug 902 —— 畸形入参不得抛未捕获异常", () => {
  for (const mode of ["exports", "directives", "all"]) {
    it(`mode=${mode}：code=null ⇒ 不抛、返回 null、零诊断`, async () => {
      const { dir, id } = fixture(mode);
      try {
        const plugin = nudoPlugin();
        const warnFn = vi.fn();
        const errorFn = vi.fn();
        const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

        const result = await transformOf(plugin).call(ctx, null as unknown as string, id);

        expect(result).toBeNull();
        expect(errorFn).not.toHaveBeenCalled();
        expect(warnFn).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 30_000);

    it(`mode=${mode}：code=undefined / 数字 ⇒ 不抛`, async () => {
      const { dir, id } = fixture(mode);
      try {
        const plugin = nudoPlugin();
        const ctx = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

        await expect(
          transformOf(plugin).call(ctx, undefined as unknown as string, id),
        ).resolves.toBeNull();
        await expect(
          transformOf(plugin).call(ctx, 123 as unknown as string, id),
        ).resolves.toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 30_000);
  }

  it("failOnError: true + code=null ⇒ 仍然不抛（畸形入参不得中断构建）", async () => {
    const { dir, id } = fixture("exports");
    try {
      const plugin = nudoPlugin({ failOnError: true });
      const errorFn = vi.fn((m: string) => {
        throw new Error(m);
      });
      const ctx = { warn: vi.fn(), error: errorFn, info: vi.fn() };

      await expect(
        transformOf(plugin).call(ctx, null as unknown as string, id),
      ).resolves.toBeNull();
      expect(errorFn).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("对照组：正常源码仍然照常分析（守卫没被整体短路）", async () => {
    const { dir, id } = fixture("exports");
    try {
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };

      await transformOf(plugin).call(ctx, SRC, id);

      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
