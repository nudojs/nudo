/**
 * BUG-028：tryEvalCall 对缺 result 的
 * TranspiledCallResult 显式 isAbsVal 守卫
 * + noteEvalFallback（旧实现 `!r` 死检查：
 * 类型级 result 必填使检查不可达，运行时
 * 不变量被破坏时静默 undefined，原因
 * 不可观测）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ broken: false }));

vi.mock("@nudojs/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@nudojs/core")>();
  return {
    ...actual,
    callTranspiledExportFull: (
      ...args: Parameters<typeof actual.callTranspiledExportFull>
    ) => {
      if (state.broken) {
        // producer 缺陷：result 不是 Abs 值
        return {
          result: "not-an-abs" as never,
          throws: { shape: { k: "never" } } as never,
        };
      }
      return actual.callTranspiledExportFull(...args);
    },
  };
});

import { tryEvalCall } from "../eval-run.ts";
import {
  setEvalFallbackCollector,
  type EvalFallback,
} from "@nudojs/core";

describe("BUG-028: tryEvalCall broken-result guard", () => {
  beforeEach(() => {
    state.broken = false;
  });

  it("non-Abs result → fallback observed + undefined (not silent)", () => {
    const fallbacks: EvalFallback[] = [];
    setEvalFallbackCollector((f) => fallbacks.push(f));
    try {
      state.broken = true;
      const r = tryEvalCall(
        "export function f() { return 42; }",
        "/t/f.js",
        "f",
        [],
      );
      expect(r).toBeUndefined();
      expect(
        fallbacks.some(
          (f) =>
            f.reason === "internal" &&
            /not an Abs value/.test(f.message),
        ),
      ).toBe(true);
    } finally {
      setEvalFallbackCollector(null);
    }
  });

  it("valid result passes through (guard is a no-op on the happy path)", () => {
    const r = tryEvalCall(
      "export function f() { return 42; }",
      "/t/f.js",
      "f",
      [],
    );
    expect(r).toBeDefined();
    expect(r!.shape.k).toBe("prim");
  });
});
