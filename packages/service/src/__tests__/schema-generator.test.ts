import { describe, it, expect } from "vitest";
import { T } from "@nudojs/core";
import { typeValueToZodSchema } from "../schema-generator.ts";

describe("schema-generator", () => {
  it("generates z.string() for string type", () => {
    expect(typeValueToZodSchema(T.string)).toBe("z.string()");
  });

  it("generates z.number() for number type", () => {
    expect(typeValueToZodSchema(T.number)).toBe("z.number()");
  });

  it("generates z.literal() for literal types", () => {
    expect(typeValueToZodSchema(T.literal("hello"))).toBe('z.literal("hello")');
    expect(typeValueToZodSchema(T.literal(42))).toBe("z.literal(42)");
    expect(typeValueToZodSchema(T.literal(true))).toBe("z.literal(true)");
  });

  it("generates z.object() for object types", () => {
    const obj = T.object({ name: T.string, age: T.number });
    expect(typeValueToZodSchema(obj)).toBe("z.object({ name: z.string(), age: z.number() })");
  });

  it("generates z.array() for array types", () => {
    expect(typeValueToZodSchema(T.array(T.string))).toBe("z.array(z.string())");
  });

  it("generates z.union() for union types", () => {
    const union = T.union(T.string, T.number);
    expect(typeValueToZodSchema(union)).toBe("z.union([z.string(), z.number()])");
  });

  it("generates z.null() and z.undefined()", () => {
    expect(typeValueToZodSchema(T.null)).toBe("z.null()");
    expect(typeValueToZodSchema(T.undefined)).toBe("z.undefined()");
  });
});
