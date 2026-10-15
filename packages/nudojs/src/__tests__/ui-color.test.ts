import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ui.ts 着色开关与行级规则的确定性测试。
 * `enabled` 在模块加载时求值 → 每个用例 resetModules 后动态 import 取新实例。
 */
async function loadUi() {
  vi.resetModules();
  return await import("../ui.ts");
}

describe("ui paint (dx-color)", () => {
  beforeEach(() => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
  });

  it("非 TTY 且无 FORCE_COLOR → 恒等返回（管道无色）", async () => {
    const { paint } = await loadUi();
    const text = "FAILED\n  [ERROR L2 f] boom\nsignatures\n  g() => any";
    expect(paint(text)).toBe(text);
  });

  it("FORCE_COLOR=1 → severity/段落头着色，正文素色", async () => {
    process.env.FORCE_COLOR = "1";
    const { paint, paintOne } = await loadUi();
    const out = paint(
      [
        "nudo check  a.js",
        "FAILED",
        "signatures",
        "  f(a: any) => any",
        "issues",
        "  [ERROR L2 f] may throw  (nudo:entry-may-throw)",
        "  [WARNING] w  (nudo:directive-syntax)",
      ].join("\n"),
    );
    const lines = out.split("\n");
    expect(lines[0]).not.toContain("\x1b[");
    expect(lines[1]).toMatch(/^\x1b\[31mFAILED\x1b\[0m$/);
    expect(lines[2]).toMatch(/^\x1b\[1msignatures\x1b\[0m$/);
    expect(lines[3]).not.toContain("\x1b[");
    expect(lines[5]).toMatch(/^\x1b\[31m  \[ERROR L2 f\].*\x1b\[0m$/);
    expect(lines[6]).toMatch(/^\x1b\[33m  \[WARNING\].*\x1b\[0m$/);
    // 小写 severity（test diagnostics 面）
    expect(paintOne("  [error] a.js:1:1 boom")).toMatch(/^\x1b\[31m/);
    expect(paintOne("  ✓ 2 passed")).toMatch(/^\x1b\[32m/);
    expect(paintOne("  ⚠ uncovered: f")).toMatch(/^\x1b\[33m/);
  });

  it("NO_COLOR 压过 FORCE_COLOR → 一律无色", async () => {
    process.env.FORCE_COLOR = "1";
    process.env.NO_COLOR = "1";
    const { paint } = await loadUi();
    const text = "FAILED\n  [ERROR L2 f] boom";
    expect(paint(text)).toBe(text);
  });
});
