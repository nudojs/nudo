/**
 * B 路径 break/continue：此前 transpile 无 BreakStatement/ContinueStatement
 * case，落入 default `/* skip *​/` ——循环体内语句被整体删除，continue/break
 * 完全失效（循环体照常跑完）。修复：循环内转译为 $loopBreak/$loopContinue
 * 信号，$for/$whileSeq/$forOf 捕获；带标签信号沿嵌套循环匹配冒泡。
 * switch 臂内的无标签 break 是「臂结束」，转译为 return，不得当循环信号。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path break/continue", () => {
  it("for + continue skips the rest of the body", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 5; i++) { if (i === 2) continue; s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe(8);
  });

  it("for + break exits the loop", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 5; i++) { if (i === 2) break; s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("while + continue skips the rest of the body", () => {
    const r = call(
      `export function f() { let i = 0, s = 0; while (i < 5) { i++; if (i === 3) continue; s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe(12);
  });

  it("while + break exits the loop", () => {
    const r = call(
      `export function f() { let i = 0, s = 0; while (i < 5) { i++; if (i === 3) break; s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("do-while + continue and break", () => {
    const r = call(
      `export function f() { let i = 0, s = 0; do { i++; if (i === 3) continue; s += i; } while (i < 5); return s; }`,
    );
    expect(litValue(r.result)).toBe(12);
    const r2 = call(
      `export function f() { let i = 0, s = 0; do { i++; if (i === 3) break; s += i; } while (i < 5); return s; }`,
    );
    expect(litValue(r2.result)).toBe(3);
  });

  it("while(true) + break terminates", () => {
    const r = call(
      `export function f() { let i = 0, s = 0; while (true) { i++; if (i > 3) break; if (i === 2) continue; s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe(4);
  });

  it("inner break exits inner loop only", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) break; s++; } } return s; }`,
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("labeled break outer exits the labeled loop", () => {
    const r = call(
      `export function f() { let s = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) break outer; s++; } } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("labeled continue outer skips the rest of the outer iteration", () => {
    const r = call(
      `export function f() { let s = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue outer; s++; } } return s; }`,
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("continue before the increment still runs the for update", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 5; i++) { if (i % 2 === 0) continue; s += i * 10; } return s; }`,
    );
    expect(litValue(r.result)).toBe(40);
  });

  it("break after continue in same loop body", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 10; i++) { if (i === 3) { continue; } s += i; if (i === 5) break; } return s; }`,
    );
    expect(litValue(r.result)).toBe(12);
  });

  it("regression: switch break stays inside switch", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 3; i++) { switch (i) { case 1: s += 10; break; default: s += i; } } return s; }`,
    );
    expect(litValue(r.result)).toBe(12);
  });

  it("switch arm continue targets the enclosing loop", () => {
    const r = call(
      `export function f() { let s = 0; for (let i = 0; i < 4; i++) { switch (i) { case 1: continue; default: s += i; } } return s; }`,
    );
    expect(litValue(r.result)).toBe(5);
  });
});
