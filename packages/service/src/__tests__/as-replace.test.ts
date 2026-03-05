import { describe, it, expect } from "vitest";
import { typeValueToString } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";

describe("@nudo:as directive", () => {
  it("overrides VariableDeclaration init value", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (T.string)
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
/// @nudo:env es

/**
 * @nudo:case "test" (T.string)
 */
function loadConfig(path) {
  // @nudo:as T.object({ name: T.string, age: T.number })
  return JSON.parse(path);
}
`;
    const result = analyzeFile("/test/as.js", source);
    const res = typeValueToString(result.functions[0].cases[0].result);
    expect(res).toContain("name: string");
    expect(res).toContain("age: number");
  });

  it("does not affect statements without @nudo:as", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (5)
 */
function add(x) {
  // @nudo:as T.string
  const a = x + 1;
  const b = x + 2;
  return b;
}
`;
    const result = analyzeFile("/test/as.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("7");
  });
});

describe("@nudo:replace directive", () => {
  it("replaces a sub-expression by source text match", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (T.string)
 */
function process(input) {
  // @nudo:replace JSON.parse(input) T.object({ id: T.number })
  const data = JSON.parse(input);
  return data.id;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("number");
  });

  it("replaces only the matching sub-expression, not the whole line", () => {
    const source = `
/**
 * @nudo:case "test" (5, 10)
 */
function compute(a, b) {
  // @nudo:replace a T.literal(100)
  const result = a + b;
  return result;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("110");
  });

  it("does not match partial identifiers", () => {
    const source = `
/**
 * @nudo:case "test" ()
 */
function test() {
  const aa = 1;
  const a = 2;
  // @nudo:replace a T.literal(99)
  const result = aa + a;
  return result;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("100");
  });

  it("supports member expression replacement", () => {
    const source = `
/**
 * @nudo:case "test" (T.object({ data: T.unknown }))
 */
function process(res) {
  // @nudo:replace res.data T.array(T.object({ id: T.number, name: T.string }))
  const items = res.data;
  return items;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    const res = typeValueToString(result.functions[0].cases[0].result);
    expect(res).toContain("id: number");
    expect(res).toContain("name: string");
  });

  it("replacement only affects the next statement", () => {
    const source = `
/**
 * @nudo:case "test" (5, 10)
 */
function compute(a, b) {
  // @nudo:replace a T.literal(100)
  const x = a + b;
  const y = a + b;
  return y;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("15");
  });
});

describe("@nudo:as and @nudo:replace coexistence", () => {
  it("both can be used in the same function", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (T.string)
 */
function process(input) {
  // @nudo:as T.object({ name: T.string, score: T.number })
  const data = JSON.parse(input);
  // @nudo:replace data.score T.literal(100)
  const result = data.score;
  return result;
}
`;
    const result = analyzeFile("/test/both.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("100");
  });
});
