import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";

describe("@nudo:as directive", () => {
  it("overrides VariableDeclaration init value", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (string())
 */
function loadConfig(path) {
  // @nudo:as shape({ port: number(), host: string() })
  const config = JSON.parse(path);
  return config;
}
`;
    const result = analyzeFile("/test/as.js", source);
    const res = formatShape(result.functions[0].cases[0].abs);
    expect(res).toContain("port: number");
    expect(res).toContain("host: string");
  });

  it("overrides ReturnStatement value", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (string())
 */
function loadConfig(path) {
  // @nudo:as shape({ name: string(), age: number() })
  return JSON.parse(path);
}
`;
    const result = analyzeFile("/test/as.js", source);
    const res = formatShape(result.functions[0].cases[0].abs);
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
  // @nudo:as string()
  const a = x + 1;
  const b = x + 2;
  return b;
}
`;
    const result = analyzeFile("/test/as.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("7");
  });
});

describe("@nudo:replace directive", () => {
  it("replaces a sub-expression by source text match", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (string())
 */
function process(input) {
  // @nudo:replace JSON.parse(input) shape({ id: number() })
  const data = JSON.parse(input);
  return data.id;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("number");
  });

  it("replaces only the matching sub-expression, not the whole line", () => {
    const source = `
/**
 * @nudo:case "test" (5, 10)
 */
function compute(a, b) {
  // @nudo:replace a lit(100)
  const result = a + b;
  return result;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("110");
  });

  it("does not match partial identifiers", () => {
    const source = `
/**
 * @nudo:case "test" ()
 */
function test() {
  const aa = 1;
  const a = 2;
  // @nudo:replace a lit(99)
  const result = aa + a;
  return result;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("100");
  });

  it("supports member expression replacement", () => {
    const source = `
/**
 * @nudo:case "test" (shape({ data: any() }))
 */
function process(res) {
  // @nudo:replace res.data array(shape({ id: number(), name: string() }))
  const items = res.data;
  return items;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    const res = formatShape(result.functions[0].cases[0].abs);
    expect(res).toContain("id: number");
    expect(res).toContain("name: string");
  });

  it("replacement only affects the next statement", () => {
    const source = `
/**
 * @nudo:case "test" (5, 10)
 */
function compute(a, b) {
  // @nudo:replace a lit(100)
  const x = a + b;
  const y = a + b;
  return y;
}
`;
    const result = analyzeFile("/test/replace.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("15");
  });
});

describe("@nudo:as and @nudo:replace coexistence", () => {
  it("both can be used in the same function", () => {
    const source = `
/// @nudo:env es

/**
 * @nudo:case "test" (string())
 */
function process(input) {
  // @nudo:as shape({ name: string(), score: number() })
  const data = JSON.parse(input);
  // @nudo:replace data.score lit(100)
  const result = data.score;
  return result;
}
`;
    const result = analyzeFile("/test/both.js", source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("100");
  });
});
