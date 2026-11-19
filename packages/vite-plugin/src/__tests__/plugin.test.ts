import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin, { type NudoPluginOptions } from "../index.ts";
import { setProjectRoot } from "../scope.ts";

// checkSource 崩溃注入（回归）：vi.hoisted 让 vi.mock 工厂可读写
// 状态；默认透传真实实现，既有用例行为不变。注意：vite-node 的模块
// namespace 导出不可枚举（`{...actual}` 会得到空模块），必须按
// getOwnPropertyNames 逐键拷贝再覆盖 checkSource。
const checkGate = vi.hoisted(() => ({
  shouldThrow: false,
  errorMessage: "injected assembly failure",
  calls: [] as string[],
}));

vi.mock("@nudojs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nudojs/core")>();
  const mock: Record<string, unknown> = Object.create(null);
  const source = actual as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(source)) {
    mock[key] = source[key];
  }
  mock.checkSource = (...args: Parameters<typeof actual.checkSource>) => {
    checkGate.calls.push(args[0]);
    if (checkGate.shouldThrow) throw new Error(checkGate.errorMessage);
    return actual.checkSource(...args);
  };
  return mock;
});

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: unknown[]) => unknown {
  if (typeof h === "function") return h as (...args: unknown[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: unknown[]) => unknown }).handler;
  }
  throw new Error("plugin hook missing");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

describe("vite-plugin-nudo", () => {
  it("creates a plugin with correct name", () => {
    const plugin = nudoPlugin();
    expect(plugin.name).toBe("vite-plugin-nudo");
  });

  it("returns null for files without @nudo: directives", async () => {
    const plugin = nudoPlugin();
    const result = await transformOf(plugin).call({}, "const x = 1;", "/test/file.js");
    expect(result).toBeNull();
  });

  it("analyzes files that only declare @nudo:contract (gate aligned with LSP)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-"));
    try {
      writeFileSync(
        join(dir, "shapes.nudo.js"),
        `export const positive = number().gt(0);\n`,
        "utf-8",
      );
      const source = `/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return x;
}
const r = needsPositive(-1);
`;
      const filePath = join(dir, "refine-only.js");
      writeFileSync(filePath, source, "utf-8");

      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn() };
      const result = await transformOf(plugin).call(ctx, source, filePath);
      expect(result).toBeNull();
      expect(warnFn).toHaveBeenCalled();
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("constraint-violated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for node_modules files", async () => {
    const plugin = nudoPlugin();
    const result = await transformOf(plugin).call({}, "const x = 1;", "/node_modules/pkg/file.js");
    expect(result).toBeNull();
  });

  it("analyzes files with entry surfaces and reports warnings", async () => {
    const plugin = nudoPlugin();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn() };

    // L2 entry-may-throw 仍是 check 门禁（@nudo:case 已降为 debug/test 面）
    const source = `
export function getName(user) {
  return user.name;
}
`;
    const result = await transformOf(plugin).call(ctx, source, "/test/throws.js");
    expect(result).toBeNull();
    expect(warnFn).toHaveBeenCalled();
  });

  it("respects custom include patterns", async () => {
    const plugin = nudoPlugin({ include: ["**/*.typed.js"] });
    const result = await transformOf(plugin).call({}, "const x = 1;", "/test/file.js");
    expect(result).toBeNull();
  });

  it("clears cache on buildStart", () => {
    const plugin = nudoPlugin();
    hookFn(plugin.buildStart).call({});
    // No error means cache cleared successfully
  });

  it("reports summary on buildEnd", () => {
    const plugin = nudoPlugin();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    hookFn(plugin.buildStart).call({});
    hookFn(plugin.buildEnd).call({});
    consoleSpy.mockRestore();
  });

  it("errors when failOnError is true and diagnostics have errors", async () => {
    const plugin = nudoPlugin({ failOnError: true });
    const errorFn = vi.fn();
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: errorFn };

    // L2 entry-may-throw 默认 error 级
    const source = `
export function getName(user) {
  return user.name;
}
`;
    await transformOf(plugin).call(ctx, source, "/test/fail.js");
    expect(errorFn).toHaveBeenCalled();
  });

  it("failOnError actually aborts even though this.error throws", async () => {
    const plugin = nudoPlugin({ failOnError: true });
    const warnFn = vi.fn();
    // 真实 Rollup/Vite 语义：this.error 抛出 RollupError
    const errorFn = vi.fn((m: string) => {
      throw new Error(m);
    });
    const ctx = { warn: warnFn, error: errorFn };

    const source = `
export function getName(user) {
  return user.name;
}
`;
    // this.error 的 throw 不得被 catch 吞掉降级成 warn
    await expect(
      transformOf(plugin).call(ctx, source, "/test/fail.js"),
    ).rejects.toThrow(/entry-may-throw|name/);
    expect(errorFn).toHaveBeenCalled();
  });
});

