import { describe, it, expect } from "vitest";
import {
  formalParamsFromNodes,
  formalParamDisplayNames,
  contractParamNameSet,
  locateContractParam,
} from "../param-surface.ts";
import { generalizeFromAst } from "../generalize.ts";
import { parseSource } from "../parse-source.ts";
import { effectiveInterface, formatConstraint } from "../interface.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { number, fn } from "../constraint.ts";

describe("C4.1 formalParamsFromNodes", () => {
  it("maps identifier / default / rest / object pattern", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
      { type: "RestElement", argument: { type: "Identifier", name: "args" } },
      {
        type: "ObjectPattern",
        properties: [
          { type: "ObjectProperty", key: { type: "Identifier", name: "x" }, value: { type: "Identifier", name: "x" } },
          { type: "ObjectProperty", key: { type: "Identifier", name: "y" }, value: { type: "Identifier", name: "y" } },
        ],
      },
    ] as never);
    expect(formalParamDisplayNames(formals)).toEqual(["a", "b", "...args", "_p3"]);
    const names = contractParamNameSet(formals);
    expect(names.has("a")).toBe(true);
    expect(names.has("b")).toBe(true);
    expect(names.has("args")).toBe(true);
    expect(names.has("...args")).toBe(true);
    expect(names.has("x")).toBe(true);
    expect(names.has("y")).toBe(true);
    expect(locateContractParam(formals, "b")).toEqual({ index: 1 });
    expect(locateContractParam(formals, "args")).toEqual({ index: 2, rest: true });
    expect(locateContractParam(formals, "x")).toEqual({ index: 3, field: "x" });
  });
});

describe("C4.1 generalize formals alignment", () => {
  it("default param keeps left name in g.params", () => {
    const g = generalizeFromAst("f", "function f(x = 1) { return x; }\n");
    expect(g?.params).toEqual(["x"]);
    expect(g?.formals?.[0]).toMatchObject({ kind: "default", name: "x" });
  });

  it("rest param display is ...name", () => {
    const g = generalizeFromAst("sum", "function sum(...nums) { return nums; }\n");
    expect(g?.params).toEqual(["...nums"]);
    expect(g?.formals?.[0]).toMatchObject({ kind: "rest", name: "nums" });
  });

  it("object pattern exposes bound names on formals", () => {
    const g = generalizeFromAst(
      "greet",
      "function greet({ name, age }) { return name; }\n",
    );
    expect(g?.params).toEqual(["_p0"]);
    const names = contractParamNameSet(g?.formals ?? []);
    expect(names.has("name")).toBe(true);
    expect(names.has("age")).toBe(true);
  });
});

function makeFiles(files: Record<string, string>) {
  const resolve = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  return {
    loadModule: (spec: string, from: string): string | undefined =>
      files[resolve(from, spec)],
  };
}

describe("C4.1 sidecar binds default / rest / destructure names", () => {
  it("default param name binds sidecar contract", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `export const f = fn({ x: number().gt(0) }, number());`,
    });
    const src = `export function f(x = 1) {\n  return x;\n}\n`;
    const r = effectiveInterface(src, "f", { loadModule, fromFile: "/t/f.js" });
    expect(r).toBeDefined();
    expect(formatConstraint(r!.params[0]!.constraint)).toBe("number().gt(0)");
  });

  it("rest bare name binds sidecar contract", () => {
    const { loadModule } = makeFiles({
      "/t/sum.nudo.js": `export const sum = fn({ nums: array(number()) }, number());`,
    });
    const src = `export function sum(...nums) {\n  return nums.length;\n}\n`;
    const r = effectiveInterface(src, "sum", { loadModule, fromFile: "/t/sum.js" });
    expect(r).toBeDefined();
    expect(r!.params[0]!.param).toBe("nums");
  });

  it("destructure bound names bind sidecar contract", () => {
    const { loadModule } = makeFiles({
      "/t/g.nudo.js": `export const g = fn({ x: number().int() }, number());`,
    });
    const src = `export function g({ x, y }) {\n  return x + y;\n}\n`;
    const r = effectiveInterface(src, "g", { loadModule, fromFile: "/t/g.js" });
    expect(r).toBeDefined();
    expect(r!.params[0]!.param).toBe("x");
    expect(formatConstraint(r!.params[0]!.constraint)).toBe("number().int()");
  });

  it("wrong name on default param → param-mismatch; destructure name ok", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);`,
    });
    const bad = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine y positive
 */
export function f(x = 1) {
  return x;
}
`;
    const r = checkSource("/t/f.js", bad, pTrue, {
      loadModule,
      fromFile: "/t/f.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:interface-param-mismatch");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("y");

    const ok = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
export function f(x = 1) {
  return x > 0 ? x : 0;
}
f(5);
`;
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const r2 = checkSource("/t/f2.js", ok, pTrue, {
      loadModule,
      fromFile: "/t/f2.js",
    });
    expect(r2.issues.filter((i) => i.code === "nudo:interface-param-mismatch")).toEqual([]);
  });
});

describe("C4.1 locateContractParam in case witnesses", () => {
  it("default-param contract name binds case witness slot", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const { loadModule } = makeFiles({
      "/t/d.nudo.js": `export const d = fn({ x: number().gt(0) }, number());`,
    });
    const src = `
/**
 * @nudo:case "neg" (-1)
 */
export function d(x = 1) {
  return x;
}
`;
    const r = checkSource("/t/d.js", src, pTrue, {
      loadModule,
      fromFile: "/t/d.js",
    });
    const issue = r.issues.find((i) => i.code === "nudo:case-inconsistency");
    expect(issue).toBeDefined();
    expect(issue!.fn).toBe("d");
  });
});
