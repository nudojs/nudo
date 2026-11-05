/**
 * Bug 982 —— vite-plugin 把「**无源位置**」的诊断渲染成 `:0:0`（行号越界）
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
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
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

describe("Bug 982 —— 无源位置的诊断不渲染位置（不写 :0:0）", () => {
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
