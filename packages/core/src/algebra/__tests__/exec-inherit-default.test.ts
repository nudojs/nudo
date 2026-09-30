import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $await,
  litValue,
  absToString,
} from "@nudojs/core";

describe("evaluator inheritance / super", () => {
  it("child inherits parent method", () => {
    const src = `
class Base {
  constructor(x) { this.x = x; }
  get() { return this.x; }
}
class Child extends Base {
  double() { return this.get() + this.get(); }
}
export function go() {
  const c = new Child(5);
  return c.double();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 10 });
  });

  it("super() runs parent ctor", () => {
    const src = `
class Base {
  constructor(x) { this.x = x; }
}
class Child extends Base {
  constructor(x, y) {
    super(x);
    this.y = y;
  }
  sum() { return this.x + this.y; }
}
export function go() {
  const c = new Child(1, 2);
  return c.sum();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("super.method() calls parent implementation", () => {
    const src = `
class Base {
  hello() { return "base"; }
}
class Child extends Base {
  hello() { return super.hello() + "+child"; }
}
export function go() {
  const c = new Child();
  return c.hello();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: "base+child" });
  });
});

describe("evaluator destructure defaults", () => {
  it("object default fills undefined", () => {
    const src = `
export function go() {
  const o = { a: 1 };
  const { a, b = 99 } = o;
  return a + b;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 100 });
  });

  it("object present value wins over default", () => {
    const src = `
export function go() {
  const o = { a: 5 };
  const { a = 1 } = o;
  return a;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("array default fills out-of-range", () => {
    const src = `
export function go() {
  const xs = [1];
  const [a, b = 7] = xs;
  return a + b;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 8 });
  });
});
