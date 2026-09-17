import { describe, it, expect } from "vitest";
import { createEnvironment } from "../environment.ts";
import { numLit, litValue, formatShape, type Abs } from "../algebra/index.ts";

describe("Environment", () => {
  it("binds and looks up Abs values", () => {
    const env = createEnvironment();
    env.bind("x", numLit(42));
    expect(litValue(env.lookup("x"))).toBe(42);
  });

  it("returns unknown for unbound names", () => {
    const env = createEnvironment();
    expect(env.lookup("x").shape.k).toBe("unknown");
  });

  it("extends with child scope", () => {
    const parent = createEnvironment();
    parent.bind("x", numLit(1));
    const child = parent.extend({ y: numLit(2) });
    expect(litValue(child.lookup("x"))).toBe(1);
    expect(litValue(child.lookup("y"))).toBe(2);
  });

  it("child binding shadows parent", () => {
    const parent = createEnvironment();
    parent.bind("x", numLit(1));
    const child = parent.extend({ x: numLit(99) });
    expect(litValue(child.lookup("x"))).toBe(99);
    expect(litValue(parent.lookup("x"))).toBe(1);
  });

  it("has checks existence", () => {
    const env = createEnvironment();
    expect(env.has("x")).toBe(false);
    env.bind("x", { shape: { k: "prim", type: "number" }, conf: "exact" } as Abs);
    expect(env.has("x")).toBe(true);
  });

  it("snapshot creates independent copy", () => {
    const env = createEnvironment();
    env.bind("x", numLit(1));
    const snap = env.snapshot();
    env.bind("x", numLit(2));
    expect(litValue(snap.lookup("x"))).toBe(1);
    expect(litValue(env.lookup("x"))).toBe(2);
  });
});
