import { describe, it, expect } from "vitest";
import {
  compileRequiresExpr,
  extractNudoImports,
  parseInterfaceConstraints,
  requiresToIndexed,
} from "../requires.ts";
import { checkSource, pTrue } from "../index.ts";

const intf = `
export const delay = "ms > 0";
export const percent = { pred: "n >= 0" };
`;

const loadModule = (spec: string): string | undefined => {
  if (spec.includes("interface")) return intf;
  return undefined;
};

describe("@nudo:import + interface constraints", () => {
  it("parses imports and interface exports", () => {
    const src = `/// @nudo:import * as V from "./interface.nudo.js"\n`;
    expect(extractNudoImports(src)).toEqual([
      { ns: "V", spec: "./interface.nudo.js" },
    ]);
    const map = parseInterfaceConstraints(intf);
    expect(map.get("delay")).toBe("ms > 0");
    expect(map.get("percent")).toBe("n >= 0");
  });

  it("resolves V.delay to Pred on param ms", () => {
    const src = `
/// @nudo:import * as V from "./interface.nudo.js"
/**
 * @nudo:requires V.delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
`;
    const reqs = requiresToIndexed(src, "setDelay", ["ms"], {
      loadModule,
      fromFile: "/t/demo.js",
    });
    expect(reqs.length).toBe(1);
    expect(reqs[0]![0]).toBe(0);
    expect(reqs[0]![1].op).toBe("gt");
  });

  it("check catches violation from interface binding", () => {
    const src = `
/// @nudo:import * as V from "./interface.nudo.js"
/**
 * @nudo:requires V.delay
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
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated"),
    ).toBe(true);
  });

  it("mixes interface binding with inline && fragment", () => {
    const src = `
/// @nudo:import * as V from "./interface.nudo.js"
/**
 * @nudo:requires V.percent && n <= 100
 */
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(150);
`;
    const r = checkSource("/t/pct.js", src, pTrue, {
      loadModule,
      fromFile: "/t/pct.js",
    });
    expect(r.ok).toBe(false);
  });
});
