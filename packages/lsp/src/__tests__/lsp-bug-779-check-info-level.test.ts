/**
 * Bug 779 —— check 通道的 **info 级**诊断被提前砍掉 ⇒ 永不���屏。
 *
 * 症状：`checkToLspDiagnostics` 在转换前就 `filter(severity === "error" ||
 * "warning")` ⇒ 下游的档位过滤器（`filterCheckLspByLevel`）永远看不到 info ⇒
 * `nudo.analysis.diagnostics: "verbose"` 对 check 诊断是**空操作**，
 * `nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
 * 永不上屏（CLI `nudo check` 却照常打印 ⇒ 同一份源码两侧集合不一致）。
 *
 * 修法（片 E）：转换点保留三档（error / warning / info），档位取舍**只**由
 * `filterCheckLspByLevel` 决定（verbose 放行 info；default/errors/off 不放行）。
 *
 * 钉：verbose 档下 info 上屏（push + pull 两条通道）；default 档下 info 不上屏
 * （不回归：默认面只放 error / warning）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

/** `@nudo:assume` ⇒ check 通道产出 info 级 nudo:assume-relied */
const SRC = `/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;

/**
 * 侧车契约：`sim` 的返回契约 `number().ge(0).le(1)` 只能靠 `@nudo:assume d <= max`
 * 这条用户引理证明 ⇒ check 通道产出 info 级 `nudo:assume-relied`。
 * （侧车的 `@nudojs/core` import 由 core 注入，无需 node_modules 解析。）
 */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;

const ASSUME_CODE = "nudo:assume-relied";

function openSession(pkg: unknown): {
  mock: ReturnType<typeof createMockConnection>;
  uri: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug779-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
  const file = join(dir, "info.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(join(dir, "info.nudo.js"), SIDECAR, "utf-8");
  const uri = `file://${file}`;
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
  });
  return {
    mock,
    uri,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const VERBOSE_PKG = {
  name: "bug779-verbose",
  private: true,
  type: "module",
  nudo: { analysis: { diagnostics: "verbose" } },
};

const DEFAULT_PKG = { name: "bug779-default", private: true, type: "module" };

describe("Bug 779 — check 通道的 info 级诊断在 verbose 档必须上屏", () => {
  it("push 通道：verbose 档下 nudo:assume-relied 上屏（severity=Information）", async () => {
    const { mock, uri, cleanup } = openSession(VERBOSE_PKG);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const pushed = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .filter((d: any) => d.code === ASSUME_CODE);
      expect(pushed.length, "info 诊断未上屏（push）").toBeGreaterThan(0);
      expect(pushed[0].severity).toBe(3); // DiagnosticSeverity.Information
    } finally {
      cleanup();
    }
  }, 30_000);

  it("pull 通道：verbose 档下 nudo:assume-relied 上屏（同 push 口径）", async () => {
    const { mock, uri, cleanup } = openSession(VERBOSE_PKG);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const res: any = await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      });
      const pulled = (res?.items ?? []).filter((d: any) => d.code === ASSUME_CODE);
      expect(pulled.length, "info 诊断未上屏（pull）").toBeGreaterThan(0);
      expect(pulled[0].severity).toBe(3); // DiagnosticSeverity.Information
    } finally {
      cleanup();
    }
  }, 30_000);

  it("默认档：info 不上屏（档位取舍仍归 filterCheckLspByLevel）", async () => {
    const { mock, uri, cleanup } = openSession(DEFAULT_PKG);
    try {
      await new Promise((r) => setTimeout(r, 900));
      const pushed = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .filter((d: any) => d.code === ASSUME_CODE);
      expect(pushed.length, "默认档不应上屏 info").toBe(0);
    } finally {
      cleanup();
    }
  }, 30_000);
});
