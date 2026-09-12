import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
  transpile,
} from "@nudojs/core";

describe("B-path class static members", () => {
  it("reads static fields and calls static methods", () => {
    const src = `
class Point {
  static origin = 0;
  static make(n) { return n * 2; }
  constructor(x) { this.x = x; }
  get() { return this.x; }
}
export function go() {
  const p = new Point(Point.make(3));
  return p.get() + Point.origin;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(6); // make(3)=6 + origin=0
  });

  it("transpiles static to $class statics/staticMethods", () => {
    const out = transpile(`
class C {
  static n = 1;
  static f() { return 2; }
  m() { return 3; }
}
`);
    expect(out).toContain("statics:");
    expect(out).toContain("staticMethods:");
  });
});

describe("B-path computed object properties", () => {
  it("{ [k]: v } uses $setKey", () => {
    const src = `
export function go() {
  const k = "id";
  const o = { [k]: 7 };
  return o.id;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(7);
  });

  it("transpiles computed property", () => {
    const out = transpile(`export function f(k, v) { return { [k]: v }; }`);
    expect(out).toContain("$setKey(");
  });
});
