/**
 * 族 30 · S0（串行前置 · 只抽不改）—— **三个内部模块的签名契约钉**。
 *
 * 本片**不吸收任何 bug** ⇒ 本钉锁的是 S0 冻结下来的**模块边界与函数签名**
 * （S1 / S2 / S3 / S4 只能消费，不许改签名；要改 ⇒ 回 S0 改并通知全族）。
 *
 * ⚠ **闸④（反向闸）不适用于本文件**：`scope.ts` / `check-assembly.ts` /
 * `report.ts` 在 **HEAD（重构前）上不存在** ⇒ 本文件在 HEAD 上**无法加载**
 * （这是「新增面」的必然结果，与「假阳性钉」不同）。可反向闸的那一面在
 * `vite-s0-thin-shell.test.ts`（只经由公共面断言 ⇒ HEAD 上必须通过）。
 *
 * 覆盖：
 * - `scope.ts`：`normalizeModuleId` / `isVirtualModuleId` / `setProjectRoot` /
 *   `configureScope` / `scopeDecision`（三处早退的唯一落点）/ 默认匹配表。
 * - `check-assembly.ts`：`assembleCheckOutcome` 的中间态形状（位置与 code
 *   **原样带出**，不自己拼文本）。
 * - `report.ts`：`renderDiagnostic`（位置与消息装配的**唯一出口**）/
 *   `emitDiagnostics`（三条通道的路由 + `failOnError` 聚合）/
 *   `logAnalysisSummary`（汇总行文本）。
 *
 * ⚠ **S3 更新（族 30 · S3）**：本文件原是「S0 重构前后行为等价」的钉；
 * S3 按主 agent 裁决**故意**改了两处可观测行为（**签名契约未变**）：
 * **Bug 987**（消息统一追加 ` (<code>)`）与 **Bug 1002**（汇总行改走
 * vite logger，不再 `console.log`）⇒ 相关断言已随之更新并在用例内注明。
 * - `index.ts` 的 `configResolved` 惰性钩子（只记录 `config.root`）。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nudoPlugin from "../index.ts";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
  configureScope,
  getProjectRoot,
  isVirtualModuleId,
  normalizeModuleId,
  scopeDecision,
  setProjectRoot,
} from "../scope.ts";
import { assembleCheckOutcome } from "../check-assembly.ts";
import {
  emitDiagnostics,
  logAnalysisSummary,
  renderDiagnostic,
  type ReportContext,
} from "../report.ts";

describe("族 30 S0 —— scope.ts 的契约（只抽不改）", () => {
  it("normalizeModuleId 剥 query，不动无 query 的 id", () => {
    expect(normalizeModuleId("/a/b.js?t=123456")).toBe("/a/b.js");
    expect(normalizeModuleId("/a/b.js?v=deadbeef")).toBe("/a/b.js");
    expect(normalizeModuleId("/a/b.js")).toBe("/a/b.js");
  });

  it("isVirtualModuleId 认 \\0 前缀与 virtual: 前缀", () => {
    expect(isVirtualModuleId("\0virtual:mod2.js")).toBe(true);
    expect(isVirtualModuleId("virtual:mod2.js")).toBe(true);
    expect(isVirtualModuleId("/project/src/main.js")).toBe(false);
  });

  it("setProjectRoot 记录 config.root（S0 惰性：只记录不消费）", () => {
    setProjectRoot("/tmp/nudo-s0-root");
    expect(getProjectRoot()).toBe("/tmp/nudo-s0-root");
    setProjectRoot(undefined);
    expect(getProjectRoot()).toBeUndefined();
  });

  it("默认 include / exclude 表与重构前一致", () => {
    expect(DEFAULT_INCLUDE).toEqual(["**/*.js", "**/*.mjs", "**/*.ts"]);
    expect(DEFAULT_EXCLUDE).toEqual(["**/node_modules/**", "**/*.d.ts"]);
  });

  it("scopeDecision 的三处早退：exclude → include → 守卫", () => {
    // exclude 优先于 include
    configureScope({ include: ["**/*.js"], exclude: ["**/vendor/**"] });
    expect(scopeDecision("/x/vendor/a.js", "const a = 1;")).toEqual({
      skip: true,
      reason: "exclude",
    });
    // include 失配
    expect(scopeDecision("/x/a.ts", "const a = 1;")).toEqual({
      skip: true,
      reason: "include",
    });
    // 守卫（无指令、无入口面 ⇒ shouldAnalyzeFile 拒绝）
    expect(scopeDecision("/x/plain.js", "const a = 1;")).toEqual({
      skip: true,
      reason: "guard",
    });
    // 放行（有入口面）
    expect(
      scopeDecision(
        "/x/entry.js",
        "export function getName(user) {\n  return user.name;\n}\n",
      ),
    ).toEqual({ skip: false, reason: "analyze" });
    // 复位到默认（后续用例不依赖上一个用例的匹配器）
    configureScope({});
  });
});

