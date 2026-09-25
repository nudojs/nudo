/**
 * d.ts 生成对 CJS-bound 函数的跳过行为（自 analyzer.test.ts 拆出）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../dts-generator.ts";

describe("analyzeFile", () => {
  it("skips CJS-bound functions in d.ts generation while keeping them in analysis", () => {
    const source = `
function declared(x) {
  return x * 2;
}
module.exports = internals.clone = function (obj) {
  return obj;
};
`;
    const result = analyzeFile("/test/dts-skip.js", source);
    const clone = result.functions.find((f) => f.name === "clone");
    expect(clone).toBeDefined();
    const dts = generateDts(result);
    expect(dts).toContain("export declare function declared");
    expect(dts).not.toContain("clone");
    expect(dts).not.toContain("module");
  });

});

