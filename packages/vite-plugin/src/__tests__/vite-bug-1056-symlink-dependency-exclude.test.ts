/**
 * Bug 1056 —— 默认排除的「node_modules 段」规则**匹配不到软链工作区依赖的真实路径**
 * ⇒ Vite 构建期对**别的包源码**报错，而同项目的 `nudo check` 是绿的
 * ⇒ **跨面自相矛盾 + 假红**。
 *
 * 根因：Vite 对**软链依赖**给的 module id 是 **realpath**
 * （`node_modules/dep → ../dep-pkg` ⇒ id = `<root>/dep-pkg/index.js`）⇒
 * 路径里**没有** `node_modules` 段 ⇒ 默认排除失效 ⇒ 别的包源码被当项目源码分析。
 *
 * 修法：`scope.ts` 的 `scopeDecision` 在排除判定**之前**把 id 归一化成
 * **依赖图视角** —— realpath 落在某个 `node_modules` 软链的解析目标下时，
 * 还原成依赖图里那条路径（`<root>/node_modules/dep/index.js`）⇒ 默认排除照常命中；
 * 依赖（软链依赖 / 物理目录依赖 / 工程根之外）**一律排除**。
 *
 * 钉：软链依赖 ⇒ 零诊断；物理目录依赖 ⇒ 零诊断（两者一致）；项目源码照常分析。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

/** 会报 `nudo:entry-may-throw` 的入口面（读取未约束成员）。 */
const RISKY = `export function risky(u) {
  return u.name;
}
`;

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

/**
 * 夹具：`node_modules/dep` → `../dep-pkg`（软链工作区依赖的常规形态）。
 * 返回 realpath 形态的 id（Vite 实际交给插件的那个）。
 */
function symlinkFixture(): { dir: string; realId: string; linkId: string; srcId: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-1056-link-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug1056-link", private: true }),
    "utf-8",
  );
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  mkdirSync(join(dir, "dep-pkg"), { recursive: true });
  writeFileSync(join(dir, "dep-pkg", "index.js"), RISKY, "utf-8");
  symlinkSync("../dep-pkg", join(dir, "node_modules", "dep"), "dir");
  mkdirSync(join(dir, "src"), { recursive: true });
  const srcId = join(dir, "src", "main.js");
  writeFileSync(srcId, RISKY, "utf-8");
  const linkId = join(dir, "node_modules", "dep", "index.js");
  return { dir, realId: realpathSync(linkId), linkId, srcId };
}

/** 夹具：`node_modules/dep2` 是**物理目录**（软链的公平对照组）。 */
function physicalFixture(): { dir: string; depId: string; srcId: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-1056-phys-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug1056-phys", private: true }),
    "utf-8",
  );
  mkdirSync(join(dir, "node_modules", "dep2"), { recursive: true });
  const depId = join(dir, "node_modules", "dep2", "index.js");
  writeFileSync(depId, RISKY, "utf-8");
  mkdirSync(join(dir, "src"), { recursive: true });
  const srcId = join(dir, "src", "main.js");
  writeFileSync(srcId, RISKY, "utf-8");
  return { dir, depId, srcId };
}

describe("Bug 1056 —— 软链依赖（realpath id）不得被当项目源码分析", () => {
  it("软链依赖的 realpath id ⇒ 零诊断（改前报 entry-may-throw）", async () => {
    const { dir, realId } = symlinkFixture();
    try {
      const plugin = nudoPlugin();
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, RISKY, realId);
      expect(diags.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("软链依赖的 node_modules 路径 id ⇒ 零诊断", async () => {
    const { dir, linkId } = symlinkFixture();
    try {
      const plugin = nudoPlugin();
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, RISKY, linkId);
      expect(diags.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("物理目录依赖 ⇒ 零诊断（与软链形态一致）", async () => {
    const { dir, depId } = physicalFixture();
    try {
      const plugin = nudoPlugin();
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, RISKY, depId);
      expect(diags.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("对照组：项目源码照常分析（排除没有过宽）", async () => {
    const { dir, srcId } = symlinkFixture();
    try {
      const plugin = nudoPlugin();
      withRoot(plugin, dir);
      const diags = await diagnosticsOf(plugin, RISKY, srcId);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
