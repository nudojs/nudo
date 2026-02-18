import { describe, it, expect } from "vitest";
import {
  T,
  isSubtypeOf,
  deepCloneTypeValue,
  mergeObjectProperties,
  typeValueEquals,
} from "../type-value.ts";

describe("isSubtypeOf: structural subtyping", () => {
  it("object subtype: a has all properties of b with subtypes", () => {
    const a = T.object({ x: T.literal(1), y: T.string, z: T.boolean });
    const b = T.object({ x: T.number, y: T.string });
    expect(isSubtypeOf(a, b)).toBe(true);
  });

  it("object not subtype: missing property", () => {
    const a = T.object({ x: T.number });
    const b = T.object({ x: T.number, y: T.string });
    expect(isSubtypeOf(a, b)).toBe(false);
  });

  it("object not subtype: property type mismatch", () => {
    const a = T.object({ x: T.string });
    const b = T.object({ x: T.number });
    expect(isSubtypeOf(a, b)).toBe(false);
  });

  it("array subtype: element is subtype", () => {
    const a = T.array(T.literal(1));
    const b = T.array(T.number);
    expect(isSubtypeOf(a, b)).toBe(true);
  });

  it("array not subtype: element mismatch", () => {
    const a = T.array(T.string);
    const b = T.array(T.number);
    expect(isSubtypeOf(a, b)).toBe(false);
  });

  it("tuple subtype: element-wise", () => {
    const a = T.tuple([T.literal(1), T.literal("hi")]);
    const b = T.tuple([T.number, T.string]);
    expect(isSubtypeOf(a, b)).toBe(true);
  });

  it("tuple not subtype: length mismatch", () => {
    const a = T.tuple([T.number]);
    const b = T.tuple([T.number, T.string]);
    expect(isSubtypeOf(a, b)).toBe(false);
  });

  it("tuple is subtype of array if all elements match", () => {
    const a = T.tuple([T.literal(1), T.literal(2)]);
    const b = T.array(T.number);
    expect(isSubtypeOf(a, b)).toBe(true);
  });

  it("tuple not subtype of array if element mismatch", () => {
    const a = T.tuple([T.literal(1), T.literal("hi")]);
    const b = T.array(T.number);
    expect(isSubtypeOf(a, b)).toBe(false);
  });
});

describe("deepCloneTypeValue", () => {
  it("clones object with new id", () => {
    const obj = T.object({ x: T.number, y: T.string });
    const cloned = deepCloneTypeValue(obj);
    expect(cloned.kind).toBe("object");
    if (cloned.kind === "object" && obj.kind === "object") {
      expect(cloned.id).not.toBe(obj.id);
      expect(cloned.properties.x).toEqual(obj.properties.x);
      expect(cloned.properties.y).toEqual(obj.properties.y);
    }
  });

  it("clones nested objects", () => {
    const inner = T.object({ a: T.literal(1) });
    const outer = T.object({ nested: inner });
    const cloned = deepCloneTypeValue(outer);
    if (cloned.kind === "object" && outer.kind === "object") {
      const clonedInner = cloned.properties.nested;
      expect(clonedInner.kind).toBe("object");
      if (clonedInner.kind === "object" && inner.kind === "object") {
        expect(clonedInner.id).not.toBe(inner.id);
      }
    }
  });

  it("returns primitives unchanged", () => {
    expect(deepCloneTypeValue(T.number)).toBe(T.number);
    expect(typeValueEquals(deepCloneTypeValue(T.literal(1)), T.literal(1))).toBe(true);
  });
});

describe("mergeObjectProperties", () => {
  it("merges two objects with overlapping keys", () => {
    const a = T.object({ x: T.literal(1), y: T.literal("a") }) as any;
    const b = T.object({ x: T.literal(2), z: T.boolean }) as any;
    const merged = mergeObjectProperties(a, b);
    if (merged.kind === "object") {
      expect(Object.keys(merged.properties).sort()).toEqual(["x", "y", "z"]);
      expect(merged.properties.y).toEqual(T.literal("a"));
      expect(merged.properties.z).toEqual(T.boolean);
    }
  });

  it("creates union for overlapping keys with different values", () => {
    const a = T.object({ x: T.literal(1) }) as any;
    const b = T.object({ x: T.literal(2) }) as any;
    const merged = mergeObjectProperties(a, b);
    if (merged.kind === "object") {
      expect(merged.properties.x.kind).toBe("union");
    }
  });
});
