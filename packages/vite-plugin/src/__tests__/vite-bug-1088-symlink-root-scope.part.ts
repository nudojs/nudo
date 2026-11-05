/**
 * Bug 1088 —— 工程根含**软链**时，全部源文件被判「依赖」⇒ 插件**静默空转**
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
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";
import { scopeDecision, setProjectRoot } from "../scope.ts";

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

describe("Bug 1088 —— 软链工程根下的源文件不得被判「依赖」", () => {
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
