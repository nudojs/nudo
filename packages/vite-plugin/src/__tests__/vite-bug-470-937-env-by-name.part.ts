/**
 * Bug 470 / 937 回归（vite-plugin 面）：service 侧**按名字**发的 env 诊断
 * （未知 env 名 / 非字符串 env 项）记录的 path 是**名字本身**，不是解析后的
 * 绝对路径 ⇒ vite-plugin 原先只按 `resolvePath(baseDir, name)` 过滤 ⇒ 这类
 * 诊断在构建日志里被整条吃掉（env 静默不生效，零提示）。
 *
 * 与 LSP 面（packages/lsp/src/validation.ts envUnresolvedDiags）同口径：
 * 按**本文件自己的 env 名单**匹配 ⇒ 同目录别的文件的无 path 诊断不会误吸。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

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

/** 未知 env 名（词字符形态——指令文法只收 `\w+` 或 path 形态） */
const UNKNOWN_ENV_SRC = `/// @nudo:env bogusenvname
export function f() {
  return 1;
}
`;
const OTHER_ENV_SRC = `/// @nudo:env otherunknownenv
export function g() {
  return 2;
}
`;

describe("Bug 470/937 vite-plugin：按名字发的 env 诊断不再被过滤掉", () => {
  it("未知 env 名 ⇒ 构建期 warning（nudo:env-unresolved）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-470-"));
    try {
      writeFileSync(join(dir, "probe.js"), UNKNOWN_ENV_SRC, "utf-8");
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      const filePath = join(dir, "probe.js");
      await transformOf(plugin).call(ctx, UNKNOWN_ENV_SRC, filePath);
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("path env failed to load");
      expect(msgs).toContain("bogusenvname");
      expect(msgs).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：同目录别的文件的无 path 诊断不误吸", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-470b-"));
    try {
      writeFileSync(join(dir, "other.js"), OTHER_ENV_SRC, "utf-8");
      writeFileSync(join(dir, "probe.js"), UNKNOWN_ENV_SRC, "utf-8");
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      // 先分析声明了另一个未知名 env 的文件（失败进进程级错误表）
      await transformOf(plugin).call(ctx, OTHER_ENV_SRC, join(dir, "other.js"));
      const msgs: string[] = [];
      const ctx2 = { warn: (m: string) => msgs.push(String(m)), error: vi.fn() };
      await transformOf(plugin).call(ctx2, UNKNOWN_ENV_SRC, join(dir, "probe.js"));
      expect(msgs.join("\n")).not.toContain("otherunknownenv");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
