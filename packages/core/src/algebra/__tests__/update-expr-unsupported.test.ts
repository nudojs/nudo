/**
 * 不可写回 UpdateExpression / 同模式假精确静默折 → NudoUnsupportedError。
 *
 * 回归背景（BUG-015 / F3-update-expr-fake-undefined）：
 * transpile 的 UpdateExpression 尾部对不可写回目标（`foo().x++`、`super.x++`、
 * 解构怪形、可选链更新）静默折注释 + $lit(undefined)——表达式值被伪造为精确
 * undefined，自增副作用整条消失。同一文件 default 分支明确把「静默 $lit(undefined)」
 * 判定为假精确并抛 NudoUnsupportedError，此处是口径内自相矛盾的旁路。
 *
 * 同模式（注释 + $lit(undefined) 静默折）一并收紧：
 * - 非成员 delete（值应为 boolean）
 * - 未映射二元 / 一元运算符
 * - 非 Identifier 属性 / 非 Expression 计算键
 * - 逻辑赋值不可写回目标
 *
 * 断言：transpile/runTranspiled 抛 NudoUnsupportedError（reason 含 `update:` 等）
 * 或 tryRunTranspiled 走 unsupported:* 回落，而不是精确 undefined 且无 throws。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  tryRunTranspiled,
  transpile,
  setEvalFallbackCollector,
  NudoUnsupportedError,
  type EvalFallback,
} from "@nudojs/core";

function withCollector<T>(fn: () => T): { result: T | undefined; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    return { result: fn(), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

describe("UpdateExpression non-writable target throws unsupported (not fake undefined)", () => {
  it("o.m().x++ (memberPathOf root not rebindable) → NudoUnsupportedError reason update:++", () => {
    const src = `export function f(o){ return o.m().x++; }`;
    expect(() => transpile(src)).toThrow(NudoUnsupportedError);
    try {
      transpile(src);
      expect.unreachable("transpile must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NudoUnsupportedError);
      expect((e as NudoUnsupportedError).reason).toContain("update:");
    }
  });

  it("runTranspiled propagates NudoUnsupportedError (no silent precise undefined)", () => {
    const src = `export function f(o){ return o.m().x++; }`;
    expect(() => runTranspiled(src, { mode: "exec" })).toThrow(NudoUnsupportedError);
  });

  it("tryRunTranspiled records unsupported:update:* and falls back", () => {
    const src = `export function f(o){ return o.m().x++; }`;
    const { result, fallbacks } = withCollector(() => tryRunTranspiled(src, { mode: "exec" }));
    expect(result).toBeUndefined();
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks.some((f) => f.reason.startsWith("unsupported:update:"))).toBe(true);
  });

  it("super.x++ and optional-chain update also unsupported, not exact undefined", () => {
    for (const src of [
      `export function f(o){ return o.m().x--; }`,
      `export function f(o){ return ++o.m().x; }`,
    ]) {
      expect(() => runTranspiled(src, { mode: "exec" }), src).toThrow(NudoUnsupportedError);
    }
  });

  it("writable identifier / memberPath targets stay capable (no regression)", () => {
    const src = `export function f(){ let x = 5; x++; return x; }`;
    const exports = runTranspiled(src, { mode: "exec" });
    expect(exports).toBeDefined();
    const src2 = `export function f(o){ o.n++; return o.n; }`;
    expect(runTranspiled(src2, { mode: "exec" })).toBeDefined();
  });
});

describe("same-pattern fake-precision silent folds throw unsupported", () => {
  it("non-member delete (value is boolean, not undefined) → unsupported delete:*", () => {
    const src = `export function f(o){ return delete o.m(); }`;
    expect(() => runTranspiled(src, { mode: "exec" })).toThrow(NudoUnsupportedError);
    try {
      runTranspiled(src, { mode: "exec" });
    } catch (e) {
      expect((e as NudoUnsupportedError).reason).toContain("delete:");
    }
  });

  it("logical assignment on non-writable root → unsupported assign:*", () => {
    const src = `export function f(o){ return (o.m().x ||= 1); }`;
    expect(() => runTranspiled(src, { mode: "exec" })).toThrow(NudoUnsupportedError);
    try {
      runTranspiled(src, { mode: "exec" });
    } catch (e) {
      expect((e as NudoUnsupportedError).reason).toContain("assign:");
    }
  });

  it("member delete on path still works (no false-positive throw)", () => {
    const src = `export function f(o){ return delete o.a; }`;
    expect(runTranspiled(src, { mode: "exec" })).toBeDefined();
  });
});