describe("vite-plugin-nudo glob matching", () => {
  // 稳定产出 check 诊断（L2 entry-may-throw），用来证明文件被分析过
  const directiveSource = `
export function getName(user) {
  return user.name;
}
`;

  async function wasAnalyzed(id: string, options: NudoPluginOptions = {}): Promise<boolean> {
    const plugin = nudoPlugin(options);
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn() };
    const result = await transformOf(plugin).call(ctx, directiveSource, id);
    return result === null && warnFn.mock.calls.length > 0;
  }

  // 带 root 的判定（字面量 include 的路径形态需要项目相对口径）：
  // configResolved 会写模块级 root ⇒ 每个用例后复位，别污染后续无 root 的用例。
  async function wasAnalyzedUnderRoot(
    id: string,
    root: string,
    options: NudoPluginOptions,
  ): Promise<boolean> {
    const plugin = nudoPlugin(options);
    hookFn(plugin.configResolved).call(plugin, { root });
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn() };
    try {
      const result = await transformOf(plugin).call(ctx, directiveSource, id);
      return result === null && warnFn.mock.calls.length > 0;
    } finally {
      setProjectRoot(undefined);
    }
  }

  it("matches **/*.js at any depth by default", async () => {
    expect(await wasAnalyzed("/file.js")).toBe(true);
    expect(await wasAnalyzed("/project/src/nested/mod.js")).toBe(true);
  });

  it("默认 include 覆盖 isNudoTargetPath 六后缀（Bug 56：cjs/mts/cts 不再静默跳过）", async () => {
    expect(await wasAnalyzed("/test/file.mjs")).toBe(true);
    expect(await wasAnalyzed("/test/file.cjs")).toBe(true);
    expect(await wasAnalyzed("/test/file.mts")).toBe(true);
    expect(await wasAnalyzed("/test/file.cts")).toBe(true);
    expect(await wasAnalyzed("/test/file.ts")).toBe(true);
    expect(await wasAnalyzed("/test/file.d.ts")).toBe(false);
    expect(await wasAnalyzed("/test/file.d.mts")).toBe(false);
  });

  it("supports **/*.mjs include patterns", async () => {
    const options = { include: ["**/*.mjs"] };
    expect(await wasAnalyzed("/test/file.mjs", options)).toBe(true);
    expect(await wasAnalyzed("/project/src/deep/file.mjs", options)).toBe(true);
    expect(await wasAnalyzed("/test/file.js", options)).toBe(false);
  });

  it("supports **/*.ts include patterns", async () => {
    const options = { include: ["**/*.ts"] };
    expect(await wasAnalyzed("/src/util.ts", options)).toBe(true);
    expect(await wasAnalyzed("/src/util.js", options)).toBe(false);
    expect(await wasAnalyzed("/src/component.tsx", options)).toBe(false);
  });

  it("excludes **/node_modules/** at any depth by default", async () => {
    expect(await wasAnalyzed("/project/node_modules/pkg/index.js")).toBe(false);
    expect(await wasAnalyzed("/project/packages/a/node_modules/dep/lib.js")).toBe(false);
  });

  it("excludes **/<dir>/** directory segments without false positives", async () => {
    const options = { include: ["**/*.js"], exclude: ["**/fixtures/**"] };
    expect(await wasAnalyzed("/test/fixtures/case.js", options)).toBe(false);
    expect(await wasAnalyzed("/test/case.js", options)).toBe(true);
    // "my-fixtures" is not the "fixtures" segment, so it must stay included.
    expect(await wasAnalyzed("/test/my-fixtures/case.js", options)).toBe(true);
  });

  it("gives exclude precedence over include", async () => {
    const options = { include: ["**/*.js"], exclude: ["**/vendor/**"] };
    expect(await wasAnalyzed("/src/vendor/lib.js", options)).toBe(false);
    expect(await wasAnalyzed("/src/lib.js", options)).toBe(true);
  });

  it("字面量 exclude 保持子串语义（黑名单要命中任意深度的同名目录）", async () => {
    const excluded = { include: ["**/*.js"], exclude: ["snapshots"] };
    expect(await wasAnalyzed("/src/snapshots/old.js", excluded)).toBe(false);
    expect(await wasAnalyzed("/src/old.js", excluded)).toBe(true);
  });

  it("BUG-187 字面量 include 按路径形态（`src` 不吃兄弟目录 `src-other`）", async () => {
    const options = { include: ["src"] };
    expect(await wasAnalyzedUnderRoot("/proj/src/a.js", "/proj", options)).toBe(true);
    // 子串语义会把这三个一并放进白名单（同模式写进 package.json 时服务闸门
    // 判 false ⇒ 构建期与 LSP / watch 结论相反）
    expect(await wasAnalyzedUnderRoot("/proj/src-other/b.js", "/proj", options)).toBe(false);
    expect(await wasAnalyzedUnderRoot("/proj/my-src/c.js", "/proj", options)).toBe(false);
    expect(await wasAnalyzedUnderRoot("/proj/srcx.js", "/proj", options)).toBe(false);
  });

  it("BUG-187 字面量 include 命中整棵子树（`src` ⇒ `src/deep/a.js`）", async () => {
    expect(await wasAnalyzedUnderRoot("/proj/src/deep/a.js", "/proj", { include: ["src"] })).toBe(
      true,
    );
  });
});

