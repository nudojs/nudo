import { describe, it, expect } from "vitest";
import { callAbsMethod, getAbsProperty } from "../methods.ts";
import { createTemplateAbs } from "../template.ts";
import { strLit, numLit, abs } from "../abs.ts";
import { formatShape } from "../format.ts";
import { analyzeFn } from "../ast-eval.ts";

describe("Abs method table", () => {
  it("template startsWith with known prefix", () => {
    // `xy${string}`
    const tmpl = createTemplateAbs([strLit("xy"), abs({ k: "prim", type: "string" }, undefined, undefined, "exact")]);
    const r = callAbsMethod(tmpl, "startsWith", [strLit("x")]);
    expect(r && formatShape(r)).toBe("true");
    const r2 = callAbsMethod(tmpl, "startsWith", [strLit("a")]);
    expect(r2 && formatShape(r2)).toBe("false");
  });

  it("template length with all-literal parts", () => {
    // createTemplateAbs with two lits folds to single lit; use mixed
    const tmpl = createTemplateAbs([strLit("ab"), abs({ k: "prim", type: "string" }, undefined, undefined, "exact")]);
    const len = getAbsProperty(tmpl, "length");
    expect(len).toBeDefined();
    expect(len!.shape.k).toBe("prim");
  });

  it("analyzeFn uses method table", () => {
    const src = `
      function f(x) {
        const s = "xy" + x;
        return s.startsWith("x");
      }
    `;
    const r = analyzeFn(src, "f", [abs({ k: "prim", type: "string" }, undefined, undefined, "exact")]);
    expect(formatShape(r)).toBe("true");
  });
});
