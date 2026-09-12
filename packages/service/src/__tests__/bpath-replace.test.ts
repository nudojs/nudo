import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { typeValueToString } from "@nudojs/core";

describe("@nudo:replace on B path", () => {
  it("replaces only matching sub-expression", () => {
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
    const result = analyzeFile("/test/replace2.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("100");
  });

  it("replaces call expression target", () => {
    const source = `
/**
 * @nudo:case "test" ("{\"id\":1}")
 */
function process(input) {
  // @nudo:replace JSON.parse(input) T.object({ id: T.number })
  const data = JSON.parse(input);
  return data.id;
}
`;
    const result = analyzeFile("/test/replace3.js", source);
    expect(typeValueToString(result.functions[0].cases[0].result)).toBe("number");
  });
});
