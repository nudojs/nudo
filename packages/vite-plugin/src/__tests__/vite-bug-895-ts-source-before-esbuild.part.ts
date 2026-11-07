import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, createLogger } from "vite";
import nudoPlugin from "../index.ts";

/**
 * Bug 895 —— 插件对象缺 `enforce: "pre"` ⇒ 排在核心插件 `vite:esbuild` **之后**
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

describe("vite-plugin-nudo Bug 895 — enforce: 'pre'（TS 源码里的 @nudo: 指令必须可见）", () => {
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
