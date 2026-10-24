/**
 * Bug 1089 —— vite-plugin 的 **check 通道** issue 无 `line` 时被伪造成 `:1:0`
 * ⇒ 构建日志把「另一个文件不可读」这类**无源位置**的门禁诊断定位到
 * **当前文件第 1 行第 0 列**。
 *
 * 根因（`check-assembly.ts`）：`const line = i.line ?? 1;` ⇒ core 产出的
 * **无位置** check issue（`nudo:module-unreadable`「依赖模块存在但不可读」/
 * `nudo:internal` / `nudo:opaque-result` …）被兜底成第 1 行。
 *
 * 三面不一致：
 * - 本包 `report.ts` 的 `renderLocation` 契约明写「**不编造**第 1 行
 *   （`:1:0`）」；
 * - CLI 人类面（`core/src/algebra/check-report.ts`：`i.line != null ?
 *   \`L${i.line}\` : ""`）无位置就不打位置；
 * - Bug 982 的既有钉：占位 range（`line: 0`）渲染时整段省略位置。
 *
 * 修法：**不编造位置** —— 无 `line` 时用 service 的占位约定
 * `{line: 0, column: 0}` ⇒ `renderLocation`（`line <= 0` ⇒ 省略
 * `:line:col`）统一省略位置 ⇒ 与 CLI 同口径。
 *
 * 钉：check 通道的无位置 issue 不再渲染成 `:1:0`；**有**真位置的 issue 仍
 * 渲染 `:line:col`（不回归）。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";
import { assembleCheckOutcome } from "../check-assembly.ts";

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

describe("Bug 1089 —— check 通道的无位置 issue 不再被伪造成 :1:0", () => {
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
