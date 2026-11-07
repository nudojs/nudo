/**
 * Bug 1018 —— vite-plugin 的 `include` / `exclude` **选项**按**绝对模块 id**匹配
 * ⇒ **项目相对 glob 静默失效** ⇒ `exclude: ["other/**"]` 不排除（仍报错 / 假红），
 * `include: ["src/**"]` 把**整份分析**静默归零（假绿）⇒ 与**同名**的项目配置
 * `nudo.analysis.include` / `nudo.analysis.exclude` **判定相反**。
 *
 * 根因：选项的匹配基准是 Vite 原始 module id（绝对路径），而共享 glob 编译器
 * 产出的正则是**锚定**的（`packages/service/src/glob.ts`）⇒ `src/**` 对
 * `/abs/proj/src/a.js` 永不命中；插件又拿不到 `config.root`（缺 `configResolved`）
 * ⇒ 无法相对化。
 *
 * 修法：`scope.ts` 的 `scopeDecision` 用**双口径**匹配 —— 同时对
 * 「相对 `config.root` 的路径」与「绝对路径」求值 ⇒ 与
 * `packages/service/src/analysis-scope.ts` 的 `excludeHit` / `includeHit`
 * **同口径**（同名同语法 ⇒ 判定一致）。
 *
 * 钉：插件选项的相对 glob 与项目配置的相对 glob **判定一致**。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

/** L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。 */
const SRC = `export function risky(x) {
  return x + 1;
}
export function riskyB(x) {
  return x.name;
}
`;

function fixture(name: string, nudoConfig?: unknown): { dir: string; srcId: string; otherId: string } {
  const dir = mkdtempSync(join(tmpdir(), `nudo-vite-1018-${name}-`));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "other"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `bug1018-${name}`, private: true, ...(nudoConfig ? { nudo: nudoConfig } : {}) }),
    "utf-8",
  );
  const srcId = join(dir, "src", "a.js");
  const otherId = join(dir, "other", "b.js");
  writeFileSync(srcId, SRC, "utf-8");
  writeFileSync(otherId, SRC, "utf-8");
  return { dir, srcId, otherId };
}

/** 记录工程根（Vite 的 `configResolved` 钩子）；HEAD 版没有该钩子 ⇒ 跳过。 */
function withRoot(plugin: Plugin, root: string | undefined): void {
  const hook = plugin.configResolved as unknown as ((c: unknown) => void) | undefined;
  if (typeof hook === "function") hook.call({}, { root });
}

async function diagnosticsOf(plugin: Plugin, code: string, id: string): Promise<string[]> {
  const warnFn = vi.fn();
  const errorFn = vi.fn();
  const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };
  await transformOf(plugin).call(ctx, code, id);
  return [
    ...warnFn.mock.calls.map((c) => String(c[0])),
    ...errorFn.mock.calls.map((c) => String(c[0])),
  ];
}

describe("Bug 1018 —— include / exclude 按「绝对路径 + 项目相对路径」双口径匹配", () => {
  it("exclude: [\"other/**\"] ⇒ other/b.js 被排除（改前仍被分析并报错）", async () => {
    const { dir, otherId } = fixture("exclude");
    try {
      const plugin = nudoPlugin({ exclude: ["other/**"] });
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, SRC, otherId);
      expect(diags.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("include: [\"src/**\"] ⇒ src/a.js 照常分析（改前整份分析被静默归零）", async () => {
    const { dir, srcId } = fixture("include");
    try {
      const plugin = nudoPlugin({ include: ["src/**"] });
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, SRC, srcId);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("include: [\"src/**\"] ⇒ other/b.js 不在白名单 ⇒ 不分析", async () => {
    const { dir, otherId } = fixture("include2");
    try {
      const plugin = nudoPlugin({ include: ["src/**"] });
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, SRC, otherId);
      expect(diags.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("绝对路径口径仍然有效（**/other/** 照常排除）", async () => {
    const { dir, otherId } = fixture("abs");
    try {
      const plugin = nudoPlugin({ exclude: ["**/other/**"] });
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, SRC, otherId);
      expect(diags.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("与项目配置面同口径：插件选项与 nudo.analysis.exclude 判定一致", async () => {
    const byOption = fixture("cmp-option");
    const byConfig = fixture("cmp-config", { analysis: { mode: "all", exclude: ["other/**"] } });
    try {
      const optPlugin = nudoPlugin({ exclude: ["other/**"] });
      withRoot(optPlugin, byOption.dir);
      const optDiags = await diagnosticsOf(optPlugin, SRC, byOption.otherId);

      const cfgPlugin = nudoPlugin();
      withRoot(cfgPlugin, byConfig.dir);
      const cfgDiags = await diagnosticsOf(cfgPlugin, SRC, byConfig.otherId);

      // 同名同语法 ⇒ 两个面的判定必须一致（都排除）。
      expect(optDiags.length).toBe(0);
      expect(cfgDiags.length).toBe(0);
    } finally {
      rmSync(byOption.dir, { recursive: true, force: true });
      rmSync(byConfig.dir, { recursive: true, force: true });
    }
  }, 30_000);
});
