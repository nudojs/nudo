import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { typeValueToString } from "@nudojs/core";

describe("@nudo:as on B path", () => {
  it("overrides VariableDeclaration init value", () => {
    const source = `
/**
 * @nudo:case "test" ("{}")
 */
function loadConfig(path) {
  // @nudo:as T.object({ port: T.number, host: T.string })
  const config = JSON.parse(path);
  return config;
}
`;
    const result = analyzeFile("/test/as.js", source);
    const res = typeValueToString(result.functions[0].cases[0].result);
    expect(res).toContain("port: number");
    expect(res).toContain("host: string");
  });

  it("overrides ReturnStatement value", () => {
    const source = `
/**
 * @nudo:case "test" ("{}")
 */
function loadConfig(path) {
  // @nudo:as T.object({ name: T.string, age: T.number })
  return JSON.parse(path);
}
`;
    const result = analyzeFile("/test/as2.js", source);
    const res = typeValueToString(result.functions[0].cases[0].result);
    expect(res).toContain("name: string");
    expect(res).toContain("age: number");
  });

  it("does not affect statements without @nudo:as", () => {
    const source = `
/**
 * @nudo:case "test" (5)
 */
function add(x) {
  // @nudo:as T.literal(99)
  const y = x + 1;
  const z = x + 2;
  return z;
}
`;
    const result = analyzeFile("/test/as3.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("7");
  });
});
