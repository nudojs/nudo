import { describe, it, expect } from "vitest";
import { leqAbs, requiredFnArity } from "../leq.ts";
import { abs, numLit, strLit, boolLit, num, str, unknown, never } from "../abs.ts";
import { v, lit } from "../term.ts";
import { gt, ge, pTrue } from "../pred.ts";

function numWithPred(n: number, op: "gt" | "ge" = "gt") {
  return abs(num().shape, v("x"), op === "gt" ? gt(v("x"), lit(n)) : ge(v("x"), lit(n)), "path");
}

describe("leqAbs structural assignability", () => {
  it("never and unknown poles", () => {
    expect(leqAbs(never, num()).ok).toBe(true);
    expect(leqAbs(numLit(1), unknown).ok).toBe(true);
  });

  it("prim and literal", () => {
    expect(leqAbs(numLit(1), num()).ok).toBe(true);
    expect(leqAbs(strLit("a"), str()).ok).toBe(true);
    expect(leqAbs(numLit(1), str()).ok).toBe(false);
  });

  it("object width and depth", () => {
    const src = abs(
      {
        k: "obj",
        slots: { a: { value: numLit(1) }, b: { value: strLit("x") } },
      },
      undefined,
      undefined,
      "exact",
    );
    const tgt = abs({ k: "obj", slots: { a: { value: num() } } }, undefined, undefined, "exact");
    expect(leqAbs(src, tgt).ok).toBe(true);

    const missing = abs({ k: "obj", slots: { z: { value: num() } } }, undefined, undefined, "exact");
    expect(leqAbs(src, missing).ok).toBe(false);
  });

  it("optional slot may be missing", () => {
    const src = abs({ k: "obj", slots: { a: { value: numLit(1) } } }, undefined, undefined, "exact");
    const tgt = abs(
      { k: "obj", slots: { a: { value: num() }, b: { value: str(), optional: true } } },
      undefined,
      undefined,
      "exact",
    );
    expect(leqAbs(src, tgt).ok).toBe(true);
  });

  it("arr and tuple", () => {
    const tup = abs({ k: "tuple", elements: [numLit(1), numLit(2)] }, undefined, undefined, "exact");
    const arr = abs({ k: "arr", element: num() }, undefined, undefined, "exact");
    expect(leqAbs(tup, arr).ok).toBe(true);
    expect(leqAbs(arr, tup).ok).toBe(false);
  });

  it("brand is nominal", () => {
    const a = abs(
      { k: "brand", name: "A", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const b = abs(
      { k: "brand", name: "B", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    expect(leqAbs(a, a).ok).toBe(true);
    expect(leqAbs(a, b).ok).toBe(false);
  });

  it("numeric pred: stricter source is assignable to wider target", () => {
    const x5 = numWithPred(5, "gt");
    const x0 = numWithPred(0, "gt");
    expect(leqAbs(x5, x0).ok).toBe(true);
    expect(leqAbs(x0, x5).ok).toBe(false);
  });

  it("eff promise inner", () => {
    const p1 = abs(
      { k: "eff", eff: "promise", inner: numLit(1) },
      undefined,
      undefined,
      "exact",
    );
    const p2 = abs({ k: "eff", eff: "promise", inner: num() }, undefined, undefined, "exact");
    expect(leqAbs(p1, p2).ok).toBe(true);
  });

  it("sum source requires all members assignable", () => {
    const sum = abs(
      { k: "sum", members: [numLit(1), numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(leqAbs(sum, num()).ok).toBe(true);
    expect(leqAbs(sum, str()).ok).toBe(false);
  });

  it("fail reason is nudo-style", () => {
    const r = leqAbs(numLit(1), str());
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("prim");
  });

  it("requiredFnArity skips rest and optional labels", () => {
    expect(requiredFnArity(["x0", "...paths"])).toBe(1);
    expect(requiredFnArity(["options?"])).toBe(0);
    expect(requiredFnArity(["path", "ext?"])).toBe(1);
    expect(requiredFnArity(["a", "b"])).toBe(2);
    expect(requiredFnArity(undefined)).toBe(0);
  });
});
