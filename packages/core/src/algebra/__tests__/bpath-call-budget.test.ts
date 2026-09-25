/**
 * B 调用预算（与 ast-eval 同口径）：深度 64 / cycle 检测（同 name+arg 指纹）
 * / 截断结果 unknown+opaque + collector 上报。
 * 此前 B run 的命名调用无预算：直接自递归/互递归裸奔栈溢出，RangeError 被
 * callTranspiledExportFull 兜底静默吞成 unknown+partial（假结果）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs, $lit, abs, num, unknown as unknownAbs } from "@nudojs/core";
import { setAbsTruncationCollector } from "@nudojs/core/internal";

function callFn(src: string, name: string, args: unknown[] = []) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, name, args as never[]);
}

describe("B call budget (recursion)", () => {
  it("bounded self-recursion computes exactly (fac(5) = 120)", () => {
    const src = `export function fac(n) { if (n <= 1) { return 1; } return n * fac(n - 1); }`;
    const r = callFn(src, "fac", [$lit(5)]);
    expect(litValue(r.result)).toBe(120);
    expect(r.result.conf).toBe("exact");
  });

  it("unbounded self-recursion truncates to opaque (no stack overflow, no false partial)", () => {
    const src = `export function forever(f) { f(); return forever(f); }`;
    const cb = absFunctionStub();
    const r = callFn(src, "forever", [cb]);
    expect(r.result.conf).toBe("opaque");
    expect(formatAbs(r.throws)).toContain("never");
  });

  it("mutual recursion truncates to opaque (was: swallowed RangeError → partial)", () => {
    const src = `export function a(n) { return b(n); } function b(n) { return a(n); }`;
    const r = callFn(src, "a", [$lit(1)]);
    expect(r.result.conf).toBe("opaque");
  });

  it("truncation is reported through the collector", () => {
    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    try {
      callFn(`export function forever(f) { f(); return forever(f); }`, "forever", [absFunctionStub()]);
    } finally {
      setAbsTruncationCollector(null);
    }
    expect(seen).toContain("forever");
  });

  it("deep but finite recursion beyond budget truncates (depth 64)", () => {
    const src = `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }`;
    const r = callFn(src, "down", [$lit(100)]);
    expect(r.result.conf).toBe("opaque");
    const ok = callFn(src, "down", [$lit(10)]);
    expect(litValue(ok.result)).toBe(0);
  });

  it("abstract-arg recursion truncates without hanging", () => {
    const src = `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }`;
    const r = callFn(src, "down", [abs(num().shape, undefined, undefined, "path")]);
    expect(r.result.conf === "opaque" || r.result.conf === "partial").toBe(true);
  });
});

function absFunctionStub() {
  // 空 body 的 Abs fn（回调占位）
  return unknownAbs;
}
