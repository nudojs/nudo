import { describe, it, expect } from "vitest";
import {
  number,
  instantiateConstraint,
  isNudoConstraint,
} from "../constraint.ts";
import {
  execNudoModule,
  extractNudoImports,
  extractRefinesFromSource,
  extractRefineReturnFromSource,
  refineToIndexedFull,
} from "../refine.ts";
import { checkSource, pTrue } from "../index.ts";
import { predToString } from "../pred.ts";

const intf = `
export const delay = number().gt(0);
export const percent = number().ge(0).le(100);
`;

const loadModule = (spec: string): string | undefined => {
  if (spec.includes("nudo")) return intf;
  return undefined;
};

describe("@nudo:contract <param> <constraint>", () => {
  it("number().gt(0) instantiates to param > 0", () => {
    const c = number().gt(0);
    expect(isNudoConstraint(c)).toBe(true);
    expect(predToString(instantiateConstraint(c, "ms"))).toBe("ms > 0");
  });

  it("chains bounds", () => {
    const c = number().ge(0).le(100);
    expect(predToString(instantiateConstraint(c, "n"))).toContain("0");
    expect(predToString(instantiateConstraint(c, "n"))).toContain("100");
  });

  it("executes .nudo.js module", () => {
    const exp = execNudoModule(intf);
    expect(Object.keys(exp).sort()).toEqual(["delay", "percent"]);
    expect(isNudoConstraint(exp.delay)).toBe(true);
  });

  it("parses named @nudo:import", () => {
    const src = `/// @nudo:import { delay, percent } from "./x.nudo.js"\n`;
    expect(extractNudoImports(src)).toEqual([
      { names: ["delay", "percent"], spec: "./x.nudo.js" },
    ]);
  });

  it("multiline /// @nudo:import strips line prefixes from names", () => {
    const src = `/// @nudo:import {\n///   delay,\n///   percent\n/// } from "./x.nudo.js"\n`;
    expect(extractNudoImports(src)).toEqual([
      { names: ["delay", "percent"], spec: "./x.nudo.js" },
    ]);
  });

  it("import-like text inside a template string is not an import", () => {
    const src =
      'const d = `\n@nudo:import { delay } from "./evil.nudo.js"\n`;\nexport function f(x){return x}';
    expect(extractNudoImports(src)).toEqual([]);
  });

  it("function name inside a string literal does not steal contract scan", () => {
    const src = `
/// @nudo:import { delay } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 */
const code = "function setDelay() { return 0; }";
/**
 * @nudo:contract n delay
 */
export function setDelay(n) { return n; }
`;
    const reqs = extractRefinesFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(reqs.map((r) => r.param)).toEqual(["n"]);
  });

  it("resolves ms delay to Pred", () => {
    const src = `
/// @nudo:import { delay } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
`;
    const reqs = extractRefinesFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.param).toBe("ms");
    expect(predToString(reqs[0]!.pred)).toBe("ms > 0");
  });

  it("check catches violation from template", () => {
    const src = `
/// @nudo:import { delay } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
setDelay(0);
`;
    const r = checkSource("/t/demo.js", src, pTrue, {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("refineToIndexedFull maps param names", () => {
    const src = `
/// @nudo:import { delay, percent } from "./x.nudo.js"
/**
 * @nudo:contract ms delay
 * @nudo:contract n percent
 */
function f(ms, n) {
  return ms + n;
}
`;
    const idx = refineToIndexedFull(src, "f", ["ms", "n"], {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(idx.length).toBe(2);
  });

  it("namespace import expands ns.foo template refs", () => {
    const src = `
/// @nudo:import * as shapes from "./x.nudo.js"
/**
 * @nudo:contract ms shapes.delay
 * @nudo:contract return shapes.percent
 */
function setDelay(ms) {
  return ms;
}
`;
    const reqs = extractRefinesFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/ns.js",
    });
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.param).toBe("ms");
    expect(predToString(reqs[0]!.pred)).toBe("ms > 0");

    const ret = extractRefineReturnFromSource(src, "setDelay", {
      loadModule,
      fromFile: "/t/ns.js",
    });
    expect(ret?.name).toBe("shapes.percent");
    expect(isNudoConstraint(ret!.constraint)).toBe(true);
  });
});
