import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";

describe("loop early return folds into Abs (C2.1)", () => {
  it("for-of conditional return hits the matching element", () => {
    const src = `
/**
 * @nudo:case "break-loop" ([1, 2, 3, 4, 5])
 */
function findFirst(arr) {
  for (const item of arr) {
    if (item > 3) return item;
  }
  return undefined;
}
`;
    const r = analyzeFile("loop.js", src);
    const fn = r.functions.find((f) => f.name === "findFirst");
    const call = fn!.cases!.find((c) => c.name === "break-loop");
    expect(call).toBeDefined();
    const text = call!.intension?.abs ?? JSON.stringify(call!.abs);
    expect(text).toContain("4");
  });

  it("falls through to tail return when no match", () => {
    const src = `
/**
 * @nudo:case "none" ([1, 2])
 */
function findFirst(arr) {
  for (const item of arr) {
    if (item > 10) return item;
  }
  return -1;
}
`;
    const r = analyzeFile("loop2.js", src);
    const fn = r.functions.find((f) => f.name === "findFirst");
    const call = fn!.cases!.find((c) => c.name === "none");
    const text = call!.intension?.abs ?? JSON.stringify(call!.abs);
    expect(text).toContain("-1");
  });
});
