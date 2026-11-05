/**
 * Bug 634 回归（vite-plugin 构建期）：check 通道必须施加 **inject 通道**
 * （`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局），与 CLI
 * `nudo check` 同源同口径。
 *
 * 病灶：本插件的 check 面此前只传 `loadModule` / `autoBind` / `skips`
 * ⇒ 注入**整段缺席** ⇒ 被 mock 掉的依赖退化成未知全局 ⇒ 构建期报
 * `nudo:entry-may-throw`（**假红**：同一份文件 `nudo check` 判绿、
 * 构建日志判红）。
 *
 * 修法（packages/vite-plugin/src/index.ts）：新增 `buildViteCheckInjection`
 * （模块图 + env 模块 + `@nudo:mock-module` 覆盖 + `@nudo:mock` 表 +
 * 行内指令表），按 CLI 的口径同时喂 `modules` 与 `inject`。
 *
 * 负控制：真的没有 mock 的文件，入口 may-throw 诊断**仍应**出现（不得把
 * 门禁整体关掉）。
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

const MOCKED_SRC = `/**
 * @nudo:mock dep = (x) => x
 */
export function f() {
  return dep(1);
}
`;

/** 无 mock 的对照：入口读一个不存在的全局 ⇒ 真的可能抛 */
const UNMOCKED_SRC = `export function g() {
  return notDefinedAnywhere(1);
}
`;

describe("Bug 634: vite-plugin check 面施加 inject 通道（@nudo:mock 生效）", () => {
  it("@nudo:mock 覆盖的依赖不得再报 nudo:entry-may-throw（与 CLI 同口径：绿）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-634-"));
    try {
      const file = join(dir, "lib.js");
      writeFileSync(file, MOCKED_SRC, "utf-8");
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      await transformOf(plugin).call(ctx, MOCKED_SRC, file);
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).not.toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：没有 mock 的入口仍报 nudo:entry-may-throw（门禁未被关掉）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-634b-"));
    try {
      const file = join(dir, "g.js");
      writeFileSync(file, UNMOCKED_SRC, "utf-8");
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      await transformOf(plugin).call(ctx, UNMOCKED_SRC, file);
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
