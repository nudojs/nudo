import { describe, it, expect } from "vitest";
import { checkSource, serializeCheckJson, pTrue } from "../index.ts";

describe("CheckJson contract v1", () => {
  const src = `
/**
 * @nudo:requires x > 0
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;

  it("has stable top-level fields", () => {
    const j = serializeCheckJson(checkSource("c.js", src, pTrue));
    expect(j.version).toBe(1);
    expect(j.file).toBe("c.js");
    expect(j.ok).toBe(false);
    expect(j.summary).toMatchObject({
      errors: expect.any(Number),
      warnings: expect.any(Number),
      infos: expect.any(Number),
      functions: expect.any(Number),
    });
    expect(Array.isArray(j.signatures)).toBe(true);
    expect(Array.isArray(j.issues)).toBe(true);
  });

  it("signatures carry abs display + detail", () => {
    const j = serializeCheckJson(checkSource("c.js", src, pTrue));
    const sig = j.signatures.find((s) => s.name === "needsPositive");
    expect(sig).toBeDefined();
    expect(sig!.params).toEqual(["x"]);
    expect(sig!.abs).toContain("#");
    expect(typeof sig!.conf).toBe("string");
  });

  it("issues carry actual/expected for violations", () => {
    const j = serializeCheckJson(checkSource("c.js", src, pTrue));
    const err = j.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.actual).toBeDefined();
    expect(err!.expected).toBeDefined();
    expect(err!.line).toBeGreaterThan(0);
  });

  it("ok file has ok:true and empty error issues", () => {
    const j = serializeCheckJson(
      checkSource("ok.js", `function f(x){ return x+1; }\nf(1);\n`, pTrue),
    );
    expect(j.ok).toBe(true);
    expect(j.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
