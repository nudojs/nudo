/**
 * 族 30 · S0（串行前置 · 只抽不改）—— **薄壳钉**（只经由**公共面**断言）。
 *
 * 本片**不吸收任何 bug**（895 / 896 / 897 / 898 / 899 / 900 / 902 / 903 / 904 /
 * 982 / 983 / 987 / 1002 / 1018 / 1056 全部留给 S1–S4）⇒ 本钉锁的是
 * **「重构前后行为不变」**，不是「某个 bug 被修好了」。
 *
 * 本文件**只 import `../index.ts`**（公共面）⇒ 可以在 **HEAD（重构前）**上
 * 原样跑通 ⇒ **反向闸（闸④）在本文件上必须通过**（本片唯一的闸④例外面：
 * 钉的是「等价」而不是「修好的行为」）。
 *
 * 锁住：
 * 1. **薄壳的公共导出面**：`index.ts` 的运行时导出**有且只有** `default`
 *    （`export type NudoPluginOptions` 是类型导出，不在运行时面上）⇒
 *    三个内部模块（`scope.ts` / `check-assembly.ts` / `report.ts`）
 *    **零新增公共导出**（S1–S4 不许从 `index.ts` re-export）。
 * 2. **可观测行为逐字不变**：诊断文本格式（`[nudo] <id>:<line>:<col> <sev>: <msg>`）、
 *    三条上报通道的路由（error / warning → warn，info → info）、`failOnError`
 *    的红构建语义、`buildEnd` 汇总行文本。
 * 3. **一条端到端构建行为**（真 `vite build`）：契约违例经 vite logger 上屏、
 *    构建成功、产物落盘。
 *
 * ⚠ 三个内部模块的**签名契约**在 `vite-s0-module-contracts.test.ts` 里
 * （那三个模块在 HEAD 上**不存在** ⇒ 那一面是**前向锁**，不参与反向闸）。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createLogger } from "vite";
import type { Plugin } from "vite";
import * as pluginModule from "../index.ts";
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

type Captured = { warns: string[]; infos: string[]; errors: string[]; thrown?: string };

async function drive(
  options: Record<string, unknown>,
  code: string,
  id: string,
): Promise<Captured> {
  const plugin = nudoPlugin(options);
  const warns: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const out: Captured = { warns, infos, errors };
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    info: (m: string) => infos.push(String(m)),
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
  };
  try {
    await transformOf(plugin).call(ctx, code, id);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  return out;
}

/** build() 联合返回里取单次构建 RollupOutput 的首个 JS chunk（本套件非 watch/数组形态）。 */
function firstChunk(result: Awaited<ReturnType<typeof build>>): { fileName: string } | undefined {
  const single = Array.isArray(result) ? result[0] : result;
  if (!single || !("output" in single)) return undefined;
  return single.output.find((o) => o.type === "chunk");
}

/** 收集 vite logger 的插件诊断（不透传，保持测试输出干净）。 */
function captureWarnings(): { logger: ReturnType<typeof createLogger>; warnings: string[] } {
  const warnings: string[] = [];
  const logger = createLogger("warn");
  logger.warn = (msg: string) => {
    warnings.push(msg);
  };
  return { logger, warnings };
}

describe("族 30 S0 —— 薄壳的公共导出面（零新增公共导出）", () => {
  it("index.ts 的运行时导出有且只有 default", () => {
    expect(Object.keys(pluginModule).sort()).toEqual(["default"]);
    expect(typeof pluginModule.default).toBe("function");
  });

  it("默认导出的仍是 vite 插件对象（name 不变）", () => {
    const plugin = nudoPlugin();
    expect(plugin.name).toBe("vite-plugin-nudo");
  });

  it("NudoPluginOptions 的三个可选字段一字未改（运行时仍被接受）", () => {
    const plugin = nudoPlugin({
      include: ["**/*.js"],
      exclude: ["**/vendor/**"],
      failOnError: true,
    });
    expect(plugin.name).toBe("vite-plugin-nudo");
  });
});

