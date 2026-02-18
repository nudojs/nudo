import { describe, it, expect } from "vitest";
import { createEnvironment } from "../environment.ts";
import { T, typeValueEquals } from "../type-value.ts";

describe("Environment", () => {
  it("binds and looks up values", () => {
    const env = createEnvironment();
    env.bind("x", T.literal(42));
    expect(typeValueEquals(env.lookup("x"), T.literal(42))).toBe(true);
  });

  it("returns undefined for unbound names", () => {
    const env = createEnvironment();
    expect(typeValueEquals(env.lookup("x"), T.undefined)).toBe(true);
  });

  it("extends with child scope", () => {
    const parent = createEnvironment();
    parent.bind("x", T.literal(1));
    const child = parent.extend({ y: T.literal(2) });
    expect(typeValueEquals(child.lookup("x"), T.literal(1))).toBe(true);
    expect(typeValueEquals(child.lookup("y"), T.literal(2))).toBe(true);
  });

  it("child binding shadows parent", () => {
    const parent = createEnvironment();
    parent.bind("x", T.literal(1));
    const child = parent.extend({ x: T.literal(99) });
    expect(typeValueEquals(child.lookup("x"), T.literal(99))).toBe(true);
    expect(typeValueEquals(parent.lookup("x"), T.literal(1))).toBe(true);
  });

  it("has checks existence", () => {
    const env = createEnvironment();
    expect(env.has("x")).toBe(false);
    env.bind("x", T.number);
    expect(env.has("x")).toBe(true);
  });

  it("snapshot creates independent copy", () => {
    const env = createEnvironment();
    env.bind("x", T.literal(1));
    const snap = env.snapshot();
    env.bind("x", T.literal(2));
    expect(typeValueEquals(snap.lookup("x"), T.literal(1))).toBe(true);
    expect(typeValueEquals(env.lookup("x"), T.literal(2))).toBe(true);
  });
});
