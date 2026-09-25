import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, str, bool, numLit, strLit, never, unknown, gt, lit, v as termVar } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

describe("denoteGuard", () => {
  it("prim number", () => {
    expect(denoteGuard(num(), "x")).toBe('typeof x === "number"');
  });

  it("literal number keeps exact equality", () => {
    expect(denoteGuard(numLit(8), "x")).toBe("x === 8");
  });

  it("literal string", () => {
    expect(denoteGuard(strLit("hi"), "x")).toBe('x === "hi"');
  });

  it("NaN / ±Infinity literals render valid guards, not === null", () => {
    expect(denoteGuard(numLit(NaN), "x")).toBe("Number.isNaN(x)");
    expect(denoteGuard(numLit(Infinity), "x")).toBe("x === Infinity");
    expect(denoteGuard(numLit(-Infinity), "x")).toBe("x === -Infinity");
  });

  it("object structure", () => {
    const o = makeAbs(
      { k: "obj", slots: { id: { value: num() }, name: { value: str() } } },
      undefined,
      undefined,
      "exact",
    );
    const g = denoteGuard(o, "o");
    expect(g).toContain('typeof o === "object"');
    expect(g).toContain('typeof o.id === "number"');
    expect(g).toContain('typeof o.name === "string"');
  });

  it("array element", () => {
    const a = makeAbs({ k: "arr", element: num() }, undefined, undefined, "exact");
    const g = denoteGuard(a, "a");
    expect(g).toContain("Array.isArray(a)");
    expect(g).toContain('typeof item === "number"');
  });

  it("sum is union of members", () => {
    const s = makeAbs(
      { k: "sum", members: [numLit(1), numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(denoteGuard(s, "x")).toBe("(x === 1 || x === 2)");
  });

  it("numeric pred: term > 0 on value", () => {
    const a = makeAbs(
      { k: "prim", type: "number" },
      termVar("x"),
      gt(termVar("x"), lit(0)),
      "path",
    );
    const g = denoteGuard(a, "data");
    expect(g).toContain('typeof data === "number"');
    expect(g).toContain("data > 0");
  });

  it("never / unknown / bool", () => {
    expect(denoteGuard(never, "x")).toBe("false");
    expect(denoteGuard(unknown, "x")).toBe("true");
    expect(denoteGuard(bool(), "x")).toBe('typeof x === "boolean"');
  });
});
