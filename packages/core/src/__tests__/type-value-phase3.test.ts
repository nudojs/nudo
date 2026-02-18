import { describe, it, expect } from "vitest";
import {
  T,
  typeValueToString,
  typeValueEquals,
  isSubtypeOf,
  getPrimitiveTypeOf,
  deepCloneTypeValue,
} from "../type-value.ts";

describe("PromiseType", () => {
  it("creates a promise type", () => {
    const p = T.promise(T.number);
    expect(p.kind).toBe("promise");
    if (p.kind === "promise") {
      expect(p.value).toBe(T.number);
    }
  });

  it("toString formats correctly", () => {
    expect(typeValueToString(T.promise(T.number))).toBe("Promise<number>");
    expect(typeValueToString(T.promise(T.string))).toBe("Promise<string>");
    expect(typeValueToString(T.promise(T.union(T.number, T.string)))).toBe(
      "Promise<number | string>",
    );
  });

  it("equals works", () => {
    expect(typeValueEquals(T.promise(T.number), T.promise(T.number))).toBe(true);
    expect(typeValueEquals(T.promise(T.number), T.promise(T.string))).toBe(false);
  });

  it("isSubtypeOf works", () => {
    expect(isSubtypeOf(T.promise(T.literal(1)), T.promise(T.number))).toBe(true);
    expect(isSubtypeOf(T.promise(T.number), T.promise(T.string))).toBe(false);
  });

  it("getPrimitiveTypeOf returns object", () => {
    expect(getPrimitiveTypeOf(T.promise(T.number))).toBe("object");
  });

  it("deepClone works", () => {
    const p = T.promise(T.object({ x: T.number }));
    const cloned = deepCloneTypeValue(p);
    expect(typeValueEquals(cloned, p)).toBe(false);
    expect(cloned.kind).toBe("promise");
    if (cloned.kind === "promise" && cloned.value.kind === "object") {
      expect(cloned.value.properties.x).toBe(T.number);
    }
  });
});

describe("InstanceType", () => {
  it("creates an instance type", () => {
    const inst = T.instanceOf("Error", { message: T.literal("oops") });
    expect(inst.kind).toBe("instance");
    if (inst.kind === "instance") {
      expect(inst.className).toBe("Error");
      expect(inst.properties.message).toEqual(T.literal("oops"));
    }
  });

  it("toString formats correctly", () => {
    expect(typeValueToString(T.instanceOf("Error"))).toBe("Error");
    expect(typeValueToString(T.instanceOf("Error", { message: T.literal("oops") }))).toBe(
      'Error { message: "oops" }',
    );
  });

  it("equals checks className", () => {
    expect(typeValueEquals(T.instanceOf("Error"), T.instanceOf("Error"))).toBe(true);
    expect(typeValueEquals(T.instanceOf("Error"), T.instanceOf("TypeError"))).toBe(false);
  });

  it("isSubtypeOf handles error hierarchy", () => {
    expect(isSubtypeOf(T.instanceOf("TypeError"), T.instanceOf("Error"))).toBe(true);
    expect(isSubtypeOf(T.instanceOf("SyntaxError"), T.instanceOf("Error"))).toBe(true);
    expect(isSubtypeOf(T.instanceOf("Error"), T.instanceOf("TypeError"))).toBe(false);
  });

  it("getPrimitiveTypeOf returns object", () => {
    expect(getPrimitiveTypeOf(T.instanceOf("Error"))).toBe("object");
  });

  it("deepClone works", () => {
    const inst = T.instanceOf("Error", { message: T.string });
    const cloned = deepCloneTypeValue(inst);
    expect(cloned.kind).toBe("instance");
    if (cloned.kind === "instance") {
      expect(cloned.className).toBe("Error");
      expect(cloned.properties.message).toBe(T.string);
    }
  });
});
