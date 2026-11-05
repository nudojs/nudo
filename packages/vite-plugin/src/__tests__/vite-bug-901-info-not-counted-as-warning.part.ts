/**
 * Bug 901 —— `buildEnd` 汇总行把 **info 级诊断算成 warning**，而这些 info
 * **从头到尾没被打印过** ⇒ 汇总行与构建日志自相矛盾。
 *
 * 报告原断言：汇总行 `[nudo] Analysis complete: X error(s), Y warning(s)` 里的
 * `Y` 包含了 info 级诊断；同时 info 级诊断在构建日志里**一行都没有** ⇒
 * 「说 Y 条告警，日志里一条告警都找不到」。
 *
 * ⚠ **本片是族 30 唯一的假阳性片**：核心症状已被**族 26**（提交 `f87c9f9d`
 * 的「Bug 779 vite 半」）修掉 —— `warnCount` 改成只数 `severity === "warning"`，
 * 上报循环新增 info → `this.info` 分支 ⇒ **本文件不改任何实现**，只补
 * **反向守护钉**：钉住这两条**已成立**的行为。
 *
 * 钉住（两条）：
 * 1. **info 不计入 warning 计数** —— 汇总行的 `Y warning(s)` 只数 warning 级
 *    诊断；info 级诊断不计入，且汇总行**不得**比「实际 warning 条数」多。
 * 2. **info 走 `this.info` 上屏** —— info 级诊断出现在 vite 的 **info 通道**，
 *    **不混进 warn 流**（否则 info 冒充告警）。
 *
 * 与族 26 的 `vite-bug-779-info-level-diagnostics.test.ts` 的分工：779 钉的是
 * **check 面** info（`nudo:assume-relied`，verbose 档）上屏；本钉钉的是
 * **evaluator 面** info（不可达代码 / 无契约根）**与汇总计数口径** ⇒ 不重复。
 *
 * ⚠ 汇总行的**输出通道**（S3 的 Bug 1002 已把它从裸 `console.log` 迁到 Vite
 * logger 的 info 通道）**不在**本钉的断言面内 ⇒ 本钉从「console.log + vite 的
 * warn/info 两条通道」三处一起找汇总行 ⇒ 通道迁移前后本钉都成立。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

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

describe("Bug 901 —— info 不计入 warning 计数 + info 走 this.info 上屏", () => {
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
