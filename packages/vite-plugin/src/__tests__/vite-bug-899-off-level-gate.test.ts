/**
 * Bug 899 —— `nudo.analysis.diagnostics: "off"` 档把 **L1/L2 check 门禁**
 * 一起抹掉 ⇒ `vite build` 零诊断通过（CI 假绿）。
 *
 * 根因：插件把 **check 门禁诊断与 evaluator 诊断合并后**再交给
 * `filterDiagnosticsByLevel`；而 `off` 档的实现是「返回空数组」⇒ L1 契约违例
 * 与 L2 `nudo:entry-may-throw` 一起消失 ⇒ `failOnError: true` 也**不拦**。
 *
 * 修法（**不改** service 的 `filterDiagnosticsByLevel` 签名）：插件侧**分两条
 * 通道** —— 门禁通道（check 面的 error 级诊断）**不参与** `off` 档静音；
 * 显示通道（evaluator 面 + env 面 + check 面的 warning / info 级）照旧过滤。
 *
 * 钉：`off` 档下 `failOnError: true` **仍然抛**（构建红）；`off` 档下门禁
 * 诊断**仍然可见**（不被抹掉）。
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

function offFixture(): { dir: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-899-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bug899-off",
      private: true,
      nudo: { analysis: { diagnostics: "off" } },
    }),
    "utf-8",
  );
  const id = join(dir, "entry.js");
  writeFileSync(id, SRC, "utf-8");
  return { dir, id };
}

describe("Bug 899 —— off 档不得抹掉 check 门禁通道", () => {
  it("off 档 + failOnError: true ⇒ 仍然抛（构建红，不再 CI 假绿）", async () => {
    const { dir, id } = offFixture();
    try {
      const plugin = nudoPlugin({ failOnError: true });
      const warnFn = vi.fn();
      const errorFn = vi.fn((m: string) => {
        throw new Error(m);
      });
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

      await expect(transformOf(plugin).call(ctx, SRC, id)).rejects.toThrow(/entry-may-throw/);
      expect(errorFn).toHaveBeenCalled();
      const msg = String(errorFn.mock.calls[0]?.[0] ?? "");
      expect(msg).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("off 档 + failOnError: false ⇒ 门禁诊断仍然可见（不被抹掉）", async () => {
    const { dir, id } = offFixture();
    try {
      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const errorFn = vi.fn();
      const ctx = { warn: warnFn, error: errorFn, info: vi.fn() };

      const result = await transformOf(plugin).call(ctx, SRC, id);
      expect(result).toBeNull();
      expect(errorFn).not.toHaveBeenCalled();
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("非 off 档（默认档）口径不变：门禁诊断照旧上报", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-899-default-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "bug899-default", private: true }),
        "utf-8",
      );
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const plugin = nudoPlugin();
      const warnFn = vi.fn();
      const ctx = { warn: warnFn, error: vi.fn(), info: vi.fn() };
      await transformOf(plugin).call(ctx, SRC, id);
      const msgs = warnFn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msgs).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
