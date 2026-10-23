/**
 * Bug 983 回归（vite-plugin 构建期）：**同 898 的反方向面** —— 跨模块
 * 返回契约**真违例**时，插件必须给出 **error** 级的
 * `nudo:constraint-violated`，而不是被降级成 **warning** 级的
 * `nudo:unproven-return`。
 *
 * 危害（假绿）：「证不出来」时插件只能给弱断言（warning）⇒
 * `failOnError: true` 也放行 ⇒ **门禁失效**（CI 假绿）。
 *
 * 现状：**族 18（`169ed526`）的 `buildViteCheckInjection` 已经把
 * `modules`（+ `inject`）一起传给 `checkSource`** ⇒ 模块图到位后，
 * 真违约回到 CLI 的 `nudo:constraint-violated`（error）⇒ 本条早已闭合；
 * 本钉的作用是**锁住「必须回到 error 级」这一面**（与 Bug 898 的钉
 * 合起来覆盖同一根因的两个方向）。
 *
 * 负控制：返回契约**可证**时不得报 error（见 Bug 898 的钉）。
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
/** 真违例：run 声明返回 string()，实际返回 number */
const APP_SIDECAR_VIOLATION = `export const run = fn({ n: number() }, string());
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
    // 真实 Rollup/Vite 语义：this.error 抛异常
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
    JSON.stringify({ name: "nudo-vite-bug-983", private: true }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), LIB_SIDECAR, "utf-8");
  writeFileSync(join(dir, "app.js"), APP_SRC, "utf-8");
  writeFileSync(join(dir, "app.nudo.js"), APP_SIDECAR_VIOLATION, "utf-8");
}

describe("Bug 983: 跨模块返回契约真违例 ⇒ error 级 constraint-violated（failOnError 拦得住）", () => {
  it("真违例必须是 nudo:constraint-violated 且为 error 级（不是 warning 级 unproven-return）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-983-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: false });
      const all = [...r.warns, ...r.errors].join("\n");
      expect(all).toContain("nudo:constraint-violated");
      expect(all).not.toContain("nudo:unproven-return");
      // error 级诊断的上屏文本必须自带 "error:"（severity 三档原样带出）
      expect(all).toContain("error:");
      expect(r.thrown).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("failOnError=true ⇒ 真违例必须中断构建（this.error 被调用并抛出）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-983b-"));
    try {
      project(dir);
      const r = await runPlugin(dir, { failOnError: true });
      expect(r.errors.join("\n")).toContain("nudo:constraint-violated");
      expect(r.thrown).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
