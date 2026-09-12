import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
  transpile,
} from "@nudojs/core";

describe("B-path generators", () => {
  it("function* collects yields into tuple", () => {
    const src = `
export function* gen() {
  yield 1;
  yield 2;
  yield 3;
}
export function go() {
  const xs = gen();
  return xs[0] + xs[1] + xs[2];
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(6);
  });

  it("for-of over generator", () => {
    const src = `
export function* nums() {
  yield 1;
  yield 2;
}
export function sum() {
  let t = 0;
  for (const x of nums()) {
    t = t + x;
  }
  return t;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "sum", []);
    expect(litValue(r.result)).toBe(3);
  });

  it("transpiles generator to $gen/$yield", () => {
    const out = transpile(`export function* g() { yield 1; }`);
    expect(out).toContain("$gen(");
    expect(out).toContain("$yield(");
  });
});
