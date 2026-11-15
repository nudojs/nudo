/**
 * Bug 898 回归（vite-plugin 构建期）：check 面必须把 **Abs 模块图**
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
 * `nudo:constraint-violated`（**error** 级）—— 见 Bug 983 的钉。
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

describe("Bug 898: vite-plugin check 面传 Abs 模块图（跨模块返回契约可证 ⇒ 不报 unproven-return）", () => {
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
