import { describe, it, expect } from "vitest";
import {
  analyzeFn,
  numLit,
  litValue,
} from "../index.ts";

describe("language: class / instanceof / async", () => {
  it("class + new → brand with methods", () => {
    const src = `
class Point {
  constructor(x) { this.x = x; }
  dist() { return this.x; }
}
function main() {
  const p = new Point(3);
  return p;
}
`;
    const r = analyzeFn(src, "main", []);
    expect(r.shape.k).toBe("brand");
    if (r.shape.k === "brand") {
      expect(r.shape.name).toBe("Point");
    }
  });

  it("instanceof brand name → true/false exact", () => {
    const src = `
class Point { dist() { return 1; } }
class Other { dist() { return 2; } }
function check() {
  const p = new Point();
  return p instanceof Point;
}
function checkOther() {
  const p = new Point();
  return p instanceof Other;
}
`;
    const r1 = analyzeFn(src, "check", []);
    expect(litValue(r1)).toBe(true);
    expect(r1.conf).toBe("exact");
    const r2 = analyzeFn(src, "checkOther", []);
    expect(litValue(r2)).toBe(false);
  });

  it("async function returns eff promise", () => {
    const src = `
async function load(id) {
  return id + 1;
}
`;
    const r = analyzeFn(src, "load", [numLit(5)]);
    expect(r.shape.k).toBe("eff");
    if (r.shape.k === "eff") {
      expect(r.shape.eff).toBe("promise");
      expect(litValue(r.shape.inner)).toBe(6);
    }
  });

  it("await unwraps promise", () => {
    const src = `
async function load(id) {
  return id + 1;
}
async function twice(id) {
  const a = await load(id);
  return a + 1;
}
`;
    const r = analyzeFn(src, "twice", [numLit(5)]);
    expect(r.shape.k).toBe("eff");
    if (r.shape.k === "eff") {
      expect(litValue(r.shape.inner)).toBe(7);
    }
  });
});
