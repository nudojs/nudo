/**
 * C4.1：解构侧车契约在调用点的执法（locateContractParam → 字段投影）。
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

type Files = Record<string, string>;
function makeFiles(files: Files) {
  return {
    loadModule: (spec: string, fromFile: string) => {
      const dir = path.dirname(fromFile);
      const joined = path.resolve(dir, spec);
      return files[joined] ?? files[spec];
    },
  };
}

describe("C4.1 deconstructed sidecar callsite enforcement", () => {
  it("deconstructed contract field constraint is enforced at callsite on bad field", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/g.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const g = fn({ x: number().gt(0) }, number());\n`,
    });
    const src = `
export function g({ x, y }) {
  return x + y;
}
g({ x: -1, y: 2 });
`;
    const r = checkSource("/t/g.js", src, pTrue, {
      loadModule,
      fromFile: "/t/g.js",
      autoBind: true,
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated[0]!.message).toContain("x");
  });

  it("deconstructed contract satisfied call produces no constraint-violated", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/g.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const g = fn({ x: number().gt(0) }, number());\n`,
    });
    const src = `
export function g({ x, y }) {
  return x + y;
}
g({ x: 5, y: 2 });
`;
    const r = checkSource("/t/g2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/g2.js",
      autoBind: true,
    });
    expect(
      r.issues.filter((i) => i.code === "nudo:constraint-violated"),
    ).toEqual([]);
  });

  it("non-deconstructed identifier param still enforced", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/h.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const h = fn({ n: number().gt(0) }, number());\n`,
    });
    const src = `
export function h(n) {
  return n;
}
h(-3);
`;
    const r = checkSource("/t/h.js", src, pTrue, {
      loadModule,
      fromFile: "/t/h.js",
      autoBind: true,
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  });
});
