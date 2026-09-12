import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
} from "@nudojs/core";

describe("B-path class / this", () => {
  it("constructor writes fields; method reads this", () => {
    const src = `
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
export function go() {
  const p = new Point(1, 2);
  return p.sum();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(3);
    expect(absToString(r.result)).toContain("3");
  });

  it("new + field access", () => {
    const src = `
class Box {
  constructor(v) { this.v = v; }
}
export function get() {
  const b = new Box(9);
  return b.v;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "get", []);
    expect(litValue(r.result)).toBe(9);
  });

  it("transpiles class to $class", async () => {
    const { transpile } = await import("@nudojs/core");
    const out = transpile(`class A { constructor(x) { this.x = x; } m() { return this.x; } }
export function go() { const a = new A(1); return a.m(); }`);
    expect(out).toContain("$class(");
    expect(out).toContain("$new(");
    expect(out).toContain("$invoke(");
  });
});
