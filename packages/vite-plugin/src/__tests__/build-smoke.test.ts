import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createLogger } from "vite";
import nudoPlugin from "../index.ts";

/**
 * 真实 vite build 冒烟：既有套件只驱动 plugin.transform 的 hook fn，
 * 不经过 Rollup/Vite 宿主——本套件用 vite 的 build API 起真实构建
 * （configFile: false + 内联插件，devDep vite 对齐本包 peer 语义），
 * 锁三条端到端链路：
 * 1. 构建成功 + 产物落盘且内容正确（插件 transform 返回 null 不改产物）；
 * 2. 诊断经 this.warn 走 vite onwarn → 构建日志（默认 failOnError=false 不红构建）；
 * 3. failOnError: true 时 this.error 传播为构建失败。
 * 插件是诊断面产品（无 dts/schema emit），「产物」= dist bundle + 构建日志。
 */

/** 收集 vite logger.warn 的插件诊断（不透传，保持测试输出干净）。 */
function captureWarnings(): { logger: ReturnType<typeof createLogger>; warnings: string[]; infos: string[] } {
  const warnings: string[] = [];
  const infos: string[] = [];
  const logger = createLogger("warn");
  logger.warn = (msg: string, _opt?: unknown) => {
    warnings.push(msg);
  };
  // ⚠ **S3 更新（族 30 · S3 · Bug 1002）**：buildEnd 的**汇总行**改走 vite
  // logger 的 info 通道（原先走裸 console.log ⇒ 逃出 `build.logLevel` 契约）⇒
  // 这里把 info 通道也接出来（`createLogger("warn")` 默认会静音 info）。
  logger.info = (msg: string, _opt?: unknown) => {
    infos.push(msg);
  };
  return { logger, warnings, infos };
}

/** build() 联合返回里取单次构建 RollupOutput 的首个 JS chunk（本套件非 watch/数组形态）。 */
function firstChunk(result: Awaited<ReturnType<typeof build>>): { fileName: string } | undefined {
  const single = Array.isArray(result) ? result[0] : result;
  if (!single || !("output" in single)) return undefined;
  return single.output.find((o) => o.type === "chunk");
}

function buildFixture(root: string, entryRel: string, failOnError = false) {
  const { logger, warnings, infos } = captureWarnings();
  const buildPromise = build({
    root,
    configFile: false,
    customLogger: logger,
    plugins: [nudoPlugin({ failOnError })],
    build: {
      minify: false,
      outDir: "dist",
      rollupOptions: {
        input: join(root, entryRel),
        // JS 入口无 html/库消费方时 rollup 会把入口导出 tree-shake 成空
        // chunk——锁 strict 保住导出面，bundle 内容断言才有意义
        preserveEntrySignatures: "strict",
      },
    },
  });
  return { buildPromise, warnings, infos };
}

describe("vite-plugin-nudo real build smoke", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 最小 fixture 项目（mkdtemp 注册统一清理；嵌套路径直接拼 rel 写入）。 */
  function fixture(prefix: string, files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(dir, rel), content, "utf-8");
    }
    return dir;
  }

  it(
    "@nudo:contract 违例以构建 warning 呈现，构建成功且产物落盘",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-smoke-contract-", {
        // 契约模板文件：真实磁盘文件（loadModule 按 fromFile 相对解析）
        "shapes.nudo.js": `export const positive = number().gt(0);\n`,
        "main.js": `/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return x;
}
const r = needsPositive(-1);
export const entry = needsPositive;
`,
      });

      const { buildPromise, warnings } = buildFixture(dir, "main.js");
      const result = await buildPromise;

      // 产物：插件 transform 返回 null，代码原样进 bundle（minify 关）。
      // JS 入口无 html 时 vite 输出 assets/[name]-[hash].js，从 result.output 定位。
      const chunk = firstChunk(result);
      expect(chunk).toBeTruthy();
      const outPath = join(dir, "dist", chunk!.fileName);
      expect(existsSync(outPath)).toBe(true);
      const bundled = readFileSync(outPath, "utf-8");
      expect(bundled).toContain("needsPositive");

      // 诊断：L1 constraint-violated 经 this.warn → vite onwarn → 构建日志
      const msgs = warnings.join("\n");
      expect(msgs).toContain("[nudo]");
      expect(msgs).toContain("constraint-violated");
    },
  );

  it(
    "L2 entry-may-throw 默认降 warn 不红构建，buildEnd 打汇总行",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-smoke-throw-", {
        "entry.js": `export function getName(user) {
  return user.name;
}
`,
      });

      const summary = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const { buildPromise, warnings, infos } = buildFixture(dir, "entry.js");
        await buildPromise; // 默认 failOnError=false：不因 error 级诊断失败

        const msgs = warnings.join("\n");
        expect(msgs).toContain("[nudo]");
        expect(msgs).toMatch(/entry-may-throw/);

        // buildEnd 汇总行（**走 vite logger 的 info 通道** —— S3 / Bug 1002：
        // 原先走 console.log，会逃出 `build.logLevel` 契约）：
        // entry-may-throw 计入 error 档
        const logged = infos.join("\n");
        expect(logged).toMatch(
          /\[nudo\] Analysis complete: [1-9]\d* error\(s\), \d+ warning\(s\)/,
        );
      } finally {
        summary.mockRestore();
      }
    },
  );

  it(
    "无诊断入口构建零 nudo 噪声（不误伤干净项目）",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-smoke-clean-", {
        // 纯恒等入口：无 ToNumber/ToString 强转、无成员读 → L2 不触发
        "entry.js": `export function id(x) {
  return x;
}
export const answer = 42;
`,
      });

      const summary = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const { buildPromise, warnings, infos } = buildFixture(dir, "entry.js");
        const result = await buildPromise;
        const chunk = firstChunk(result);
        expect(chunk).toBeTruthy();
        expect(readFileSync(join(dir, "dist", chunk!.fileName), "utf-8")).toContain(
          "function id",
        );

        expect(warnings.join("\n")).not.toContain("[nudo]");
        // 汇总行现在走 vite logger 的 info 通道（S3 / Bug 1002）⇒ 干净工程
        // 既不上 console.log 也不上 info 通道。
        expect(infos.join("\n")).not.toContain("[nudo] Analysis complete");
        expect(summary.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(
          "[nudo] Analysis complete",
        );
        // 两个导出均存活 → 空_chunk 警告也不会出现，bundle 有内容
        expect(existsSync(join(dir, "dist"))).toBe(true);
      } finally {
        summary.mockRestore();
      }
    },
  );

  it(
    "failOnError: true 时诊断经 this.error 红构建",
    { timeout: 120_000 },
    async () => {
      const dir = fixture("nudo-vite-smoke-fail-", {
        "entry.js": `export function getName(user) {
  return user.name;
}
`,
      });

      const { buildPromise } = buildFixture(dir, "entry.js", true);
      await expect(buildPromise).rejects.toThrow(/\[nudo\]/);
    },
  );
});
