/**
 * Bug 779（vite 半）—— vite-plugin 把 **info 级 check 诊断丢在噪声档过滤
 * 之前** ⇒ `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
 * **永不上屏**，且 `nudo.analysis.diagnostics: "verbose"` 对 check 诊断
 * **完全是空操作**。
 *
 * 根因：`checkIssuesToDiagnostics` 在转成 vite Diagnostic **之前**就
 * `filter(severity === "error" || severity === "warning")` ⇒ 下游的档位
 * 过滤器（`filterDiagnosticsByLevel`）拿到的集合里已经没有 info ⇒
 * `verbose` 档（`if (level === "verbose") return diags;`）永远看不到 info。
 *
 * 修法（片 F，vite 半）：转换点保留三档（error / warning / info），
 * 档位取舍**只**由 `filterDiagnosticsByLevel` 决定；info 级走 vite 的
 * **info 通道**（不混进 warn 流——与 LSP 面的 Information 档同语义）。
 *
 * 钉：verbose 档下 info 诊断上屏（走 info 通道，不进 warn 流）；
 * 默认档下 info 不上屏（不回归：默认面只放 error / warning）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

/** `@nudo:assume` ⇒ check 通道产出 info 级 `nudo:assume-relied` */
const SRC = `/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;

/**
 * 侧车契约：`sim` 的返回契约 `number().ge(0).le(1)` 只能靠 `@nudo:assume d <= max`
 * 这条用户公理证明 ⇒ check 通道产出 info 级 `nudo:assume-relied`。
 */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;

const ASSUME_CODE = "nudo:assume-relied";

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

async function runVite(pkg: unknown): Promise<{ warn: string[]; info: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-779-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
    const file = join(dir, "sim.js");
    writeFileSync(file, SRC, "utf-8");
    writeFileSync(join(dir, "sim.nudo.js"), SIDECAR, "utf-8");

    const plugin = nudoPlugin();
    const warn: string[] = [];
    const info: string[] = [];
    const ctx = {
      warn: (m: string) => warn.push(String(m)),
      info: (m: string) => info.push(String(m)),
      error: (m: string) => {
        throw new Error(String(m));
      },
    };
    await transformOf(plugin).call(ctx, SRC, file);
    return { warn, info };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VERBOSE_PKG = {
  name: "bug779-vite-verbose",
  private: true,
  type: "module",
  nudo: { analysis: { diagnostics: "verbose" } },
};

const DEFAULT_PKG = { name: "bug779-vite-default", private: true, type: "module" };

describe("Bug 779（vite 半）— info 级 check 诊断在 verbose 档必须上屏", () => {
  it("verbose 档：nudo:assume-relied 走 info 通道上屏（不混进 warn 流）", async () => {
    const { warn, info } = await runVite(VERBOSE_PKG);
    const hit = info.filter((m) => m.includes(ASSUME_CODE));
    expect(hit.length, `info 通道无 info 诊断：${JSON.stringify({ warn, info })}`).toBeGreaterThan(0);
    expect(
      warn.filter((m) => m.includes(ASSUME_CODE)).length,
      "info 诊断混进了 warn 流",
    ).toBe(0);
  }, 30_000);

  it("默认档：info 不上屏（档位取舍仍归 filterDiagnosticsByLevel）", async () => {
    const { warn, info } = await runVite(DEFAULT_PKG);
    expect(info.filter((m) => m.includes(ASSUME_CODE)).length, "默认档不应上屏 info").toBe(0);
    expect(warn.filter((m) => m.includes(ASSUME_CODE)).length, "默认档不应上屏 info").toBe(0);
  }, 30_000);
});
