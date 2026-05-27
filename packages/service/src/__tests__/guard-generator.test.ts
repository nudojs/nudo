import { describe, it, expect } from "vitest";
import { T } from "@nudojs/core";
import { generateGuardFunction } from "../guard-generator.ts";

describe("guard-generator", () => {
  it("generates guard for string type", () => {
    const guard = generateGuardFunction("isString", T.string);
    expect(guard).toContain("typeof data === 'string'");
  });

  it("generates guard for object type", () => {
    const obj = T.object({ name: T.string, age: T.number });
    const guard = generateGuardFunction("isUser", obj);
    expect(guard).toContain("typeof data === 'object'");
    expect(guard).toContain("data.name");
    expect(guard).toContain("data.age");
  });

  it("generates guard for union type", () => {
    const union = T.union(T.string, T.number);
    const guard = generateGuardFunction("isStringOrNumber", union);
    expect(guard).toContain("||");
  });

  it("generates guard for array type", () => {
    const guard = generateGuardFunction("isStringArray", T.array(T.string));
    expect(guard).toContain("Array.isArray(data)");
  });
});
