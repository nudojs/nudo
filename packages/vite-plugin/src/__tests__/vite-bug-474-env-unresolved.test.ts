/**
 * Bug 474：vite-plugin **从不读** path-env 加载失败通道 ⇒ `@nudo:env ./missing.js`
 * 加载失败零诊断（env 静默不生效：该 env 提供的全局退化成 unknown / 宿主真身，
 * 构建日志里没有任何一行提示）。
 *
 * 修法（packages/vite-plugin/src/index.ts）：transform 在 analyzeFileAsync 之后
 * 消费 service `getPathEnvLoadErrors()`，把每条失败转成 `nudo:env-unresolved`
 * warning —— 与 CLI check / CLI test / LSP 同源同码同文案
 * （`path env failed to load: <path> — <error>`）。
 *
 * 负控制：未声明该 env 的文件不得被同目录的失败误伤；无 @nudo:env 的文件不报。
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

const BAD_ENV_SRC = `/// @nudo:env ./definitely-missing-env.js
export function f() {
  return 1;
}
`;
const PLAIN_SRC = `export function g() {
  return 2;
}
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-474-"));
  writeFileSync(join(dir, "bad-env.js"), BAD_ENV_SRC, "utf-8");
  writeFileSync(join(dir, "plain.js"), PLAIN_SRC, "utf-8");
  return dir;
}

describe("Bug 474: vite-plugin 报出 path-env 加载失败", () => {
  it("@nudo:env 指向缺失文件 → 构建期 warning（nudo:env-unresolved）", async () => {
    const dir = fixture();
    try {
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      const filePath = join(dir, "bad-env.js");
      const result = await transformOf(plugin).call(ctx, BAD_ENV_SRC, filePath);
      expect(result).toBeNull(); // 插件不改产物
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("path env failed to load");
      expect(msgs).toContain("definitely-missing-env.js");
      expect(msgs).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：同目录未声明该 env 的文件不得被误伤", async () => {
    const dir = fixture();
    try {
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      // 先分析声明了坏 env 的文件（失败进进程级错误表）
      await transformOf(plugin).call(ctx, BAD_ENV_SRC, join(dir, "bad-env.js"));
      const plainMsgs: string[] = [];
      const ctx2 = { warn: (m: string) => plainMsgs.push(String(m)), error: vi.fn() };
      await transformOf(plugin).call(ctx2, PLAIN_SRC, join(dir, "plain.js"));
      expect(plainMsgs.join("\n")).not.toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：无 @nudo:env 的文件不产生 env 告警", async () => {
    const dir = fixture();
    try {
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      await transformOf(plugin).call(ctx, PLAIN_SRC, join(dir, "plain.js"));
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).not.toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
