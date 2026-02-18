import { describe, it, expect } from "vitest";
import { T } from "@justscript/core";
import { typeValueToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "../analyzer.ts";

describe("typeValueToTSType", () => {
  it("converts literal number", () => {
    expect(typeValueToTSType(T.literal(42))).toBe("42");
  });

  it("converts literal string", () => {
    expect(typeValueToTSType(T.literal("hello"))).toBe('"hello"');
  });

  it("converts literal boolean", () => {
    expect(typeValueToTSType(T.literal(true))).toBe("true");
  });

  it("converts null and undefined", () => {
    expect(typeValueToTSType(T.null)).toBe("null");
    expect(typeValueToTSType(T.undefined)).toBe("undefined");
  });

  it("converts primitive types", () => {
    expect(typeValueToTSType(T.number)).toBe("number");
    expect(typeValueToTSType(T.string)).toBe("string");
    expect(typeValueToTSType(T.boolean)).toBe("boolean");
  });

  it("converts object type", () => {
    const obj = T.object({ x: T.number, y: T.string });
    expect(typeValueToTSType(obj)).toBe("{ x: number; y: string }");
  });

  it("converts array type", () => {
    expect(typeValueToTSType(T.array(T.number))).toBe("number[]");
  });

  it("converts union array type with parens", () => {
    expect(typeValueToTSType(T.array(T.union(T.number, T.string)))).toBe("(number | string)[]");
  });

  it("converts tuple type", () => {
    expect(typeValueToTSType(T.tuple([T.number, T.string]))).toBe("[number, string]");
  });

  it("converts promise type", () => {
    expect(typeValueToTSType(T.promise(T.number))).toBe("Promise<number>");
  });

  it("converts instance type", () => {
    expect(typeValueToTSType(T.instanceOf("Error"))).toBe("Error");
  });

  it("converts union type", () => {
    expect(typeValueToTSType(T.union(T.number, T.string))).toBe("number | string");
  });

  it("converts never and unknown", () => {
    expect(typeValueToTSType(T.never)).toBe("never");
    expect(typeValueToTSType(T.unknown)).toBe("unknown");
  });
});

describe("generateDts", () => {
  it("generates .d.ts from analysis result", () => {
    const source = `
/**
 * @just:case "concrete" (1, 2)
 * @just:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}
`;
    const result = analyzeFile("/test/gen.just.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("export declare function add");
    expect(dts).toContain("): 3;");
    expect(dts).toContain("): number;");
  });

  it("generates single overload for single case", () => {
    const source = `
/**
 * @just:case "test" (T.number)
 */
function identity(x) {
  return x;
}
`;
    const result = analyzeFile("/test/single.just.js", source);
    const dts = generateDts(result);
    const lines = dts.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("export declare function identity");
  });
});