describe("vite-plugin-nudo check pipeline failures ()", () => {
  // 稳定进入 check 面（导出入口）；与上方用例同源
  const entrySource = `
export function getName(user) {
  return user.name;
}
`;

  beforeEach(() => {
    checkGate.calls.length = 0;
    checkGate.shouldThrow = false;
  });

  it("checkSource 抛错时构建有 warning 且不崩（不静默吞错）", async () => {
    checkGate.shouldThrow = true;
    const plugin = nudoPlugin();
    const warnFn = vi.fn();
    const errorFn = vi.fn();
    const ctx = { warn: warnFn, error: errorFn };

    const result = await transformOf(plugin).call(ctx, entrySource, "/test/check-crash.js");

    // 门禁崩溃不得让 transform 崩、也不得静默：插件上下文 warn（非 console）
    expect(result).toBeNull();
    const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msgs).toMatch(/check failed for .*check-crash\.js: injected assembly failure/);
    // failOnError 默认 false：崩溃降级 warn，不红构建
    expect(errorFn).not.toHaveBeenCalled();
  });

  it("checkSource 抛错 + failOnError=true 时用 this.error 红构建", async () => {
    checkGate.shouldThrow = true;
    const plugin = nudoPlugin({ failOnError: true });
    const warnFn = vi.fn();
    // 真实 Rollup/Vite 语义：this.error 抛出 RollupError
    const errorFn = vi.fn((m: string) => {
      throw new Error(m);
    });
    const ctx = { warn: warnFn, error: errorFn };

    await expect(
      transformOf(plugin).call(ctx, entrySource, "/test/check-crash.js"),
    ).rejects.toThrow(/check failed for .*check-crash\.js/);
    expect(errorFn).toHaveBeenCalled();
  });

  it("同一 build 会话内未变文件不重跑 check 推断链（会话缓存）", async () => {
    const plugin = nudoPlugin();
    const ctx = { warn: vi.fn(), error: vi.fn() };
    const transform = transformOf(plugin);
    const counted = () => checkGate.calls.filter((f) => f === "/test/cache-hit.js").length;

    await transform.call(ctx, entrySource, "/test/cache-hit.js");
    expect(counted()).toBe(1);

    // 重复 transform 同一 source（如 client/SSR 双环境）：命中缓存不重跑
    await transform.call(ctx, entrySource, "/test/cache-hit.js");
    expect(counted()).toBe(1);
    // 诊断照常回放（缓存只省推断，不省上报）
    expect((ctx.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

    // source 变更 → 缓存 miss，重新检查
    await transform.call(ctx, entrySource.replace("user.name", "user.id"), "/test/cache-hit.js");
    expect(counted()).toBe(2);
  });
});
