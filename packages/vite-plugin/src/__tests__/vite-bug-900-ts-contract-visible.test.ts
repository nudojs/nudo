import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, createLogger } from "vite";
import nudoPlugin from "../index.ts";

/**
 * Bug 900 —— Bug 895 的**反方向面**：插件对象缺 `enforce: "pre"` ⇒ 排在
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

describe("vite-plugin-nudo Bug 900 — enforce: 'pre'（.ts 源的契约不得被静默放绿）", () => {
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
