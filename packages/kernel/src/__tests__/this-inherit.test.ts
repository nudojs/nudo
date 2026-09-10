import { describe, it, expect } from "vitest";
import { analyzeFn, numLit, litValue, formatShape } from "../index.ts";

describe("this method body + inheritance", () => {
  it("method reads this field set in constructor", () => {
    const src = `
class Counter {
  constructor(n) { this.n = n; }
  get() { return this.n; }
}
function main() {
  const c = new Counter(3);
  return c.get();
}
`;
    const r = analyzeFn(src, "main", []);
    expect(litValue(r)).toBe(3);
    expect(r.conf).toBe("exact");
  });

  it("method arithmetic on this", () => {
    const src = `
class Acc {
  constructor(n) { this.n = n; }
  add(k) { return this.n + k; }
}
function main() {
  return new Acc(10).add(5);
}
`;
    const r = analyzeFn(src, "main", []);
    expect(litValue(r)).toBe(15);
  });

  it("inherited method via super class shape", () => {
    const src = `
class Base {
  hello() { return "hi"; }
}
class Child extends Base {
  hello() { return "child"; }
}
function main() {
  return new Child().hello();
}
`;
    const r = analyzeFn(src, "main", []);
    // 子类覆写
    expect(litValue(r)).toBe("child");
  });

  it("inherited method not overridden", () => {
    const src = `
class Base {
  hello() { return "hi"; }
  n() { return 1; }
}
class Child extends Base {
  hello() { return "child"; }
}
function main() {
  return new Child().n();
}
`;
    const r = analyzeFn(src, "main", []);
    expect(litValue(r)).toBe(1);
  });

  it("instanceof super class name → true", () => {
    const src = `
class Base { x() { return 1; } }
class Child extends Base { y() { return 2; } }
function main() {
  return new Child() instanceof Base;
}
`;
    const r = analyzeFn(src, "main", []);
    expect(litValue(r)).toBe(true);
  });
});
