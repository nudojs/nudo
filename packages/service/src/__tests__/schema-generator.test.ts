import { describe, it, expect } from "vitest";
import { abs, num, str, numLit, strLit, boolLit, objOf, type Abs } from "@nudojs/core";
import { absToZodSchema } from "../schema-generator.ts";

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");
const nullLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
const undefLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");

describe("schema-generator", () => {
  it("generates z.string() for string type", () => {
    expect(absToZodSchema(str())).toBe("z.string()");
  });

  it("generates z.number() for number type", () => {
    expect(absToZodSchema(num())).toBe("z.number()");
  });

  it("generates z.literal() for literal types", () => {
    expect(absToZodSchema(strLit("hello"))).toBe('z.literal("hello")');
    expect(absToZodSchema(numLit(42))).toBe("z.literal(42)");
    expect(absToZodSchema(boolLit(true))).toBe("z.literal(true)");
  });

  it("generates z.object() for object types", () => {
    const obj = objOf({ name: { value: str() }, age: { value: num() } });
    expect(absToZodSchema(obj)).toBe("z.object({ name: z.string(), age: z.number() })");
  });

  it("generates z.array() for array types", () => {
    expect(absToZodSchema(arrOf(str()))).toBe("z.array(z.string())");
  });

  it("generates z.union() for union types", () => {
    const union = unionOf(str(), num());
    expect(absToZodSchema(union)).toBe("z.union([z.string(), z.number()])");
  });

  it("generates z.null() and z.undefined()", () => {
    expect(absToZodSchema(nullLit())).toBe("z.null()");
    expect(absToZodSchema(undefLit())).toBe("z.undefined()");
  });
});
