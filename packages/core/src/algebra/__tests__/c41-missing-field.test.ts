/**
 * C4.1：解构契约在调用点「缺字段」必须报 violation，不能静默跳过（FN）。
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

function loadWith(files: Record<string, string>) {
  return (spec: string, fromFile: string) => {
    const dir = path.dirname(fromFile);
    const joined = path.resolve(dir, spec);
    return files[joined] ?? files[spec];
  };
}

describe("C4.1 destructure missing contracted field", () => {
  it("call site omitting contracted destructure field reports constraint-violated", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const loadModule = loadWith({
      "/t/g.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const g = fn({ x: number().gt(0) }, number());\n`,
    });
    const src = `
export function g({ x, y }) {
  return x + y;
}
g({ y: 2 });
`;
    const r = checkSource("/t/g.js", src, pTrue, {
      loadModule,
      fromFile: "/t/g.js",
      autoBind: true,
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated[0]!.expected).toContain("missing field");
    expect(violated[0]!.expected).toContain("x");
  });

  it("unknown call-site arg still does not invent a missing-field error", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const loadModule = loadWith({
      "/t/g.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const g = fn({ x: number().gt(0) }, number());\n`,
    });
    const src = `
export function g({ x, y }) {
  return x + y;
}
export function call(a) {
  return g(a);
}
`;
    const r = checkSource("/t/g2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/g2.js",
      autoBind: true,
    });
    const missing = r.issues.filter(
      (i) => i.code === "nudo:constraint-violated" && String(i.expected ?? "").includes("missing field"),
    );
    expect(missing).toEqual([]);
  });
});
