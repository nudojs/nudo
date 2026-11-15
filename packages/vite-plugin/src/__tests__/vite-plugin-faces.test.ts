/**
 * 模块套件：vite 插件面（诊断/level/harvest/env/symlink/query/virtual）。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { clearPathEnvCaches } from "@nudojs/service";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { type Plugin, build, createLogger } from "vite";
import nudoPlugin from "../index.ts";
import { scopeDecision, setProjectRoot } from "../scope.ts";

beforeEach(() => {
  clearPathEnvCaches();
  setProjectRoot(undefined);
});
import { assembleCheckOutcome } from "../check-assembly.ts";

// ---------------------------------------------------------------------------
// buildEnd 汇总行走 Vite logger（受 build.logLevel 管辖）
// ---------------------------------------------------------------------------
describe("buildEnd 汇总行走 Vite logger（受 build.logLevel 管辖）", () => {
/**
 * vite-plugin 的 `buildEnd` 汇总行走 `console.log` ⇒ **绕过 Vite 的
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

describe("buildEnd 汇总行走 Vite logger（受 build.logLevel 管辖）", () => {
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
});

// ---------------------------------------------------------------------------
// include / exclude 按「绝对路径 + 项目相对路径」双口径匹配
// ---------------------------------------------------------------------------
describe("include / exclude 按「绝对路径 + 项目相对路径」双口径匹配", () => {
/**
 * vite-plugin 的 `include` / `exclude` **选项**按**绝对模块 id**匹配
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

describe("include / exclude 按「绝对路径 + 项目相对路径」双口径匹配", () => {
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
});

// ---------------------------------------------------------------------------
// 软链依赖（realpath id）不得被当项目源码分析
// ---------------------------------------------------------------------------
describe("软链依赖（realpath id）不得被当项目源码分析", () => {
/**
 * 默认排除的「node_modules 段」规则**匹配不到软链工作区依赖的真实路径**
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

describe("软链依赖（realpath id）不得被当项目源码分析", () => {
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
});

// ---------------------------------------------------------------------------
// 软链工程根下的源文件不得被判「依赖」
// ---------------------------------------------------------------------------
describe("软链工程根下的源文件不得被判「依赖」", () => {
/**
 * 工程根含**软链**时，全部源文件被判「依赖」⇒ 插件**静默空转**
 * （零诊断、零构建失败、零提示 = 假绿）。
 *
 * 根因（`scope.ts` 的 `scopePath`）：`projectRootAbs()` 只做 `path.resolve`
 * （**不解析软链**），而「在工程根之内」的判定拿的是 **realpath**
 * （`realpathSync`）⇒ 软链 root 与文件 realpath **永不同前缀** ⇒
 * `outsideRoot` 恒为 true ⇒ `isDependency = true` ⇒ `scopeDecision` 直接
 * `skip:"exclude"` ⇒ **什么都不分析**。
 *
 * Vite 的 `config.root` 同样只做 `path.resolve`（**不解析软链**）⇒ 现实触发面：
 * macOS 的 `/tmp`→`/private/tmp`、`/var`→`/private/var`（`root: "/tmp/app"`）、
 * `vite build --root <软链>`、CI / 容器里挂在软链下的 checkout、`src` 本身是软链。
 *
 * 修法：「在 root 之内」的判定**两侧都取 realpath**（root 也解析软链）⇒ 软链
 * root 与其下文件（id 是软链形态还是 realpath 形态都算）都判「在 root 之内」。
 *
 * 附带（同一处）：`setProjectRoot` 是**模块级全局状态** ⇒ 同进程内第二个 Vite
 * config 会覆盖第一个的 root ⇒ 第一个实例的文件全被判「root 之外」⇒ 同样静默
 * 空转。⇒ root 改为**按插件实例持有**（判定时显式传入），模块级记录只作兜底。
 *
 * 钉：软链 root 下的源文件照常分析；工程根之外的文件仍被排除（不过宽）；
 * 同进程两个插件实例的 root 互不覆盖。
 */








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

/** 记录工程根（Vite 的 `configResolved` 钩子）。 */
function withRoot(plugin: Plugin, root: string | undefined): void {
  const hook = plugin.configResolved as unknown as ((c: unknown) => void) | undefined;
  if (typeof hook === "function") hook.call({}, { root });
}

/** 会报 `nudo:entry-may-throw` 的入口面（读取未约束成员）⇒ 证明「真的分析了」。 */
const RISKY = `export function risky(u) {
  return u.name;
}
`;

/**
 * 夹具：`<base>/real` 是真实工程目录，`<base>/link → real` 是**软链**工程根
 * （Vite 的 `config.root` 形态：只 resolve，不解析软链）。
 */
function symlinkRootFixture(): {
  base: string;
  realRoot: string;
  linkRoot: string;
  linkId: string;
  realId: string;
  outsideId: string;
} {
  const base = mkdtempSync(join(tmpdir(), "nudo-vite-1088-"));
  writeFileSync(
    join(base, "package.json"),
    JSON.stringify({ name: "bug1088-symlink-root", private: true }),
    "utf-8",
  );
  const realRoot = join(base, "real");
  mkdirSync(join(realRoot, "src"), { recursive: true });
  writeFileSync(join(realRoot, "src", "main.js"), RISKY, "utf-8");
  const linkRoot = join(base, "link");
  symlinkSync(realRoot, linkRoot, "dir");
  // 工程根**之外**的同形文件（对照组：排除规则不得被放宽）
  const outsideDir = join(base, "outside");
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, "main.js"), RISKY, "utf-8");
  return {
    base,
    realRoot,
    linkRoot,
    linkId: join(linkRoot, "src", "main.js"),
    realId: join(realRoot, "src", "main.js"),
    outsideId: join(outsideDir, "main.js"),
  };
}

afterEach(() => {
  // 模块级 root 是**兜底**状态 ⇒ 每个用例后清干净，避免用例间串味
  setProjectRoot(undefined);
});

