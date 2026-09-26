/**
 * 评审修复：非循环 labeled block 的 break label。
 * 此前 transpile 丢弃标签，break 被 skip，块内 break 后语句仍执行（控制流假精确）。
 * 现：break label → $loopBreak(label)；labeled block 用 try/$isBreakTo 吸收同标签信号。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path labeled block break", () => {
  it("break out of labeled block skips the rest", () => {
    const r = call(
      `export function f() { let s = 0; foo: { s += 1; break foo; s += 10; } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("labeled block without break runs fully", () => {
    const r = call(`export function f() { let s = 0; foo: { s += 1; s += 2; } return s; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("inner labeled block break does not exit outer", () => {
    const r = call(
      `export function f() { let s = 0; foo: { bar: { s += 1; break bar; s += 100; } s += 10; break foo; s += 1000; } return s; }`,
    );
    expect(litValue(r.result)).toBe(11);
  });

  it("break outer from nested inner block", () => {
    const r = call(
      `export function f() { let s = 0; foo: { bar: { s += 1; break foo; s += 100; } s += 1000; } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("labeled break still works on loops", () => {
    const r = call(
      `export function f() { let s = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) break outer; s++; } } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });
});
