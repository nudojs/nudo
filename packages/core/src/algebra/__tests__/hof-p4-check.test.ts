import { describe, it, expect } from "vitest";
import { checkSource, pTrue, shapeOnlyFn, relationFn, anyVar, abs, v, num } from "../index.ts";

describe("P4: HOF arg-structure with RelSource exemptions", () => {
  it("promote-sourced fn param gets number → warning", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      function bad() {
        return processItems([1,2,3], 42, (x) => x > 0);
      }
    `;
    const r = checkSource("t.js", src, pTrue);
    const issues = r.issues.filter((i) => i.code === "nudo:arg-structure");
    expect(issues.length).toBeGreaterThan(0);
    const hit = issues.find((i) => i.message?.includes("transform"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("skips any/unknown args", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      function callWithVars(items, transform, filter) {
        return processItems(items, transform, filter);
      }
    `;
    const r = checkSource("t.js", src, pTrue);
    const transformHits = r.issues.filter(
      (i) => i.code === "nudo:arg-structure" && i.message?.includes("transform"),
    );
    for (const h of transformHits) {
      expect(h.severity).not.toBe("error");
    }
  });

  it("accepts function expression args", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      function good() {
        return processItems([1,2,3], (x) => x * 2, (x) => x > 0);
      }
    `;
    const r = checkSource("t.js", src, pTrue);
    const transformHits = r.issues.filter(
      (i) => i.code === "nudo:arg-structure" && i.message?.includes("transform"),
    );
    expect(transformHits).toHaveLength(0);
  });

  it("skips impl-bearing callbacks (getFnImpl exemption)", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      function ok() {
        return processItems([], () => 1, () => true);
      }
    `;
    const r = checkSource("t.js", src, pTrue);
    const transformHits = r.issues.filter(
      (i) => i.code === "nudo:arg-structure" && i.message?.includes("transform"),
    );
    expect(transformHits).toHaveLength(0);
  });

  it("gold: plain call still ok", () => {
    const src = `
      function scale(x) {
        return x * 2;
      }
      function ok() {
        return scale(1);
      }
    `;
    const r = checkSource("t.js", src, pTrue);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("relationFn and shapeOnlyFn constructors still work", () => {
    expect(
      shapeOnlyFn([anyVar("A1")], abs({ k: "any" }, v("B1"), undefined, "path")).shape.k,
    ).toBe("fn");
    expect(relationFn([num()], num()).conf).toBe("path");
  });
});
