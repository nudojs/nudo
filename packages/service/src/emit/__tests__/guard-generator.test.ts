import { describe, it, expect } from "vitest";
import { abs, num, str, objOf, type Abs } from "@nudojs/core";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");

describe("guard-generator", () => {
  it("generates guard for string type", () => {
    const guard = generateGuardFunctionFromAbs("isString", str());
    expect(guard).toContain('typeof data === "string"');
  });

  it("generates guard for object type", () => {
    const obj = objOf({ name: { value: str() }, age: { value: num() } });
    const guard = generateGuardFunctionFromAbs("isUser", obj);
    expect(guard).toContain('typeof data === "object"');
    expect(guard).toContain("data.name");
    expect(guard).toContain("data.age");
  });

  it("generates guard for union type", () => {
    const union = unionOf(str(), num());
    const guard = generateGuardFunctionFromAbs("isStringOrNumber", union);
    expect(guard).toContain("||");
  });

  it("generates guard for array type", () => {
    const guard = generateGuardFunctionFromAbs("isStringArray", arrOf(str()));
    expect(guard).toContain("Array.isArray(data)");
  });
});