describe("族 30 S0 —— 可观测行为逐字不变", () => {
  it("诊断文本格式不变：[nudo] <id>:<line>:<col> <severity>: <message>", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-s0-fmt-"));
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

      const out = await drive({}, source, filePath);
      expect(out.warns.length).toBeGreaterThan(0);
      for (const w of out.warns) {
        expect(w).toMatch(
          new RegExp(
            `^\\[nudo\\] ${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d+:\\d+ (error|warning|info): `,
          ),
        );
      }
      expect(out.warns.join("\n")).toContain("constraint-violated");
      expect(out.errors).toEqual([]);
      expect(out.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("info 级诊断走 info 通道，不混进 warn 流（verbose 档）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-s0-info-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "s0-info",
          private: true,
          type: "module",
          nudo: { analysis: { diagnostics: "verbose" } },
        }),
        "utf-8",
      );
      const source = `/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;
      const filePath = join(dir, "sim.js");
      writeFileSync(filePath, source, "utf-8");
      writeFileSync(
        join(dir, "sim.nudo.js"),
        `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`,
        "utf-8",
      );

      const out = await drive({}, source, filePath);
      const infoHits = out.infos.filter((m) => m.includes("nudo:assume-relied"));
      expect(infoHits.length, JSON.stringify(out)).toBeGreaterThan(0);
      expect(out.warns.filter((m) => m.includes("nudo:assume-relied")).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("failOnError: true 时 this.error 收首条 error 诊断并抛（红构建）", async () => {
    const source = `export function getName(user) {
  return user.name;
}
`;
    const out = await drive({ failOnError: true }, source, "/test/s0-fail.js");
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.errors[0]).toMatch(/^\[nudo\] \/test\/s0-fail\.js:\d+:\d+ error: /);
    expect(out.thrown).toBe(out.errors[0]);
    // failOnError 档下 error 级诊断**不**进 warn 流
    expect(out.warns.filter((m) => m.includes("error:")).length).toBe(0);
  });

  it("failOnError 默认 false：error 级诊断降 warn，不抛", async () => {
    const source = `export function getName(user) {
  return user.name;
}
`;
    const out = await drive({}, source, "/test/s0-warn.js");
    expect(out.errors).toEqual([]);
    expect(out.thrown).toBeUndefined();
    expect(out.warns.join("\n")).toContain("error:");
  });

  it("buildEnd 的汇总行文本不变（[nudo] Analysis complete: X error(s), Y warning(s)）", async () => {
    const source = `export function getName(user) {
  return user.name;
}
`;
    const plugin = nudoPlugin();
    const warns: string[] = [];
    const infos: string[] = [];
    const ctx = {
      warn: (m: string) => warns.push(String(m)),
      info: (m: string) => infos.push(String(m)),
      error: (m: string) => {
        throw new Error(String(m));
      },
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    let summary: string[] = [];
    let logged: string[] = [];
    try {
      hookFn(plugin.buildStart).call(ctx);
      await transformOf(plugin).call(ctx, source, "/test/s0-summary.js");
      hookFn(plugin.buildEnd).call(ctx);
      // ⚠ `mockRestore()` 会**清空** `mock.calls` ⇒ 必须在 restore 之前取。
      logged = spy.mock.calls.map((c) => String(c[0]));
      // ⚠ **S3 更新（族 30 · S3 · Bug 1002）**：汇总行改走 **vite logger**
      // （`this.info`）⇒ 不再从 `console.log` 逃逸（否则 `logLevel:"silent"`
      // 挡不住它）。文本本身**逐字不变**。
      summary = infos.filter((m) => m.includes("Analysis complete"));
    } finally {
      spy.mockRestore();
    }
    expect(summary).toEqual(["[nudo] Analysis complete: 1 error(s), 0 warning(s)"]);
    // 汇总行不再走 console.log（破坏性行为变更，见 changeset）
    expect(logged.filter((l) => l.includes("Analysis complete"))).toEqual([]);
  });
});

describe("族 30 S0 —— 端到端：契约违例经 vite logger 上屏且构建成功", () => {
  it(
    "真 vite build：诊断走 this.warn，构建成功、产物落盘",
    { timeout: 120_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-vite-s0-e2e-"));
      try {
        writeFileSync(
          join(dir, "shapes.nudo.js"),
          `export const positive = number().gt(0);\n`,
          "utf-8",
        );
        writeFileSync(
          join(dir, "main.js"),
          `/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  return x;
}
const r = needsPositive(-1);
export const entry = needsPositive;
`,
          "utf-8",
        );

        const { logger, warnings } = captureWarnings();
        const result = await build({
          root: dir,
          configFile: false,
          customLogger: logger,
          plugins: [nudoPlugin()],
          build: {
            minify: false,
            outDir: "dist",
            rollupOptions: {
              input: join(dir, "main.js"),
              preserveEntrySignatures: "strict",
            },
          },
        });

        const chunk = firstChunk(result);
        expect(chunk).toBeTruthy();
        const outPath = join(dir, "dist", chunk!.fileName);
        expect(existsSync(outPath)).toBe(true);
        expect(readFileSync(outPath, "utf-8")).toContain("needsPositive");

        const msgs = warnings.join("\n");
        expect(msgs).toContain("[nudo]");
        expect(msgs).toContain("constraint-violated");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