describe("软链工程根下的源文件不得被判「依赖」", () => {
  it("软链 root + 软链形态 id ⇒ 分析（改前 skip:exclude）", () => {
    const { base, linkRoot, linkId } = symlinkRootFixture();
    try {
      setProjectRoot(linkRoot);
      expect(scopeDecision(linkId, RISKY)).toEqual({ skip: false, reason: "analyze" });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("软链 root + realpath 形态 id ⇒ 分析", () => {
    const { base, linkRoot, realId } = symlinkRootFixture();
    try {
      setProjectRoot(linkRoot);
      expect(scopeDecision(realId, RISKY)).toEqual({ skip: false, reason: "analyze" });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("对照组：非软链 root ⇒ 分析（行为不变）", () => {
    const { base, realRoot, realId } = symlinkRootFixture();
    try {
      setProjectRoot(realRoot);
      expect(scopeDecision(realId, RISKY)).toEqual({ skip: false, reason: "analyze" });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("工程根之外的文件仍被排除（排除规则没有被放宽）", () => {
    const { base, linkRoot, outsideId } = symlinkRootFixture();
    try {
      setProjectRoot(linkRoot);
      expect(scopeDecision(outsideId, RISKY)).toEqual({ skip: true, reason: "exclude" });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("插件层：软链 root 下的源文件照常出诊断（不再静默空转）", async () => {
    const { base, linkRoot, linkId } = symlinkRootFixture();
    try {
      const plugin = nudoPlugin();
      withRoot(plugin, linkRoot);
      const warnFn = vi.fn();
      const errorFn = vi.fn();
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };
      await transformOf(plugin).call(ctx, RISKY, linkId);
      const diags = [
        ...warnFn.mock.calls.map((c) => String(c[0])),
        ...errorFn.mock.calls.map((c) => String(c[0])),
      ];
      expect(diags.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);

  it("同进程两个插件实例 ⇒ 各自的 root 互不覆盖（模块级全局状态不再串味）", async () => {
    const { base, linkRoot, linkId } = symlinkRootFixture();
    const otherBase = mkdtempSync(join(tmpdir(), "nudo-vite-1088-other-"));
    try {
      const first = nudoPlugin();
      const second = nudoPlugin();
      withRoot(first, linkRoot);
      // 第二个实例的 configResolved 会覆盖模块级 root（改前的行为）
      withRoot(second, otherBase);

      const warnFn = vi.fn();
      const errorFn = vi.fn();
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };
      await transformOf(first).call(ctx, RISKY, linkId);
      const diags = [
        ...warnFn.mock.calls.map((c) => String(c[0])),
        ...errorFn.mock.calls.map((c) => String(c[0])),
      ];
      expect(diags.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(otherBase, { recursive: true, force: true });
    }
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// check 通道的无位置 issue 不再被伪造成 :1:0
// ---------------------------------------------------------------------------
describe("check 通道的无位置 issue 不再被伪造成 :1:0", () => {
/**
 * vite-plugin 的 **check 通道** issue 无 `line` 时被伪造成 `:1:0`
 * ⇒ 构建日志把「另一个文件不可读」这类**无源位置**的门禁诊断定位到
 * **当前文件第 1 行第 0 列**。
 *
 * 根因（`check-assembly.ts`）：`const line = i.line ?? 1;` ⇒ core 产出的
 * **无位置** check issue（`nudo:module-unreadable`「依赖模块存在但不可读」/
 * `nudo:internal` / `nudo:opaque-result` …）被兜底成第 1 行。
 *
 * 三面不一致：
 * - 本包 `report.ts` 的 `renderLocation` 契约明写「**不编造**第 1 行
 * （`:1:0`）」；
 * - CLI 人类面（`core/src/algebra/check-report.ts`：`i.line != null ?
 * \`L${i.line}\` : ""`）无位置就不打位置；
 * - 的既有钉：占位 range（`line: 0`）渲染时整段省略位置。
 *
 * 修法：**不编造位置** —— 无 `line` 时用 service 的占位约定
 * `{line: 0, column: 0}` ⇒ `renderLocation`（`line <= 0` ⇒ 省略
 * `:line:col`）统一省略位置 ⇒ 与 CLI 同口径。
 *
 * 钉：check 通道的无位置 issue 不再渲染成 `:1:0`；**有**真位置的 issue 仍
 * 渲染 `:line:col`（不回归）。
 */








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

/**
 * 依赖模块**存在但不可解析** ⇒ core 产出 `nudo:opaque-result`（**不带 `line`**
 * 的 check issue；core 侧 `checkSource` 的 issue 面同样无 `line`）。
 */
const OPAQUE = `import { y } from "./nope.js";
export function useY() {
  return y;
}
`;

/** 会报 `nudo:entry-may-throw` 的入口面（**带真位置**）⇒ 对照组。 */
const RISKY = `export function risky(u) {
  return u.name;
}
`;

/** verbose 档 ⇒ info 级 check issue 也进显示路径（默认档只显示 error + warning）。 */
function projectWithVerboseDiagnostics(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug1089", private: true, nudo: { analysis: { diagnostics: "verbose" } } }),
    "utf-8",
  );
}

describe("check 通道的无位置 issue 不再被伪造成 :1:0", () => {
  it("无 `line` 的 check issue ⇒ range 用占位 0（不是编造的 1）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-1089-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, OPAQUE, "utf-8");
      const out = assembleCheckOutcome(id, OPAQUE);
      const opaque = out.diagnostics.find((d) => d.code === "nudo:opaque-result");
      expect(opaque, JSON.stringify(out.diagnostics)).toBeDefined();
      expect(opaque!.range.start.line).toBe(0);
      expect(opaque!.range.start.column).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("插件层：无位置的 check issue 渲染为「无位置」（不含 :1:0 / :0:0）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-1089-render-"));
    try {
      projectWithVerboseDiagnostics(dir);
      const id = join(dir, "entry.js");
      writeFileSync(id, OPAQUE, "utf-8");

      const plugin = nudoPlugin();
      const warns: string[] = [];
      const ctx = {
        warn: (m: string) => warns.push(String(m)),
        error: (m: string) => warns.push(String(m)),
        info: (m: string) => warns.push(String(m)),
      };
      await transformOf(plugin).call(ctx, OPAQUE, id);

      const opaqueMsg = warns.find((m) => m.includes("nudo:opaque-result"));
      expect(opaqueMsg, JSON.stringify(warns)).toBeDefined();
      // 无源位置 ⇒ 整段位置省略（既不写编造的 :1:0，也不写越界的 :0:0）
      expect(opaqueMsg).not.toContain(":1:0");
      expect(opaqueMsg).not.toContain(":0:0");
      expect(opaqueMsg).toMatch(/^\[nudo\] \S+ info: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("有真位置的 check issue 仍渲染 :line:col（不回归）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-1089-real-"));
    try {
      projectWithVerboseDiagnostics(dir);
      const id = join(dir, "entry.js");
      writeFileSync(id, RISKY, "utf-8");

      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const errorFn = vi.fn();
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };
      await transformOf(plugin).call(ctx, RISKY, id);
      const msgs = [
        ...warnFn.mock.calls.map((c) => String(c[0])),
        ...errorFn.mock.calls.map((c) => String(c[0])),
      ];
      const located = msgs.find((m) => m.includes("nudo:entry-may-throw"));
      expect(located, JSON.stringify(msgs)).toBeDefined();
      expect(located).toMatch(/:\d+:\d+ error: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// vite-plugin 的 ignoreThrows 与 CLI / LSP 同口径
// ---------------------------------------------------------------------------
describe("vite-plugin 的 ignoreThrows 与 CLI / LSP 同口径", () => {
/**
 * 回归（vite-plugin 构建期）：`package.json#nudo.check.ignoreThrows`
 * 必须与 **CLI / LSP 同口径**解析 —— 裸字符串 / 逗号分隔都生效。
 *
 * 病灶：`assembleCheckOutcome` 走 service 的 `checkConfig`，其 `ignoreThrows`
 * 是**严格 `string[]` 过滤**（`Array.isArray` + 逐项 `typeof === "string"`）
 * ⇒ 裸字符串 `"TypeError"` 被**静默丢成空表**、`["TypeError,RangeError"]`
 * 不切分（永远匹配不上任何 throw 类）⇒ 插件面该 throw 类照报 ⇒ **构建红**，
 * 而 CLI（`packages/nudojs/src/check-gate-config.ts` 的 `parseIgnoreThrows`）
 * 与 LSP（`packages/lsp/src/gate-config.ts` 的 `configIgnoreThrows`）都认这两种
 * 写法（绿）⇒ 同一份 `package.json` 三面三口径，`failOnError: true` 时直接
 * 中断构建。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts`）：`ignoreThrows` 改走与
 * CLI / LSP 同语义的 `parseIgnoreThrows`（`entryThrows` 仍走 `checkConfig`）。
 *
 * 负控制：**没被忽略**的 throw 类仍须报（门禁不得被整体关掉）。
 */







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

/** 读未约束属性的入口 ⇒ L2 判 `TypeError`（`x` 为 any ⇒ 属性链必抛）。 */
const THROWING_SRC = `export function boom(x) {
  return x.missing.deep;
}
`;

type Run = { warns: string[]; errors: string[]; thrown?: string; all: string };

async function run(dir: string, ignoreThrows: unknown): Promise<Run> {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "nudo-vite-bug-110",
      private: true,
      type: "module",
      nudo: { check: { ignoreThrows } },
    }),
    "utf-8",
  );
  const file = join(dir, "a.js");
  writeFileSync(file, THROWING_SRC, "utf-8");

  const plugin = nudoPlugin({ failOnError: true });
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    // 真实 Rollup/Vite 语义：this.error 抛异常
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
    info: () => {},
  };
  const out: Run = { warns, errors, all: "" };
  try {
    await transformOf(plugin).call(ctx, THROWING_SRC, file);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  out.all = [...warns, ...errors].join("\n");
  return out;
}

/**
 * 四种**文档认可**的写法（CLI / LSP 都生效）—— 插件面必须逐项相同。
 * 断言：该 throw 类被忽略 ⇒ 无 `nudo:entry-may-throw`，且构建不中断。
 */
const LEGAL_WRITINGS: Array<[label: string, raw: unknown]> = [
  ["裸字符串", "TypeError"],
  ["逗号分隔字符串", "TypeError,RangeError"],
  ["数组元素内含逗号", ["TypeError,RangeError"]],
  ["字符串数组", ["TypeError"]],
];

describe("vite-plugin 的 ignoreThrows 与 CLI / LSP 同口径", () => {
  for (const [label, raw] of LEGAL_WRITINGS) {
    it(`${label}（${JSON.stringify(raw)}）⇒ 该 throw 类不再报，构建不中断`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-110-"));
      try {
        const r = await run(dir, raw);
        expect(r.all).not.toContain("nudo:entry-may-throw");
        expect(r.errors).toHaveLength(0);
        expect(r.thrown).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("负控制：忽略的是**别的** throw 类 ⇒ TypeError 仍照报（门禁未被关掉）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-110-neg-"));
    try {
      const r = await run(dir, ["RangeError"]);
      expect(r.all).toContain("nudo:entry-may-throw");
      expect(r.errors.join("\n")).toContain("nudo:entry-may-throw");
      expect(r.thrown).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// 同名模块下 env ∪ harvest 必须合并（不得丢弃 harvest 专有导出）
// ---------------------------------------------------------------------------
describe("同名模块下 env ∪ harvest 必须合并（不得丢弃 harvest 专有导出）", () => {
/**
 * 回归（vite-plugin 构建期）：env 模块与 harvest 模块**同名**合并时
 * 必须走 `mergeHarvestUnderEnv`（同名槽 env 赢、harvest 填其余空位）。
 *
 * 病灶：`buildViteCheckInjection` 用**对象展开**
 * （`{...graph.modules, ...envMods}`）⇒ 同名模块下 harvest 的**非冲突导出
 * 被整体丢弃** ⇒ 插件面绑定缺失 ⇒ 类型退化成 `unknown` + **误导性**
 * `nudo:unknown-inference`，而 CLI 面（`nudo check`，已走
 * `mergeHarvestUnderEnv`）**无诊断、签名精确** ⇒ 同一个仓库
 * `nudo check` 绿 / `vite build` 红（的同族插件面）。
 *
 * 触发面：模块名与 env 键同名（`util` / `path` / `url` / `os` / `crypto` /
 * `events` / `stream` / `assert` … 都是真实存在的 npm 包名）。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts`）：模块表改走
 * `mergeHarvestUnderEnv(graph.modules, envMods)`（与 CLI / test / service 同源）。
 *
 * 负控制：harvest 与 env **都没有**的导出仍须报 `nudo:unknown-inference`
 * （门禁不得被整体关掉）。
 */







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

/**
 * 夹具：一个**与 env 键同名**的 npm 包 `util` —— harvest 只认得
 * `harvestOnly`；env（`@nudo:env node`）只认得 Node 内建 `util` 的导出。
 * 两者**不冲突** ⇒ 合并后必须**都保留**（对象展开会把 `harvestOnly` 丢掉）。
 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-111-"));
  const pkg = join(dir, "node_modules", "util");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "util", version: "1.0.0", types: "index.d.ts", main: "index.js" }),
    "utf-8",
  );
  writeFileSync(
    join(pkg, "index.d.ts"),
    "export declare function harvestOnly(): number;\n",
    "utf-8",
  );
  writeFileSync(join(pkg, "index.js"), "export function harvestOnly() { return 1; }\n", "utf-8");
  return dir;
}

/** `@nudo:env node` ⇒ env 模块表里有 `util`（Node 内建）——同名冲突的来源。 */
function src(imported: string): string {
  return `/// @nudo:env node
import { ${imported} } from "util";
export function use() {
  return ${imported}();
}
`;
}

type Run = { warns: string[]; errors: string[]; all: string };

async function run(dir: string, code: string): Promise<Run> {
  const file = join(dir, "app.js");
  writeFileSync(file, code, "utf-8");
  const plugin = nudoPlugin();
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => errors.push(String(m)),
    info: () => {},
  };
  await transformOf(plugin).call(ctx, code, file);
  return { warns, errors, all: [...warns, ...errors].join("\n") };
}

describe("同名模块下 env ∪ harvest 必须合并（不得丢弃 harvest 专有导出）", () => {
  it("harvest 专有导出可解析 ⇒ 不再误报 nudo:unknown-inference（与 CLI 同结论）", async () => {
    const dir = project();
    try {
      const r = await run(dir, src("harvestOnly"));
      expect(r.all).not.toContain("nudo:unknown-inference");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：env 与 harvest 都没有的导出仍报 nudo:unknown-inference", async () => {
    const dir = project();
    try {
      const r = await run(dir, src("notExportedAnywhere"));
      expect(r.all).toContain("nudo:unknown-inference");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// 项目级 env 按项目根解析（插件两个面同结论、非单调性消失）
// ---------------------------------------------------------------------------
describe("项目级 env 按项目根解析（插件两个面同结论、非单调性消失）", () => {
/**
 * 回归（vite-plugin 构建期）：**项目级** env（`package.json#nudo.env`）
 * 的**相对说明符**必须按**项目根**解析，而不是被 `env-loader` 的「进程级
 * 单槽基准」（= **最后一次** preload 的目录）带走。
 *
 * 病灶：`buildViteCheckInjection` 直接把 `collectEnvNames(..., true)` 的
 * **原始**名单喂给 `collectEnvGlobals` / `collectEnvModules`。service 的
 * preload 顺序是「项目级 → 文件级」⇒ 被检文件里只要有一行**文件级**
 * `@nudo:env`，解析基准就落在**文件目录** ⇒ 项目级 `"./env/web.ts"` 被解析成
 * `<fileDir>/env/web.ts` ⇒ 项目级全局（`MAGIC`）丢失 ⇒ 门禁面报
 * `may throw ReferenceError` / `never`，而**同一文件**的 evaluator 面仍是
 * `99` ⇒ 同一个插件的两个面互相打脸；且**多加一行无关的 `@nudo:env`** 就让
 * 结论从绿翻红（非单调）。CLI 全程绿（`assembleEnvs` 先按项目根绝对化）。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts`）：项目级说明符先按
 * `findProjectConfig(...)?.projectDir ?? dirname(id)` 绝对化，再与文件级名单
 * 合并（与 CLI `assembleEnvs` 同款）。
 *
 * 负控制：项目**没有**声明该 env 时，`MAGIC` 仍必须报 `ReferenceError`
 * （门禁不得被整体关掉 —— 证明上面的「无诊断」不是因为 env 面被静音）。
 */







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

const ENV_SRC = `export function defineEnv() {
  return { globals: { MAGIC: 99 } };
}
`;
const LOCAL_ENV_SRC = `export function defineEnv() {
  return { globals: { LOCAL: 1 } };
}
`;
/** 文件级 `//nudo:env` 只提供 `LOCAL` —— 与 `MAGIC` **无关**（非单调的开关）。 */
const FILE_ENV_LINE = `/// @nudo:env ./local-env.ts\n`;
const APP_SRC = `export function f() {
  return MAGIC;
}
`;

type Run = { warns: string[]; errors: string[]; all: string };

/** 建一个项目；`projectEnv` 省略 ⇒ 项目**不**声明任何 env。 */
function project(fileEnvLine: string, projectEnv?: string[]): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-221-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "env"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "nudo-vite-bug-221",
      private: true,
      type: "module",
      ...(projectEnv ? { nudo: { env: projectEnv } } : {}),
    }),
    "utf-8",
  );
  writeFileSync(join(dir, "env", "web.ts"), ENV_SRC, "utf-8");
  writeFileSync(join(dir, "src", "local-env.ts"), LOCAL_ENV_SRC, "utf-8");
  const file = join(dir, "src", "a.js");
  writeFileSync(file, fileEnvLine + APP_SRC, "utf-8");
  return { dir, file };
}

async function run(dir: string, file: string, code: string): Promise<Run> {
  const plugin = nudoPlugin();
  // 工程根：插件的 `configResolved` 落点（与真实构建一致）
  (plugin.configResolved as (c: { root: string }) => void)?.call({}, { root: dir });
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => errors.push(String(m)),
    info: () => {},
  };
  await transformOf(plugin).call(ctx, code, file);
  return { warns, errors, all: [...warns, ...errors].join("\n") };
}

describe("项目级 env 按项目根解析（插件两个面同结论、非单调性消失）", () => {
  it("无文件级 @nudo:env ⇒ 不报 ReferenceError（基线，一直是对的）", async () => {
    const { dir, file } = project("", ["./env/web.ts"]);
    try {
      const r = await run(dir, file, APP_SRC);
      expect(r.all).not.toContain("ReferenceError");
      expect(r.all).not.toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("加一行**无关**的文件级 @nudo:env ⇒ 结论不变（不再绿翻红）", async () => {
    const { dir, file } = project(FILE_ENV_LINE, ["./env/web.ts"]);
    try {
      const r = await run(dir, file, FILE_ENV_LINE + APP_SRC);
      expect(r.all).not.toContain("ReferenceError");
      expect(r.all).not.toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("两个场景的诊断集合逐项相同（单调）", async () => {
    const a = project("", ["./env/web.ts"]);
    const b = project(FILE_ENV_LINE, ["./env/web.ts"]);
    try {
      const ra = await run(a.dir, a.file, APP_SRC);
      const rb = await run(b.dir, b.file, FILE_ENV_LINE + APP_SRC);
      // 消息里带绝对路径 ⇒ 逐条对拍前先把各自的临时项目根归一
      const norm = (text: string, dir: string) => text.split(dir).join("<PROJECT>");
      expect(norm(rb.all, b.dir)).toBe(norm(ra.all, a.dir));
    } finally {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });

  it("负控制：项目未声明该 env ⇒ MAGIC 仍报 ReferenceError（门禁未被关掉）", async () => {
    const { dir, file } = project("", undefined);
    try {
      const r = await run(dir, file, APP_SRC);
      expect(r.all).toContain("ReferenceError");
      expect(r.all).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// 项目级 env 装载失败必须上屏（nudo:env-unresolved）
// ---------------------------------------------------------------------------
describe("项目级 env 装载失败必须上屏（nudo:env-unresolved）", () => {
/**
 * 回归（vite-plugin 构建期）：**项目级** env
 * （`package.json#nudo.env`）装载失败必须可见（`nudo:env-unresolved`），
 * 与 CLI / LSP 同口径。
 *
 * 病灶：`envUnresolvedDiagnostics` 只按**文件目录**取失败表
 * （`getPathEnvLoadErrors(dirname(id))`），而项目级 env 的失败条目被记在
 * **项目根**名下（`analyzer-orchestrate.ts` 的 `preloadAnalysisEnvs`：
 * `projectEnvBaseDir = proj?.projectDir ?? fileEnvBaseDir`）⇒ 过滤条件
 * **永远匹配不上** ⇒ 静默丢弃 ⇒ 构建期 env 失效零提示（假绿），
 * 而完全等价的**文件级** `/// @nudo:env ./x.ts` 插件**会**报
 * ⇒ 同一语义两种写法结论不同。
 *
 * 修法（`packages/vite-plugin/src/report.ts`）：**双 baseDir** 取错误
 * （文件目录 + 项目根），并按「项目级按项目根绝对化后」的期望路径集过滤
 * —— 与 CLI `packages/nudojs/src/commands/check.ts`（）和 LSP
 * `packages/lsp/src/validation.ts` 的 `envUnresolvedDiags` 同款。
 *
 * 负控制：项目 env 正常（文件存在且契约合法）⇒ 不得报 `nudo:env-unresolved`。
 */







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

const APP_SRC = `export function f(x) {
  return x + 1;
}
`;
const OK_ENV_SRC = `export function defineEnv() {
  return { globals: { OK: 1 } };
}
`;

function project(projectEnv: string[], envFiles: Record<string, string> = {}): {
  dir: string;
  file: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-222-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "nudo-vite-bug-222",
      private: true,
      type: "module",
      nudo: { env: projectEnv },
    }),
    "utf-8",
  );
  for (const [name, content] of Object.entries(envFiles)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  const file = join(dir, "src", "a.js");
  writeFileSync(file, APP_SRC, "utf-8");
  return { dir, file };
}

async function run(dir: string, file: string, code: string): Promise<string> {
  const plugin = nudoPlugin();
  (plugin.configResolved as (c: { root: string }) => void)?.call({}, { root: dir });
  const msgs: string[] = [];
  const ctx = {
    warn: (m: string) => msgs.push(String(m)),
    error: (m: string) => msgs.push(String(m)),
    info: (m: string) => msgs.push(String(m)),
  };
  // transform 返回 null（插件不改产物）；诊断全部走 ctx 通道
  await transformOf(plugin).call(ctx, code, file);
  return msgs.join("\n");
}

describe("项目级 env 装载失败必须上屏（nudo:env-unresolved）", () => {
  it("项目级 env 缺失 ⇒ 构建期 warning 指名项目根下的路径", async () => {
    const { dir, file } = project(["./missing-env.ts"]);
    try {
      const all = await run(dir, file, APP_SRC);
      expect(all).toContain("nudo:env-unresolved");
      expect(all).toContain("path env failed to load");
      // 解析基准 = **项目根**（不是文件目录）：路径必须是 <projectRoot>/missing-env.ts
      expect(all).toContain(join(dir, "missing-env.ts"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同一语义的**文件级**写法同样报（两种写法结论一致）", async () => {
    const { dir, file } = project([]);
    try {
      const code = `/// @nudo:env ./missing-env.ts\n${APP_SRC}`;
      writeFileSync(file, code, "utf-8");
      const all = await run(dir, file, code);
      expect(all).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：项目 env 正常 ⇒ 不报 nudo:env-unresolved", async () => {
    const { dir, file } = project(["./ok-env.ts"], { "ok-env.ts": OK_ENV_SRC });
    try {
      const all = await run(dir, file, APP_SRC);
      expect(all).not.toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// vite-plugin：按名字发的 env 诊断不再被过滤掉
// ---------------------------------------------------------------------------
describe("vite-plugin：按名字发的 env 诊断不再被过滤掉", () => {
/**
 * 回归（vite-plugin 面）：service 侧**按名字**发的 env 诊断
 * （未知 env 名 / 非字符串 env 项）记录的 path 是**名字本身**，不是解析后的
 * 绝对路径 ⇒ vite-plugin 原先只按 `resolvePath(baseDir, name)` 过滤 ⇒ 这类
 * 诊断在构建日志里被整条吃掉（env 静默不生效，零提示）。
 *
 * 与 LSP 面（packages/lsp/src/validation.ts envUnresolvedDiags）同口径：
 * 按**本文件自己的 env 名单**匹配 ⇒ 同目录别的文件的无 path 诊断不会误吸。
 */







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

describe("vite-plugin：按名字发的 env 诊断不再被过滤掉", () => {
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
});

// ---------------------------------------------------------------------------
// vite-plugin 报出 path-env 加载失败
// ---------------------------------------------------------------------------
describe("vite-plugin 报出 path-env 加载失败", () => {
/**
 * vite-plugin **从不读** path-env 加载失败通道 ⇒ `@nudo:env ./missing.js`
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

describe("vite-plugin 报出 path-env 加载失败", () => {
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
});

// ---------------------------------------------------------------------------
// vite-plugin check 面施加 inject 通道（@nudo:mock 生效）
// ---------------------------------------------------------------------------
describe("vite-plugin check 面施加 inject 通道（@nudo:mock 生效）", () => {
/**
 * 回归（vite-plugin 构建期）：check 通道必须施加 **inject 通道**
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

describe("vite-plugin check 面施加 inject 通道（@nudo:mock 生效）", () => {
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
});

// ---------------------------------------------------------------------------
// （vite 半）— info 级 check 诊断在 verbose 档必须上屏
// ---------------------------------------------------------------------------
describe("（vite 半）— info 级 check 诊断在 verbose 档必须上屏", () => {
/**
 * （vite 半）—— vite-plugin 把 **info 级 check 诊断丢在噪声档过滤
 * 之前** ⇒ `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
 * **永不上屏**，且 `nudo.analysis.diagnostics: "verbose"` 对 check 诊断
 * **完全是空操作**。
 *
 * 根因：`checkIssuesToDiagnostics` 在转成 vite Diagnostic **之前**就
 * `filter(severity === "error" || severity === "warning")` ⇒ 下游的档位
 * 过滤器（`filterDiagnosticsByLevel`）拿到的集合里已经没有 info ⇒
 * `verbose` 档（`if (level === "verbose") return diags;`）永远看不到 info。
 *
 * 修法（片 F，vite 半）：转换点保留三档（error / warning / info），
 * 档位取舍**只**由 `filterDiagnosticsByLevel` 决定；info 级走 vite 的
 * **info 通道**（不混进 warn 流——与 LSP 面的 Information 档同语义）。
 *
 * 钉：verbose 档下 info 诊断上屏（走 info 通道，不进 warn 流）；
 * 默认档下 info 不上屏（不回归：默认面只放 error / warning）。
 */







/** `@nudo:assume` ⇒ check 通道产出 info 级 `nudo:assume-relied` */
const SRC = `/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;

/**
 * 侧车契约：`sim` 的返回契约 `number().ge(0).le(1)` 只能靠 `@nudo:assume d <= max`
 * 这条用户公理证明 ⇒ check 通道产出 info 级 `nudo:assume-relied`。
 */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;

const ASSUME_CODE = "nudo:assume-relied";

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

async function runVite(pkg: unknown): Promise<{ warn: string[]; info: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-779-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
    const file = join(dir, "sim.js");
    writeFileSync(file, SRC, "utf-8");
    writeFileSync(join(dir, "sim.nudo.js"), SIDECAR, "utf-8");

    const plugin = nudoPlugin();
    const warn: string[] = [];
    const info: string[] = [];
    const ctx = {
      warn: (m: string) => warn.push(String(m)),
      info: (m: string) => info.push(String(m)),
      error: (m: string) => {
        throw new Error(String(m));
      },
    };
    await transformOf(plugin).call(ctx, SRC, file);
    return { warn, info };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VERBOSE_PKG = {
  name: "bug779-vite-verbose",
  private: true,
  type: "module",
  nudo: { analysis: { diagnostics: "verbose" } },
};

const DEFAULT_PKG = { name: "bug779-vite-default", private: true, type: "module" };

describe("（vite 半）— info 级 check 诊断在 verbose 档必须上屏", () => {
  it("verbose 档：nudo:assume-relied 走 info 通道上屏（不混进 warn 流）", async () => {
    const { warn, info } = await runVite(VERBOSE_PKG);
    const hit = info.filter((m) => m.includes(ASSUME_CODE));
    expect(hit.length, `info 通道无 info 诊断：${JSON.stringify({ warn, info })}`).toBeGreaterThan(0);
    expect(
      warn.filter((m) => m.includes(ASSUME_CODE)).length,
      "info 诊断混进了 warn 流",
    ).toBe(0);
  }, 30_000);

  it("默认档：info 不上屏（档位取舍仍归 filterDiagnosticsByLevel）", async () => {
    const { warn, info } = await runVite(DEFAULT_PKG);
    expect(info.filter((m) => m.includes(ASSUME_CODE)).length, "默认档不应上屏 info").toBe(0);
    expect(warn.filter((m) => m.includes(ASSUME_CODE)).length, "默认档不应上屏 info").toBe(0);
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// vite-plugin-nudo enforce: 'pre'（TS 源码里的 @nudo: 指令必须可见）
// ---------------------------------------------------------------------------
describe("vite-plugin-nudo enforce: 'pre'（TS 源码里的 @nudo: 指令必须可见）", () => {
/**
 * 插件对象缺 `enforce: "pre"` ⇒ 排在核心插件 `vite:esbuild` **之后**
 * ⇒ `transform` 收到的是 esbuild 的**转译产物**（TS loader 剥光注释）⇒
 * `.ts` 源里**只存在于注释**的 `@nudo:` 指令全部不可见 ⇒ 分析按「无指令普通模块」
 * 跑 ⇒ 报出 `nudo check` **不会**报的 error（**假红**面）。
 *
 * 修法（族 30 · S4）：插件对象加 `enforce: "pre"` ⇒ 本插件排在 `vite:esbuild`
 * **之前** ⇒ 看到**原始 TS 源码** ⇒ 指令可见 ⇒ 与 CLI 判同。
 *
 * ⚠ **诊断行号的判读口径**：`enforce: "pre"` 之后诊断行号从「转译产物坐标系」
 * 回到「**源码坐标系**」—— 这是**预期修复**（诊断**集合**不变，位置回到用户
 * 写代码的那份文件）。本文件因此**不**拿行号当断言，只钉「诊断集合」。
 */

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: never[]) => unknown {
  if (typeof h === "function") return h as (...args: never[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: never[]) => unknown }).handler;
  }
  throw new Error("plugin hook missing");
}

function transformOf(plugin: { transform?: unknown }) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

/**
 * `.ts` 源：`@nudo:throws ReferenceError` 声明了该函数会抛的错。
 * `nudo check` 判 **OK**（0 error）；插件若看不到这条指令 ⇒ 报
 * `nudo:entry-may-throw`（**假红**）。
 */
const TS_WITH_THROWS = `/**
 * @nudo:throws ReferenceError
 */
export function f(d: any): string {
  return missingGlobal;
}
`;

/**
 * 同一份源码的「注释被剥光」形态 —— **等价于 esbuild 的 TS loader 产物**
 * （`vite:esbuild` 在 `enforce: "pre"` 缺席时排在插件之前 ⇒ 插件拿到的就是它）。
 * 用它当**对照组**：证明差异来自**插件排序**（插件看到哪份代码），
 * 而不是插件的分析逻辑。
 */
const TS_COMMENTS_STRIPPED = `function f(d) {
  return missingGlobal;
}
export {
  f
};
`;

describe("vite-plugin-nudo enforce: 'pre'（TS 源码里的 @nudo: 指令必须可见）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 最小 fixture 项目（mkdtemp 注册统一清理；嵌套路径自动建目录）。 */
  function fixture(prefix: string, files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf-8");
    }
    return dir;
  }

  /**
 * 走一遍插件的**真实生命周期**：`configResolved`（记录 `config.root`）→
 * `transform`。⚠ `scope.ts` 的项目根是**模块级状态** ⇒ 直接驱动 `transform`
 * 而不先给根，会沿用**上一个**用例留下的根 ⇒ 文件被当成「工程根之外的依赖」
 * 而跳过（`scope.ts` 的 1056 语义）⇒ 诊断消失。真实构建里 Vite 必先调
 * `configResolved`，这里如实模拟。
 */
  function bindRoot(plugin: { configResolved?: unknown }, root: string): void {
    // ⚠ HEAD（族 30 之前）副本没有 `configResolved` 钩子 ⇒ 跳过（反向闸
    // 的失败原因必须来自**行为**，不能来自「钩子不存在」这种基线差异）。
    if (!plugin.configResolved) return;
    const fn = plugin.configResolved as (this: unknown, config: { root: string }) => void;
    fn.call({}, { root });
  }

  /** 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。 */
  function captureWarnings(): { logger: ReturnType<typeof createLogger>; warnings: string[]; infos: string[] } {
    const warnings: string[] = [];
    const infos: string[] = [];
    const logger = createLogger("warn");
    logger.warn = (msg: string) => {
      warnings.push(msg);
    };
    logger.info = (msg: string) => {
      infos.push(msg);
    };
    return { logger, warnings, infos };
  }

  it("插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）", () => {
    expect(nudoPlugin().enforce).toBe("pre");
  });

  it("直接驱动 transform：原始 TS 源码里的 @nudo:throws 可见 ⇒ 不报 CLI 不会报的 entry-may-throw", async () => {
    const dir = fixture("nudo-vite-895-raw-", {
      "package.json": JSON.stringify({ name: "fx895raw", private: true, version: "0.0.0" }),
    });
    const id = join(dir, "main.ts");
    const plugin = nudoPlugin({ failOnError: false });
    bindRoot(plugin, dir);
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };

    const result = await transformOf(plugin).call(ctx, TS_WITH_THROWS, id);
    expect(result).toBeNull();
    const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
    // 指令可见 ⇒ 抛错已声明 ⇒ 无 entry-may-throw（与 `nudo check` 判同：OK）
    expect(msgs).not.toContain("entry-may-throw");
  });

  it("对照组：同一份源码剥掉注释（= esbuild 产物）⇒ 报 entry-may-throw（差异来自插件排序）", async () => {
    const dir = fixture("nudo-vite-895-ctl-", {
      "package.json": JSON.stringify({ name: "fx895ctl", private: true, version: "0.0.0" }),
    });
    const id = join(dir, "main.ts");
    const plugin = nudoPlugin({ failOnError: false });
    bindRoot(plugin, dir);
    const warnFn = vi.fn();
    const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };

    const result = await transformOf(plugin).call(ctx, TS_COMMENTS_STRIPPED, id);
    expect(result).toBeNull();
    const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
    // 指令不可见 ⇒ 声明缺失 ⇒ 门禁报 error（这正是 895 的**假红**面）
    expect(msgs).toContain("entry-may-throw");
  });

  it(
    "真 vite build：.ts 源里的 @nudo:throws 可见 ⇒ 构建成功、零 [nudo] 诊断（不假红）",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-895-build-", {
        "package.json": JSON.stringify({ name: "fx895build", private: true, version: "0.0.0" }),
        "src/main.ts": TS_WITH_THROWS,
      });

      const { logger, warnings } = captureWarnings();
      // failOnError: true ⇒ 假红会直接红构建（CLI 判 OK ⇒ 插件也必须判 OK）
      const buildPromise = build({
        root: dir,
        configFile: false,
        customLogger: logger,
        plugins: [nudoPlugin({ failOnError: true })],
        build: {
          minify: false,
          outDir: "dist",
          rollupOptions: {
            input: join(dir, "src/main.ts"),
            preserveEntrySignatures: "strict",
          },
        },
      });

      // 构建**不得**失败（`nudo check` 对同一份文件判 OK）
      await expect(buildPromise).resolves.toBeTruthy();
      expect(warnings.join("\n")).not.toContain("entry-may-throw");
    },
  );

  it(
    "真 vite build：TS 特有语法（enum / namespace / as const / satisfies / 抽象类）⇒ 构建成功、零 [nudo] 诊断",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-895-ts-", {
        "package.json": JSON.stringify({ name: "fx895ts", private: true, version: "0.0.0" }),
        // 同一份文件 `nudo check` 判 **OK**（0 error）⇒ 插件也必须判 OK
        "src/main.ts": `export enum Color { Red = 1, Green = 2 }
export namespace NS { export const v = 1; }
export const o = { a: 1 } as const;
export const p = { a: 1 } satisfies { a: number };
export abstract class B { abstract m(): void; }
export class C {
  private x: number = 1;
  constructor(readonly y: number) {}
}
export const c = Color.Red;
export const n = NS.v;
`,
      });

      const { logger, warnings } = captureWarnings();
      const buildPromise = build({
        root: dir,
        configFile: false,
        customLogger: logger,
        plugins: [nudoPlugin({ failOnError: true })],
        build: {
          minify: false,
          outDir: "dist",
          rollupOptions: {
            input: join(dir, "src/main.ts"),
            preserveEntrySignatures: "strict",
          },
        },
      });

      // TS 源码必须被分析面吃下（解析失败 ⇒ "Failed to analyze"），
      // 且**不得**红构建
      await expect(buildPromise).resolves.toBeTruthy();
      expect(warnings.join("\n")).not.toContain("Failed to analyze");
      expect(warnings.join("\n")).not.toContain("[nudo]");
    },
  );

  it(
    "真 vite build：分析面解析不了的 TS 语法（装饰器）⇒ 降级为 warn，构建不炸（902 守卫兜底）",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-895-deco-", {
        "package.json": JSON.stringify({ name: "fx895deco", private: true, version: "0.0.0" }),
        "src/main.ts": `function dec(t: unknown) { return t; }
@dec
export class A { x = 1; }
`,
      });

      const { logger, warnings } = captureWarnings();
      const buildPromise = build({
        root: dir,
        configFile: false,
        customLogger: logger,
        plugins: [nudoPlugin({ failOnError: true })],
        build: {
          minify: false,
          outDir: "dist",
          rollupOptions: {
            input: join(dir, "src/main.ts"),
            preserveEntrySignatures: "strict",
          },
        },
      });

      // 解析失败 ⇒ 插件兜底 catch ⇒ 一条 warn；**绝不**红构建
      await expect(buildPromise).resolves.toBeTruthy();
      expect(warnings.join("\n")).toContain("Failed to analyze");
    },
  );
});
});

// ---------------------------------------------------------------------------
// 虚拟模块 id 必须被跳过（不再触发侧车加载失败）
// ---------------------------------------------------------------------------
describe("虚拟模块 id 必须被跳过（不再触发侧车加载失败）", () => {
/**
 * Vite **虚拟模块 id**（`\0` 前缀 / `virtual:` 前缀）触发侧车加载失败
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

describe("虚拟模块 id 必须被跳过（不再触发侧车加载失败）", () => {
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
});

// ---------------------------------------------------------------------------
// vite-plugin 读项目配置的 L2 门禁档位（entryThrows / ignoreThrows）
// ---------------------------------------------------------------------------
describe("vite-plugin 读项目配置的 L2 门禁档位（entryThrows / ignoreThrows）", () => {
/**
 * 回归（vite-plugin 构建期）：check 面必须把**项目配置**里的
 * L2 门禁档位（`package.json#nudo.check.entryThrows` / `ignoreThrows`）
 * 传给 `checkSource` —— 与 CLI / LSP **同口径**。
 *
 * 病灶：插件调 `checkSource` 时**不传** `entryThrows` / `ignoreThrows`
 * ⇒ `checkSource` 用默认最严档（`entryThrows:"error"`、`ignoreThrows:[]`）
 * ⇒ 项目配置的 `nudo.check.*` 被无视（插件自己却读了**同源**配置的
 * `autoBind` ⇒ 配置找得到，只是没把门禁档位一起带过去）
 * ⇒ 同一个仓库 `nudo check` 绿、`vite build` 红，`failOnError: true` 时
 * `this.error` 抛异常 ⇒ **构建中断**。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts` 的
 * `assembleCheckOutcome`）：从**同一份**项目配置
 * （`findProjectConfig(dirname(id))?.config`）取 `checkConfig(...)` 的
 * `entryThrows` / `ignoreThrows` 并传给 `checkSource`
 * —— 口径与 LSP 的 `validation.ts` / `agent-tools.ts` 逐字一致。
 *
 * 负控制：没有配置时仍是默认最严档（`error`）⇒ 门禁未被整体关掉。
 */







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

/** 会真抛的入口（读未约束全局 ⇒ L2 may-throw）。 */
const ENTRY_SRC = `export function getName(user) {
  return user.name;
}
`;

type Run = { warns: string[]; errors: string[]; thrown?: string };

async function runPlugin(
  dir: string,
  options: Record<string, unknown>,
): Promise<Run> {
  const plugin = nudoPlugin(options);
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    // 真实 Rollup/Vite 语义：this.error 抛异常
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
    info: () => {},
  };
  const file = join(dir, "a.js");
  const out: Run = { warns, errors };
  try {
    await transformOf(plugin).call(ctx, ENTRY_SRC, file);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  return out;
}

function project(dir: string, nudo?: Record<string, unknown>): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "nudo-vite-bug-897", private: true, ...(nudo ? { nudo } : {}) }),
    "utf-8",
  );
  writeFileSync(join(dir, "a.js"), ENTRY_SRC, "utf-8");
}

describe("vite-plugin 读项目配置的 L2 门禁档位（entryThrows / ignoreThrows）", () => {
  it("entryThrows=warning ⇒ 报 warning 而不是 error（与 CLI 同口径）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897-"));
    try {
      project(dir, { check: { entryThrows: "warning" } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:entry-may-throw");
      // 档位是 warning ⇒ 不得走 this.error（否则 failOnError 会中断构建）
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
      expect(r.warns.join("\n")).toContain("warning:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entryThrows=warning + failOnError=true ⇒ 构建不中断（不再抛）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897b-"));
    try {
      project(dir, { check: { entryThrows: "warning" } });
      const r = await runPlugin(dir, { failOnError: true });
      expect(r.thrown).toBeUndefined();
      expect(r.errors).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignoreThrows=[TypeError] ⇒ 该 throw 类不再报 nudo:entry-may-throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897c-"));
    try {
      project(dir, { check: { ignoreThrows: ["TypeError"] } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).not.toContain("nudo:entry-may-throw");
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entryThrows=off ⇒ L2 门禁诊断整段缺席", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897d-"));
    try {
      project(dir, { check: { entryThrows: "off" } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).not.toContain("nudo:entry-may-throw");
      expect(r.errors).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：没有 nudo.check 配置时仍是默认最严档（error）—— 门禁未被整体关掉", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897e-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: true });
      expect(r.errors.join("\n")).toContain("nudo:entry-may-throw");
      expect(r.thrown).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("profile=adoption 预设 ⇒ 落到 warning 档（与 CLI / LSP 的预设解析同口径）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-897f-"));
    try {
      project(dir, { check: { profile: "adoption" } });
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:entry-may-throw");
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// vite-plugin check 面传 Abs 模块图（跨模块返回契约可证 ⇒ 不报 unproven-return）
// ---------------------------------------------------------------------------
describe("vite-plugin check 面传 Abs 模块图（跨模块返回契约可证 ⇒ 不报 unproven-return）", () => {
/**
 * 回归（vite-plugin 构建期）：check 面必须把 **Abs 模块图**
 * （`modules`）传给 `checkSource` —— 与 CLI / LSP 同口径。
 *
 * 病灶（勘察基线 `7af5520c`）：插件调 `checkSource` 时**不传** `modules`
 * ⇒ 跨模块被调函数的类型在 check 通道里缺席 ⇒ 返回值塌成
 * `unknown #opaque` ⇒ **可证**的返回契约被报成 `nudo:unproven-return`
 * （**假红**：同一份文件 `nudo check` 判绿、构建期报红）。
 *
 * 现状：**族 18（`169ed526`）的 `buildViteCheckInjection` 已经把
 * `modules`（+ `inject`）一起传给 `checkSource`** ⇒ 本条的实现早已闭合；
 * 本钉的作用是**锁住该口径**（防止将来有人把 `modules` 摘掉）。
 * 对照：族 18 之前的基线（`7af5520c`）上本钉会失败。
 *
 * 负控制：真违约（返回 `string()` 而实际返回 `number`）必须仍然报
 * `nudo:constraint-violated`（**error** 级）—— 见 的钉。
 */







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

const LIB_SRC = `export function double(n) {
  return n * 2;
}
`;
const LIB_SIDECAR = `export const double = fn({ n: number() }, number());
`;
const APP_SRC = `import { double } from "./lib.js";
export function run(n) {
  return double(n);
}
`;
const APP_SIDECAR = `export const run = fn({ n: number() }, number());
`;

type Run = { warns: string[]; errors: string[]; infos: string[]; thrown?: string };

async function runPlugin(
  dir: string,
  options: Record<string, unknown> = {},
): Promise<Run> {
  const plugin = nudoPlugin(options);
  const warns: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
    info: (m: string) => infos.push(String(m)),
  };
  const file = join(dir, "app.js");
  const out: Run = { warns, errors, infos };
  try {
    await transformOf(plugin).call(ctx, APP_SRC, file);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  return out;
}

function project(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "nudo-vite-bug-898", private: true }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), LIB_SIDECAR, "utf-8");
  writeFileSync(join(dir, "app.js"), APP_SRC, "utf-8");
  writeFileSync(join(dir, "app.nudo.js"), APP_SIDECAR, "utf-8");
}

describe("vite-plugin check 面传 Abs 模块图（跨模块返回契约可证 ⇒ 不报 unproven-return）", () => {
  it("跨模块调用可证时不得报 nudo:unproven-return / unknown #opaque（与 CLI 同口径：绿）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-898-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors, ...r.infos].join("\n");
      expect(all).not.toContain("nudo:unproven-return");
      expect(all).not.toContain("unknown #opaque");
      expect(r.errors).toHaveLength(0);
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：真违约仍必须报 nudo:constraint-violated（模块图到位 ≠ 门禁被关掉）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-898b-"));
    try {
      project(dir);
      // 真违约：run 的返回契约写 string()，实际返回 number
      writeFileSync(
        join(dir, "app.nudo.js"),
        `export const run = fn({ n: number() }, string());\n`,
        "utf-8",
      );
      const r = await runPlugin(dir, { failOnError: true });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:constraint-violated");
      expect(all).not.toContain("nudo:unproven-return");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// off 档不得抹掉 check 门禁通道
// ---------------------------------------------------------------------------
describe("off 档不得抹掉 check 门禁通道", () => {
/**
 * `nudo.analysis.diagnostics: "off"` 档把 **L1/L2 check 门禁**
 * 一起抹掉 ⇒ `vite build` 零诊断通过（CI 假绿）。
 *
 * 根因：插件把 **check 门禁诊断与 evaluator 诊断合并后**再交给
 * `filterDiagnosticsByLevel`；而 `off` 档的实现是「返回空数组」⇒ L1 契约违例
 * 与 L2 `nudo:entry-may-throw` 一起消失 ⇒ `failOnError: true` 也**不拦**。
 *
 * 修法（**不改** service 的 `filterDiagnosticsByLevel` 签名）：插件侧**分两条
 * 通道** —— 门禁通道（check 面的 error 级诊断）**不参与** `off` 档静音；
 * 显示通道（evaluator 面 + env 面 + check 面的 warning / info 级）照旧过滤。
 *
 * 钉：`off` 档下 `failOnError: true` **仍然抛**（构建红）；`off` 档下门禁
 * 诊断**仍然可见**（不被抹掉）。
 */







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
const SRC = `export function getName(user) {
  return user.name;
}
`;

function offFixture(): { dir: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-899-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bug899-off",
      private: true,
      nudo: { analysis: { diagnostics: "off" } },
    }),
    "utf-8",
  );
  const id = join(dir, "entry.js");
  writeFileSync(id, SRC, "utf-8");
  return { dir, id };
}

describe("off 档不得抹掉 check 门禁通道", () => {
  it("off 档 + failOnError: true ⇒ 仍然抛（构建红，不再 CI 假绿）", async () => {
    const { dir, id } = offFixture();
    try {
      const plugin = nudoPlugin({ failOnError: true });
      const warnFn = vi.fn();
      const errorFn = vi.fn((m: string) => {
        throw new Error(m);
      });
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

      await expect(transformOf(plugin).call(ctx, SRC, id)).rejects.toThrow(/entry-may-throw/);
      expect(errorFn).toHaveBeenCalled();
      const msg = String(errorFn.mock.calls[0]?.[0] ?? "");
      expect(msg).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("off 档 + failOnError: false ⇒ 门禁诊断仍然可见（不被抹掉）", async () => {
    const { dir, id } = offFixture();
    try {
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const errorFn = vi.fn();
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

      const result = await transformOf(plugin).call(ctx, SRC, id);
      expect(result).toBeNull();
      expect(errorFn).not.toHaveBeenCalled();
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("非 off 档（默认档）口径不变：门禁诊断照旧上报", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-899-default-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "bug899-default", private: true }),
        "utf-8",
      );
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

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
});

// ---------------------------------------------------------------------------
// vite-plugin-nudo enforce: 'pre'（.ts 源的契约不得被静默放绿）
// ---------------------------------------------------------------------------
describe("vite-plugin-nudo enforce: 'pre'（.ts 源的契约不得被静默放绿）", () => {
/**
 * 的**反方向面**：插件对象缺 `enforce: "pre"` ⇒ 排在
 * `vite:esbuild` **之后** ⇒ `transform` 收到 esbuild 的**转译产物**
 * （TS loader 剥光注释）⇒ `.ts` 源里的 `@nudo:contract` / `@nudo:case`
 * **全部不可见** ⇒ 门禁**静默放绿**（同一份契约：`.js` 源报红、`.ts` 源零诊断）。
 *
 * 修法（族 30 · S4）：插件对象加 `enforce: "pre"` ⇒ 插件看到**原始 TS 源码**
 * ⇒ 契约可见 ⇒ `.ts` 源与 `.js` 源**判同**。
 *
 * ⚠ **诊断行号的判读口径**：行号从「转译产物坐标系」回到「**源码坐标系**」
 * —— 这是**预期修复**；本文件按「**诊断集合**一致」判读，不拿行号当断言。
 */

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: never[]) => unknown {
  if (typeof h === "function") return h as (...args: never[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: never[]) => unknown }).handler;
  }
  throw new Error("plugin hook missing");
}

function transformOf(plugin: { transform?: unknown }) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

/** 契约模板（侧车）：`positive` = number > 0。 */
const SIDECAR = `export const positive = number().gt(0);
`;

/** `.ts` 源：契约 + case 见证（case 见证 -1 违反 `x > 0` ⇒ 门禁 error）。 */
const TS_SOURCE = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
export function areaTs(x: number): number { return x; }
`;

/** `.js` 源：与上面**同一份契约**（vite 的 esbuild 只转译 `.ts`/`.tsx` ⇒ `.js` 的注释不被剥）。 */
const JS_SOURCE = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 * @nudo:case "neg" (-1)
 */
export function areaJs(x) { return x; }
`;

describe("vite-plugin-nudo enforce: 'pre'（.ts 源的契约不得被静默放绿）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 最小 fixture 项目（mkdtemp 注册统一清理；嵌套路径自动建目录）。 */
  function fixture(prefix: string, files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf-8");
    }
    return dir;
  }

  /**
 * 走一遍插件的**真实生命周期**：`configResolved`（记录 `config.root`）→
 * `transform`。⚠ `scope.ts` 的项目根是**模块级状态** ⇒ 直接驱动 `transform`
 * 而不先给根，会沿用**上一个**用例留下的根 ⇒ 文件被当成「工程根之外的依赖」
 * 而跳过（`scope.ts` 的 1056 语义）⇒ 诊断消失。真实构建里 Vite 必先调
 * `configResolved`，这里如实模拟。
 */
  function bindRoot(plugin: { configResolved?: unknown }, root: string): void {
    // ⚠ HEAD（族 30 之前）副本没有 `configResolved` 钩子 ⇒ 跳过（反向闸
    // 的失败原因必须来自**行为**，不能来自「钩子不存在」这种基线差异）。
    if (!plugin.configResolved) return;
    const fn = plugin.configResolved as (this: unknown, config: { root: string }) => void;
    fn.call({}, { root });
  }

  /** 收集 vite logger 的 warn / info 通道（不透传，保持测试输出干净）。 */
  function captureWarnings(): { logger: ReturnType<typeof createLogger>; warnings: string[]; infos: string[] } {
    const warnings: string[] = [];
    const infos: string[] = [];
    const logger = createLogger("warn");
    logger.warn = (msg: string) => {
      warnings.push(msg);
    };
    logger.info = (msg: string) => {
      infos.push(msg);
    };
    return { logger, warnings, infos };
  }

  /** 真 vite build（返回构建日志里的 [nudo] 诊断行）。 */
  async function buildFixture(
    dir: string,
    entryRel: string,
    failOnError: boolean,
  ): Promise<{ warnings: string[]; infos: string[]; failed: boolean; message: string }> {
    const { logger, warnings, infos } = captureWarnings();
    const buildPromise = build({
      root: dir,
      configFile: false,
      customLogger: logger,
      plugins: [nudoPlugin({ failOnError })],
      build: {
        minify: false,
        outDir: "dist",
        rollupOptions: {
          input: join(dir, entryRel),
          preserveEntrySignatures: "strict",
        },
      },
    });
    let failed = false;
    let message = "";
    try {
      await buildPromise;
    } catch (e) {
      failed = true;
      message = String((e as { message?: string })?.message ?? e);
    }
    return { warnings, infos, failed, message };
  }

  it("插件对象带 enforce: 'pre'（排在 vite:esbuild 之前 ⇒ 看得到原始 TS 源码）", () => {
    expect(nudoPlugin().enforce).toBe("pre");
  });

  it(
    "真 vite build：.ts 源里的 @nudo:contract / @nudo:case 可见 ⇒ 门禁不再静默放绿",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-900-ts-", {
        "package.json": JSON.stringify({ name: "fx900ts", private: true, version: "0.0.0" }),
        "src/std.nudo.js": SIDECAR,
        "src/main.ts": TS_SOURCE,
      });

      // failOnError: false ⇒ 门禁 error 走 warn 通道（构建不失败，但**必须看得见**）
      const { warnings, failed } = await buildFixture(dir, "src/main.ts", false);
      const msgs = warnings.join("\n");
      expect(failed).toBe(false);
      expect(msgs).toContain("[nudo]");
      expect(msgs).toContain("case-inconsistency");
    },
  );

  it(
    "真 vite build：failOnError: true 时 .ts 源的契约违例红构建（与 .js 源同判）",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-900-gate-", {
        "package.json": JSON.stringify({ name: "fx900gate", private: true, version: "0.0.0" }),
        "src/std.nudo.js": SIDECAR,
        "src/main.ts": TS_SOURCE,
      });

      const { failed, message } = await buildFixture(dir, "src/main.ts", true);
      expect(failed).toBe(true);
      expect(message).toContain("case-inconsistency");
    },
  );

  it(
    "同一份契约的 .ts 源与 .js 源判同（诊断集合一致；行号随源码坐标系）",
    { timeout: 120_000 },
    async () => {
      const tsDir = fixture("nudo-vite-900-parity-ts-", {
        "package.json": JSON.stringify({ name: "fx900parityts", private: true, version: "0.0.0" }),
        "src/std.nudo.js": SIDECAR,
        "src/main.ts": TS_SOURCE,
      });
      const jsDir = fixture("nudo-vite-900-parity-js-", {
        "package.json": JSON.stringify({ name: "fx900parityjs", private: true, version: "0.0.0" }),
        "src/std.nudo.js": SIDECAR,
        "src/main.js": JS_SOURCE,
      });

      const ts = await buildFixture(tsDir, "src/main.ts", false);
      const js = await buildFixture(jsDir, "src/main.js", false);

      // 诊断**集合**必须一致（此前 `.ts` 源零诊断 ⇒ 静默放绿）
      const codes = (msgs: string) =>
        [...msgs.matchAll(/\(nudo:[a-z-]+\)/g)].map((m) => m[0]).sort();
      expect(codes(ts.warnings.join("\n"))).toEqual(codes(js.warnings.join("\n")));
      expect(codes(ts.warnings.join("\n"))).toContain("(nudo:case-inconsistency)");
    },
  );

  it(
    "直接驱动 transform：.ts 源码（含类型注解）过分析面 ⇒ 报出与 CLI 同码的诊断",
    async () => {
      const dir = fixture("nudo-vite-900-hook-", {
        "package.json": JSON.stringify({ name: "fx900hook", private: true, version: "0.0.0" }),
        "src/std.nudo.js": SIDECAR,
      });
      const id = join(dir, "src/main.ts");
      const plugin = nudoPlugin({ failOnError: false });
      bindRoot(plugin, dir);
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };

      const result = await transformOf(plugin).call(ctx, TS_SOURCE, id);
      expect(result).toBeNull();
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("case-inconsistency");
    },
  );
});
});

// ---------------------------------------------------------------------------
// info 不计入 warning 计数 + info 走 this.info 上屏
// ---------------------------------------------------------------------------
describe("info 不计入 warning 计数 + info 走 this.info 上屏", () => {
/**
 * `buildEnd` 汇总行把 **info 级诊断算成 warning**，而这些 info
 * **从头到尾没被打印过** ⇒ 汇总行与构建日志自相矛盾。
 *
 * 报告原断言：汇总行 `[nudo] Analysis complete: X error(s), Y warning(s)` 里的
 * `Y` 包含了 info 级诊断；同时 info 级诊断在构建日志里**一行都没有** ⇒
 * 「说 Y 条告警，日志里一条告警都找不到」。
 *
 * ⚠ **本片是族 30 唯一的假阳性片**：核心症状已被**族 26**（提交 `f87c9f9d`
 * 的「vite 半」）修掉 —— `warnCount` 改成只数 `severity === "warning"`，
 * 上报循环新增 info → `this.info` 分支 ⇒ **本文件不改任何实现**，只补
 * **反向守护钉**：钉住这两条**已成立**的行为。
 *
 * 钉住（两条）：
 * 1. **info 不计入 warning 计数** —— 汇总行的 `Y warning(s)` 只数 warning 级
 * 诊断；info 级诊断不计入，且汇总行**不得**比「实际 warning 条数」多。
 * 2. **info 走 `this.info` 上屏** —— info 级诊断出现在 vite 的 **info 通道**，
 * **不混进 warn 流**（否则 info 冒充告警）。
 *
 * 与族 26 的 `vite--info-level-diagnostics.part.ts` 的分工：779 钉的是
 * **check 面** info（`nudo:assume-relied`，verbose 档）上屏；本钉钉的是
 * **evaluator 面** info（不可达代码 / 无契约根）**与汇总计数口径** ⇒ 不重复。
 *
 * ⚠ 汇总行的**输出通道**（S3 的 已把它从裸 `console.log` 迁到 Vite
 * logger 的 info 通道）**不在**本钉的断言面内 ⇒ 本钉从「console.log + vite 的
 * warn/info 两条通道」三处一起找汇总行 ⇒ 通道迁移前后本钉都成立。
 */







/** 诊断文本格式：`[nudo] <id>:<line>:<col> <severity>: <message>`。 */
const DIAG_RE = /^\[nudo\] (.+):(\d+):(\d+) (error|warning|info): /;
/** 汇总行格式：`[nudo] Analysis complete: X error(s), Y warning(s)`。 */
const SUMMARY_RE = /^\[nudo\] Analysis complete: (\d+) error\(s\), (\d+) warning\(s\)$/;

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

type Captured = {
  /** vite warn 通道收到的全部消息。 */
  warns: string[];
  /** vite info 通道收到的全部消息。 */
  infos: string[];
  /** vite error 通道收到的全部消息。 */
  errors: string[];
  /** 裸 `console.log` 收到的全部消息（S0 时期汇总行走这里；S3 后已迁到 vite logger）。 */
  logs: string[];
};

/**
 * 夹具：`dead.js` 导出 `dead` —— 产出
 * - 1 条 **error 级**（L2 `entry-may-throw`，`failOnError` 默认 false ⇒ 降 warn 流）；
 * - 2 条 **info 级**（evaluator 面：不可达代码 / 无契约根，无调用点域）；
 * - **0 条 warning 级**。
 *
 * `nudo.analysis.diagnostics: "verbose"` ⇒ info 级不被噪声档过滤掉
 * （否则它们根本进不了诊断集合，计数口径就无从对比）。
 */
async function runFixture(): Promise<Captured> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-901-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "bug901-vite",
        private: true,
        type: "module",
        nudo: { analysis: { mode: "all", diagnostics: "verbose" } },
      }),
      "utf-8",
    );
    const source = `export function dead(x) {
  return x + 1;
  console.log("never runs");
}
`;
    const filePath = join(dir, "dead.js");
    writeFileSync(filePath, source, "utf-8");

    const plugin = nudoPlugin();
    const warns: string[] = [];
    const infos: string[] = [];
    const errors: string[] = [];
    const logs: string[] = [];
    const ctx = {
      warn: (m: string) => warns.push(String(m)),
      info: (m: string) => infos.push(String(m)),
      error: (m: string) => {
        errors.push(String(m));
        throw new Error(String(m));
      },
    };
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map((x) => String(x)).join(" "));
    });
    try {
      hookFn(plugin.buildStart).call(ctx);
      await transformOf(plugin).call(ctx, source, filePath);
      hookFn(plugin.buildEnd).call(ctx);
    } finally {
      // ⚠ mockRestore() 会清空 mock.calls ⇒ 断言值在 restore 之前已取进本地数组。
      spy.mockRestore();
    }
    return { warns, infos, errors, logs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 汇总行（console.log + vite 两条通道三处一起找 —— 通道迁移后仍能找到）。 */
function findSummary(c: Captured): string {
  const candidates = [...c.logs, ...c.warns, ...c.infos].filter((m) => SUMMARY_RE.test(m.trim()));
  expect(candidates.length, `汇总行条数异常：${JSON.stringify(c)}`).toBe(1);
  return candidates[0]!.trim();
}

/** 诊断消息的 severity（由诊断文本格式的唯一出口解析，不靠消息正文）。 */
function severityOf(m: string): "error" | "warning" | "info" {
  return DIAG_RE.exec(m)![4] as "error" | "warning" | "info";
}

/** 通道里收到的、按 severity 分类的诊断消息。 */
function classify(c: Captured) {
  const diags = [...c.warns, ...c.infos, ...c.errors].filter((m) => DIAG_RE.test(m));
  const errors = diags.filter((m) => severityOf(m) === "error");
  const warnings = diags.filter((m) => severityOf(m) === "warning");
  const info = diags.filter((m) => severityOf(m) === "info");
  return { diags, errors, warnings, info };
}

describe("info 不计入 warning 计数 + info 走 this.info 上屏", () => {
  it("info 级诊断走 vite 的 info 通道上屏，且不混进 warn 流", async () => {
    const c = await runFixture();
    const { info } = classify(c);
    expect(info.length, `info 通道无 info 级诊断：${JSON.stringify(c)}`).toBeGreaterThan(0);
    // info 级诊断**一条都不许**出现在 warn 流（否则 info 冒充告警）。
    expect(
      c.warns.filter((m) => DIAG_RE.test(m) && severityOf(m) === "info"),
      `info 级诊断混进了 warn 流：${JSON.stringify(c.warns)}`,
    ).toEqual([]);
    // info 级诊断也不许走 error 通道。
    expect(
      c.errors.filter((m) => DIAG_RE.test(m) && severityOf(m) === "info"),
      `info 级诊断混进了 error 流：${JSON.stringify(c.errors)}`,
    ).toEqual([]);
  }, 30_000);

  it("buildEnd 汇总行的 warning 计数只算 warning 级诊断（info 不计入）", async () => {
    const c = await runFixture();
    const { diags, errors, warnings, info } = classify(c);
    const m = SUMMARY_RE.exec(findSummary(c))!;
    const summaryErrors = Number(m[1]);
    const summaryWarnings = Number(m[2]);

    // 前置：本夹具确实产出了 info 级诊断（否则「info 不计入」无从谈起）。
    expect(info.length, `本夹具应产出 info 级诊断：${JSON.stringify(c)}`).toBeGreaterThan(0);

    // 汇总的 warning 计数 == 实际 warning 级诊断条数（本夹具为 0 条 warning）。
    expect(summaryWarnings).toBe(warnings.length);
    expect(summaryWarnings).toBe(0);
    // 汇总**不是**把全部诊断都算成 warning（否则 info 会被计入）。
    expect(summaryWarnings).toBeLessThan(diags.length);
    // 汇总的 error 计数 == 实际 error 级诊断条数。
    expect(summaryErrors).toBe(errors.length);
  }, 30_000);

  it("汇总行与构建日志自洽：被计入的诊断都真的上屏过（info 不再凭空消失）", async () => {
    const c = await runFixture();
    const { diags, info } = classify(c);
    const m = SUMMARY_RE.exec(findSummary(c))!;
    const summaryErrors = Number(m[1]);
    const summaryWarnings = Number(m[2]);

    // 被计入汇总的诊断条数不得超过实际上屏的诊断条数（不得「凭空多报」）。
    expect(summaryErrors + summaryWarnings).toBeLessThanOrEqual(diags.length);
    // info 级诊断确实上屏了（报告原断言的另一半：info「从头到尾没被打印过」）。
    expect(info.length).toBeGreaterThan(0);
    expect(c.infos.length).toBeGreaterThan(0);
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// 畸形入参不得抛未捕获异常
// ---------------------------------------------------------------------------
describe("畸形入参不得抛未捕获异常", () => {
/**
 * `transform()` 对 `code = null` **抛未捕获异常**（异常在 `try` 之外，
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

describe("畸形入参不得抛未捕获异常", () => {
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
});

// ---------------------------------------------------------------------------
// HMR 的 ?t= query id 不得让整份文件被跳过
// ---------------------------------------------------------------------------
describe("HMR 的 ?t= query id 不得让整份文件被跳过", () => {
/**
 * `vite dev` 下 HMR 的 `?t=<timestamp>` module id 让插件**整份跳过**
 * 刚编辑的文件 ⇒ **dev 期诊断消失**（假绿）。
 *
 * 根因：`transform` 入口拿**带 query 的原始 Vite module id** 去比锚定正则
 * （`packages/service/src/glob.ts` 的 `^…$`）⇒ include 失配 ⇒ `return null`
 * ⇒ `shouldAnalyzeFile` / `analyzeFileAsync` / `checkSource` 全不跑。
 *
 * 修法：`scope.ts` 的 `scopeDecision` 在**匹配与分析之前**统一剥 query
 * （`normalizeModuleId`）⇒ 匹配、守卫、分析用**同一基准**。
 *
 * 钉：带 `?t=` / `?v=` 的 id 与不带 query 的 id **产出同样的诊断**。
 */







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
const SRC = `export function getName(user) {
  return user.name;
}
`;

function fixture(): { dir: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-903-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug903", private: true }),
    "utf-8",
  );
  const id = join(dir, "dev-a.js");
  writeFileSync(id, SRC, "utf-8");
  return { dir, id };
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

describe("HMR 的 ?t= query id 不得让整份文件被跳过", () => {
  it("带 ?t=<ts> 的 id 与不带 query 的 id 产出同样的诊断", async () => {
    const { dir, id } = fixture();
    try {
      const plain = await diagnosticsOf(nudoPlugin(), SRC, id);
      const hmr = await diagnosticsOf(nudoPlugin(), SRC, `${id}?t=123456`);

      expect(plain.length).toBeGreaterThan(0);
      expect(plain.join("\n")).toContain("nudo:entry-may-throw");
      // 改前：带 query 的 id 一条诊断都没有（整份被跳过 ⇒ dev 期假绿）。
      expect(hmr.length).toBe(plain.length);
      expect(hmr.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("带 ?v=<hash> 的 id 同样不被跳过", async () => {
    const { dir, id } = fixture();
    try {
      const diags = await diagnosticsOf(nudoPlugin(), SRC, `${id}?v=deadbeef`);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("自定义 include 模式也按剥 query 后的路径匹配", async () => {
    const { dir, id } = fixture();
    try {
      const diags = await diagnosticsOf(
        nudoPlugin({ include: ["**/*.js"] }),
        SRC,
        `${id}?t=123456`,
      );
      expect(diags.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// failOnError 档下每条 error 诊断都要上报
// ---------------------------------------------------------------------------
describe("failOnError 档下每条 error 诊断都要上报", () => {
/**
 * `failOnError: true` 只报**第一条** error，其余 error 级诊断被
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

describe("failOnError 档下每条 error 诊断都要上报", () => {
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
});

// ---------------------------------------------------------------------------
// 无源位置的诊断不渲染位置（不写 :0:0）
// ---------------------------------------------------------------------------
describe("无源位置的诊断不渲染位置（不写 :0:0）", () => {
/**
 * vite-plugin 把「**无源位置**」的诊断渲染成 `:0:0`（行号越界）
 * / `:1:0`（编造第 1 行）⇒ 构建日志里的位置**不可信**（CLI 同一诊断**不打位置**）。
 *
 * 根因（插件侧）：`report.ts` 的 `renderDiagnostic` 把 `diag.range.start.line`
 * **原样**写进 `path:line:col`，**不区分「真位置」与占位 0** ⇒ 上游
 * service 的占位 range `{line: 0, column: 0}`（指令文法诊断 / mock 绑定失败等）
 * 直接变成用户可见的 `:0:0`。
 *
 * 修法：**位置缺失 ⇒ 省略 `:line:col`**（`line <= 0` 视为「无位置」）——
 * 与 CLI 人类面同口径（`core/src/algebra/check-report.ts`：
 * `const loc = i.line != null ? \`L${i.line}\` : ""` ⇒ 无位置就不打位置）。
 *
 * 钉：无位置诊断**不再**渲染 `:0:0`；有真位置的诊断**仍**渲染 `:line:col`。
 */







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

/**
 * mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`，
 * 其 range 是上游的**占位** `{line: 0, column: 0}` ⇒ 插件此前渲染成 `:0:0`。
 */
const SRC = `// @nudo:mock dep from "./nope.js"
export function useDep(x) {
  return dep(x);
}
`;

async function reported(id: string): Promise<string[]> {
  const plugin = nudoPlugin();
  const warns: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => {
      throw new Error(m);
    },
    info: (m: string) => warns.push(String(m)),
  };
  await transformOf(plugin).call(ctx, SRC, id);
  return warns;
}

describe("无源位置的诊断不渲染位置（不写 :0:0）", () => {
  it("占位 range（line 0）⇒ 省略 :line:col，且不出现越界行号", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-982-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const msgs = await reported(id);
      expect(msgs.length, JSON.stringify(msgs)).toBeGreaterThan(0);

      // 越界位置（行号 0）不得出现
      expect(msgs.some((m) => m.includes(":0:0"))).toBe(false);
      // 编造的第 1 行也不得出现（无位置 ⇒ 整段位置省略）
      expect(msgs.some((m) => m.includes(`${id}:1:0`))).toBe(false);

      const mockMsg = msgs.find((m) => m.includes("nudo:module-missing"));
      expect(mockMsg, JSON.stringify(msgs)).toBeDefined();
      // 无位置 ⇒ `[nudo] <id> <severity>: <message>`（位置整段省略）
      expect(mockMsg).toMatch(
        new RegExp(`^\\[nudo\\] ${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} error: `),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("真位置仍照旧渲染 :line:col（不回归）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-982-real-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const msgs = await reported(id);
      const located = msgs.find((m) => m.includes("nudo:entry-may-throw"));
      expect(located, JSON.stringify(msgs)).toBeDefined();
      expect(located).toMatch(/:\d+:\d+ error: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// 跨模块返回契约真违例 ⇒ error 级 constraint-violated（failOnError 拦得住）
// ---------------------------------------------------------------------------
describe("跨模块返回契约真违例 ⇒ error 级 constraint-violated（failOnError 拦得住）", () => {
/**
 * 回归（vite-plugin 构建期）：**同 898 的反方向面** —— 跨模块
 * 返回契约**真违例**时，插件必须给出 **error** 级的
 * `nudo:constraint-violated`，而不是被降级成 **warning** 级的
 * `nudo:unproven-return`。
 *
 * 危害（假绿）：「证不出来」时插件只能给弱断言（warning）⇒
 * `failOnError: true` 也放行 ⇒ **门禁失效**（CI 假绿）。
 *
 * 现状：**族 18（`169ed526`）的 `buildViteCheckInjection` 已经把
 * `modules`（+ `inject`）一起传给 `checkSource`** ⇒ 模块图到位后，
 * 真违约回到 CLI 的 `nudo:constraint-violated`（error）⇒ 本条早已闭合；
 * 本钉的作用是**锁住「必须回到 error 级」这一面**（与 的钉
 * 合起来覆盖同一根因的两个方向）。
 *
 * 负控制：返回契约**可证**时不得报 error（见 的钉）。
 */







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

const LIB_SRC = `export function double(n) {
  return n * 2;
}
`;
const LIB_SIDECAR = `export const double = fn({ n: number() }, number());
`;
const APP_SRC = `import { double } from "./lib.js";
export function run(n) {
  return double(n);
}
`;
/** 真违例：run 声明返回 string()，实际返回 number */
const APP_SIDECAR_VIOLATION = `export const run = fn({ n: number() }, string());
`;

type Run = { warns: string[]; errors: string[]; infos: string[]; thrown?: string };

async function runPlugin(
  dir: string,
  options: Record<string, unknown> = {},
): Promise<Run> {
  const plugin = nudoPlugin(options);
  const warns: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    // 真实 Rollup/Vite 语义：this.error 抛异常
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
    info: (m: string) => infos.push(String(m)),
  };
  const file = join(dir, "app.js");
  const out: Run = { warns, errors, infos };
  try {
    await transformOf(plugin).call(ctx, APP_SRC, file);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  return out;
}

function project(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "nudo-vite-bug-983", private: true }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), LIB_SIDECAR, "utf-8");
  writeFileSync(join(dir, "app.js"), APP_SRC, "utf-8");
  writeFileSync(join(dir, "app.nudo.js"), APP_SIDECAR_VIOLATION, "utf-8");
}

describe("跨模块返回契约真违例 ⇒ error 级 constraint-violated（failOnError 拦得住）", () => {
  it("真违例必须是 nudo:constraint-violated 且为 error 级（不是 warning 级 unproven-return）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-983-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: false });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:constraint-violated");
      expect(all).not.toContain("nudo:unproven-return");
      // error 级诊断的上屏文本必须自带 "error:"（severity 三档原样带出）
      expect(all).toContain("error:");
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("failOnError=true ⇒ 真违例必须中断构建（this.error 被调用并抛出）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-983b-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: true });
      expect(r.errors.join("\n")).toContain("nudo:constraint-violated");
      expect(r.thrown).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// 两个诊断来源的文本格式归一（都带 (nudo:code)）
// ---------------------------------------------------------------------------
describe("两个诊断来源的文本格式归一（都带 (nudo:code)）", () => {
/**
 * vite-plugin 的 **evaluator 面**诊断**丢掉 `(nudo:code)`** ⇒
 * 同一次构建里两种诊断**两种文本格式**，日志里**无法按码检索**。
 *
 * 根因：两个诊断来源走**两套装配路径** —— check 面自己拼 `parts`（带码），
 * evaluator 面直接用 `diag.message`（`diag.code` **从不读**）⇒ evaluator 面的
 * 码恒丢 ⇒ `grep '(nudo:'` 只能捞到一半的诊断。
 *
 * 修法：消息装配**统一出口**（`report.ts` 的 `renderDiagnostic`）：两个来源
 * 都追加 ` (<code>)`；消息尾部已自带同码时**剥掉再统一追加** ⇒ 分隔符也归一。
 *
 * 钉：evaluator 面诊断带码；同一次构建里两类诊断**同款**结尾；
 * 码**不重复**（不出现 `(nudo:x) … (nudo:x)`）。
 */







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

/**
 * mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`（码在
 * `diag.code` 字段里，此前插件**从不读** ⇒ 码恒丢）；同一文件里 check 面
 * 另有一条 `nudo:entry-may-throw`（码由 check 面自拼）⇒ 两种文本格式并存。
 */
const SRC = `// @nudo:mock dep from "./nope.js"
export function useDep(x) {
  return dep(x);
}
`;

async function reported(id: string): Promise<string[]> {
  const plugin = nudoPlugin();
  const warns: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => {
      throw new Error(m);
    },
    info: (m: string) => warns.push(String(m)),
  };
  await transformOf(plugin).call(ctx, SRC, id);
  return warns;
}

describe("两个诊断来源的文本格式归一（都带 (nudo:code)）", () => {
  it("evaluator 面诊断也带 (nudo:code)（此前恒丢）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-987-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const msgs = await reported(id);
      const mockMsg = msgs.find((m) => m.includes("Mock file not found"));
      expect(mockMsg, JSON.stringify(msgs)).toBeDefined();
      expect(mockMsg).toContain("(nudo:module-missing)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("同一次构建里两类诊断同款结尾（ ·  (code) 分隔符归一）且码不重复", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-987-uniform-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const msgs = await reported(id);
      const coded = msgs.filter((m) => /\(nudo:[a-z-]+\)$/.test(m.trim()));
      expect(coded.length, JSON.stringify(msgs)).toBe(msgs.length);
      for (const m of msgs) {
        const codes = m.match(/\(nudo:[a-z-]+\)/g) ?? [];
        expect(codes.length, m).toBe(1);
        // 码与消息之间只有一个空格（不带 ` · ` 分隔）
        expect(m).toMatch(/ \(nudo:[a-z-]+\)$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});
