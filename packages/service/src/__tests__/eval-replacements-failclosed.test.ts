/**
 * BUG-025：collectEvalReplacements 异常时
 * 返回半张注入表——@nudo:replace/@nudo:as
 * 前几条生效、后几条静默消失（应 exact 的
 * Abs 变 unknown/真执行），半配置注入比
 * 无注入更糟。
 *
 * 修复：已收集任何 directive 时 rethrow
 * （外层 catch → 整跑 fail-closed）；零收集
 * 时 fail-closed 空 maps + noteEvalFallback。
 * 测试用 mock 强制第 N 条语句 throw，钉死
 * 「要么空要么全量，绝不允许 1/2」。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ calls: 0, throwAt: 0 }));

vi.mock("@nudojs/parser", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@nudojs/parser")>();
  return {
    ...actual,
    extractInlineDirectives: (node: unknown) => {
      state.calls++;
      if (state.throwAt > 0 && state.calls === state.throwAt) {
        throw new Error("injected boom");
      }
      return actual.extractInlineDirectives(node as never);
    },
  };
});

import { collectEvalReplacements } from "../eval-run.ts";

const THREE_REPLACES = `// @nudo:replace foo number()
const a = 1;
// @nudo:replace bar string()
const b = 2;
// @nudo:replace baz boolean()
const c = 3;
`;

describe("BUG-025: collectEvalReplacements fail-closed", () => {
  beforeEach(() => {
    state.calls = 0;
    state.throwAt = 0;
  });

  it("collects all directives when nothing throws", () => {
    const r = collectEvalReplacements(THREE_REPLACES);
    expect(r.targets.length).toBe(3);
    expect(Object.keys(r.values).length).toBe(3);
  });

  it("rethrows when a directive was already collected (never returns 1/2)", () => {
    // 第 2 条语句 throw：第 1 条的 replace 已入表
    state.throwAt = 2;
    expect(() => collectEvalReplacements(THREE_REPLACES)).toThrow(
      "injected boom",
    );
  });

  it("returns empty maps on zero-collection throw (fail-closed no-op)", () => {
    // 无指令源 + 首条语句即 throw → 零收集 → 空 maps
    state.throwAt = 1;
    const r = collectEvalReplacements("const a = 1;\nconst b = 2;\n");
    expect(r.targets).toEqual([]);
    expect(r.values).toEqual({});
    expect(r.asTargets).toEqual([]);
    expect(r.asValues).toEqual({});
  });

  it("as directives follow the same contract", () => {
    const src = `// @nudo:as number()
const a = 1;
// @nudo:as string()
const b = 2;
`;
    // 第 2 条 throw：第 1 条 as 已入表 → rethrow
    state.throwAt = 2;
    expect(() => collectEvalReplacements(src)).toThrow("injected boom");
    // 全量收集
    state.throwAt = 0;
    const r = collectEvalReplacements(src);
    expect(r.asTargets.length).toBe(2);
  });
});
