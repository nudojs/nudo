/**
 * Bug 903 —— `vite dev` 下 HMR 的 `?t=<timestamp>` module id 让插件**整份跳过**
 * 刚编辑的文件 ⇒ **dev 期诊断消失**（假绿）。
 *
 * 根因：`transform` 入口拿**带 query 的原始 Vite module id** 去比锚定正则
 * （`packages/service/src/glob.ts` 的 `^…$`）⇒ include 失配 ⇒ `return null`
 * ⇒ `shouldAnalyzeFile` / `analyzeFileAsync` / `checkSource` 全不跑。
 *
 * 修法：`scope.ts` 的 `scopeDecision` 在**匹配与分析之前**统一剥 query
 * （`normalizeModuleId`）⇒ 匹配、守卫、分析用**同一基准**。
 *
 * 钉：带 `?t=` / `?v=` 的 id 与不带 query 的 id **产出同样的诊断**。
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

/** L2 入口面：读取未约束成员 ⇒ `nudo:entry-may-throw`（error 级门禁诊断）。 */
const SRC = `export function getName(user) {
  return user.name;
}
`;

function fixture(): { dir: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-903-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug903", private: true }),
    "utf-8",
  );
  const id = join(dir, "dev-a.js");
  writeFileSync(id, SRC, "utf-8");
  return { dir, id };
}

async function diagnosticsOf(plugin: Plugin, code: string, id: string): Promise<string[]> {
  const warnFn = vi.fn();
  const errorFn = vi.fn();
  const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };
  await transformOf(plugin).call(ctx, code, id);
  return [
    ...warnFn.mock.calls.map((c) => String(c[0])),
    ...errorFn.mock.calls.map((c) => String(c[0])),
  ];
}

describe("Bug 903 —— HMR 的 ?t= query id 不得让整份文件被跳过", () => {
  it("带 ?t=<ts> 的 id 与不带 query 的 id 产出同样的诊断", async () => {
    const { dir, id } = fixture();
    try {
      const plain = await diagnosticsOf(nudoPlugin(), SRC, id);
      const hmr = await diagnosticsOf(nudoPlugin(), SRC, `${id}?t=123456`);

      expect(plain.length).toBeGreaterThan(0);
      expect(plain.join("\n")).toContain("nudo:entry-may-throw");
      // 改前：带 query 的 id 一条诊断都没有（整份被跳过 ⇒ dev 期假绿）。
      expect(hmr.length).toBe(plain.length);
      expect(hmr.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("带 ?v=<hash> 的 id 同样不被跳过", async () => {
    const { dir, id } = fixture();
    try {
      const diags = await diagnosticsOf(nudoPlugin(), SRC, `${id}?v=deadbeef`);
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("自定义 include 模式也按剥 query 后的路径匹配", async () => {
    const { dir, id } = fixture();
    try {
      const diags = await diagnosticsOf(
        nudoPlugin({ include: ["**/*.js"] }),
        SRC,
        `${id}?t=123456`,
      );
      expect(diags.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
