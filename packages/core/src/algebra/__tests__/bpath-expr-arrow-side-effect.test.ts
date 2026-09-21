/**
 * B 路径表达式体箭头的副作用写回：`() => n++` / `() => a.push(1)` /
 * `() => o.n++` 的语句级 rebind pass 此前只在语句位置扫描——表达式体
 * 内写回静默丢失（f() 后 n 不变）。修复：表达式体包块体跑同一 pass。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path expression-body arrow side effects", () => {
  it("postfix update writes back", () => {
    const r = call(`export function f() { let n = 5; const g = () => n++; g(); return n; }`);
    expect(litValue(r.result)).toBe(6);
    const r2 = call(`export function f() { let n = 5; const g = () => n++; g(); g(); return n; }`);
    expect(litValue(r2.result)).toBe(7);
  });

  it("prefix update writes back", () => {
    const r = call(`export function f() { let n = 5; const g = () => ++n; g(); return n; }`);
    expect(litValue(r.result)).toBe(6);
  });

  it("array mutator in expression body writes back", () => {
    const r = call(`export function f() { const a = [1]; const g = () => a.push(2); g(); return a.length; }`);
    expect(litValue(r.result)).toBe(2);
  });

  it("member postfix update writes back", () => {
    const r = call(`export function f() { const o = { n: 1 }; const g = () => o.n++; g(); return o.n; }`);
    expect(litValue(r.result)).toBe(2);
  });

  it("regression: block body still works", () => {
    const r = call(`export function f() { let n = 5; const g = () => { n++; }; g(); return n; }`);
    expect(litValue(r.result)).toBe(6);
  });

  it("regression: pure expression body unaffected", () => {
    const r = call(`export function f() { const g = (x) => x + 1; return g(1); }`);
    expect(litValue(r.result)).toBe(2);
  });
});