describe("族 30 S0 —— check-assembly.ts 的契约（只抽不改）", () => {
  it("assembleCheckOutcome 产出带 code 与位置的中间态（不自己拼文本）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-s0-check-"));
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

      const outcome = assembleCheckOutcome(filePath, source);
      expect(outcome.failure).toBeUndefined();
      expect(outcome.diagnostics.length).toBeGreaterThan(0);
      const hit = outcome.diagnostics.find((d) => d.code === "nudo:constraint-violated");
      expect(hit, JSON.stringify(outcome.diagnostics)).toBeTruthy();
      expect(hit!.severity).toBe("error");
      expect(hit!.message).toContain("constraint-violated");
      // 位置是**原样带出**的（行/列都在 range 里），文本拼装不归本模块。
      expect(hit!.range.start.line).toBeGreaterThan(0);
      expect(hit!.range.start.column).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("族 30 S0 —— report.ts 的契约（只抽不改）", () => {
  const diag = (severity: "error" | "warning" | "info") => ({
    severity,
    message: `boom-${severity}`,
    code: "nudo:demo",
    range: { start: { line: 3, column: 5 }, end: { line: 3, column: 6 } },
  });

  // ⚠ **S3 更新（族 30 · S3 = 982 / 987 / 1002 的落点）**：本组断言原为
  // 「S0 重构前后逐字一致」的**等价性钉**；S3 按主 agent 裁决**故意**改了两处
  // 可观测行为 ⇒ 本钉随之更新（**签名契约未变**）：
  // - **Bug 987**：两个诊断来源的消息**统一**在尾部追加 ` (<code>)`
  //   ⇒ `renderDiagnostic` 的输出多出码后缀（此前 evaluator 面恒丢码）。
  // - **Bug 1002**：汇总行改走 **Vite logger**（`ctx.info` → `ctx.warn` 兜底），
  //   **不再**用裸 `console.log` ⇒ 汇总行不再出现在 console.log 上。
  it("renderDiagnostic 是位置与消息装配的唯一出口（逐字 + 码后缀）", () => {
    expect(renderDiagnostic("/a/b.js", diag("error"))).toBe(
      "[nudo] /a/b.js:3:5 error: boom-error (nudo:demo)",
    );
    expect(renderDiagnostic("/a/b.js", diag("warning"))).toBe(
      "[nudo] /a/b.js:3:5 warning: boom-warning (nudo:demo)",
    );
    expect(renderDiagnostic("/a/b.js", diag("info"))).toBe(
      "[nudo] /a/b.js:3:5 info: boom-info (nudo:demo)",
    );
  });

  it("renderDiagnostic 位置缺失时省略 :line:col（Bug 982）", () => {
    expect(
      renderDiagnostic("/a/b.js", {
        severity: "error",
        message: "boom",
        code: "nudo:demo",
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
      }),
    ).toBe("[nudo] /a/b.js error: boom (nudo:demo)");
  });

  it("emitDiagnostics 的三条通道路由：error→数组 / warning→warn / info→info", () => {
    const warns: string[] = [];
    const infos: string[] = [];
    const ctx: ReportContext = {
      id: "/a/b.js",
      failOnError: true,
      warn: (m) => warns.push(m),
      error: (m) => {
        throw new Error(m);
      },
      info: (m) => infos.push(m),
    };
    const fatal = emitDiagnostics(ctx, [diag("error"), diag("warning"), diag("info")]);
    expect(fatal).toEqual(["[nudo] /a/b.js:3:5 error: boom-error (nudo:demo)"]);
    expect(warns).toEqual(["[nudo] /a/b.js:3:5 warning: boom-warning (nudo:demo)"]);
    expect(infos).toEqual(["[nudo] /a/b.js:3:5 info: boom-info (nudo:demo)"]);
  });

  it("emitDiagnostics 在 failOnError=false 时 error 走 warn 通道（不红构建）", () => {
    const warns: string[] = [];
    const ctx: ReportContext = {
      id: "/a/b.js",
      failOnError: false,
      warn: (m) => warns.push(m),
      error: () => {
        throw new Error("must not be called");
      },
    };
    const fatal = emitDiagnostics(ctx, [diag("error")]);
    expect(fatal).toEqual([]);
    expect(warns).toEqual(["[nudo] /a/b.js:3:5 error: boom-error (nudo:demo)"]);
  });

  it("emitDiagnostics 在宿主没有 info 通道时静默丢弃 info（不报错）", () => {
    const warns: string[] = [];
    const ctx: ReportContext = {
      id: "/a/b.js",
      failOnError: false,
      warn: (m) => warns.push(m),
      error: () => {},
    };
    expect(emitDiagnostics(ctx, [diag("info")])).toEqual([]);
    expect(warns).toEqual([]);
  });

  it("logAnalysisSummary 的汇总行走 vite logger（Bug 1002：不再 console.log）", () => {
    const warns: string[] = [];
    const infos: string[] = [];
    const ctx: ReportContext = {
      id: "",
      failOnError: false,
      warn: (m) => warns.push(m),
      error: () => {},
      info: (m) => infos.push(m),
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logAnalysisSummary(ctx, 2, 3);
      // 汇总行走 info 通道（受 build.logLevel 管辖）
      expect(infos).toEqual(["[nudo] Analysis complete: 2 error(s), 3 warning(s)"]);
      expect(warns).toEqual([]);
      // **不再**从 console.log 逃逸（否则 logLevel:"silent" 挡不住）
      expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("logAnalysisSummary 在宿主没有 info 通道时降级到 warn 通道（仍不 console.log）", () => {
    const warns: string[] = [];
    const ctx: ReportContext = {
      id: "",
      failOnError: false,
      warn: (m) => warns.push(m),
      error: () => {},
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logAnalysisSummary(ctx, 2, 3);
      expect(warns).toEqual(["[nudo] Analysis complete: 2 error(s), 3 warning(s)"]);
      expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("族 30 S0 —— index.ts 的 configResolved 惰性钩子", () => {
  it("configResolved 只记录 config.root（此时无人消费 ⇒ 行为零变化）", () => {
    const plugin = nudoPlugin();
    const hook = plugin.configResolved as (c: unknown) => void;
    expect(typeof hook).toBe("function");
    hook.call({}, { root: "/tmp/nudo-s0-config-root" });
    expect(getProjectRoot()).toBe("/tmp/nudo-s0-config-root");
    setProjectRoot(undefined);
  });
});
