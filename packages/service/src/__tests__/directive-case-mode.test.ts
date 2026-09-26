/**
 * 惰性 @nudo:case：默认 all（库兼容）；check/IDE 传 none 走 entry@；
 * selected 只跑 activeCases 选中。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";

const SRC = `
/**
 * @nudo:case "a" (1) => number()
 * @nudo:case "b" (2) => number()
 */
function id(x) { return x; }
`;

describe("DirectiveCaseMode", () => {
  it("default all evaluates every @nudo:case", () => {
    const r = analyzeFile("/cm/all.js", SRC);
    const fn = r.functions.find((f) => f.name === "id")!;
    expect(fn.cases.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("none skips cases and synthesizes entry@", () => {
    const r = analyzeFile("/cm/none.js", SRC, undefined, undefined, undefined, "none");
    const fn = r.functions.find((f) => f.name === "id")!;
    expect(fn.cases.every((c) => c.source !== "directive")).toBe(true);
    expect(fn.cases.some((c) => c.name.startsWith("entry@"))).toBe(true);
  });

  it("selected runs only the activeCases index", () => {
    const r = analyzeFile(
      "/cm/sel.js",
      SRC,
      new Map([["id", 1]]),
      undefined,
      undefined,
      "selected",
    );
    const fn = r.functions.find((f) => f.name === "id")!;
    expect(fn.cases.map((c) => c.name)).toEqual(["b"]);
  });
});
