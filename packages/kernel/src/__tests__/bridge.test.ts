import { describe, it, expect } from "vitest";
import {
  absToTypeValue,
  typeValueToAbs,
  bridgeIsLossy,
  getTvConfidence,
  numLit,
  numVar,
  gtNum,
  v,
  litValue,
  formatShape,
  analyzeFn,
  objOf,
  strLit,
  boolLit,
} from "../index.ts";
import { typeValueToString, T } from "@nudojs/core";

describe("bridge Abs → TypeValue", () => {
  it("literal 4 → literal 4 #exact", () => {
    const tv = absToTypeValue(numLit(4));
    expect(tv.kind).toBe("literal");
    if (tv.kind === "literal") expect(tv.value).toBe(4);
    expect(getTvConfidence(tv)).toBe("exact");
  });

  it("plain number prim → primitive number", () => {
    const tv = absToTypeValue({
      shape: { k: "prim", type: "number" },
      conf: "exact",
    });
    expect(typeValueToString(tv)).toBe("number");
  });

  it("x>0 with pred → refined number", () => {
    const a = numVar("x", gtNum(v("x"), 0));
    const tv = absToTypeValue(a);
    // term 是 var，会丢 term；pred 可 encode 为 refined
    expect(tv.kind === "refined" || tv.kind === "primitive").toBe(true);
    const lossy = bridgeIsLossy(a);
    // 丢 term 是预期的
    expect(lossy.reasons.some((r) => r.includes("term"))).toBe(true);
  });

  it("object slots map to object TypeValue", () => {
    const o = objOf({
      host: { value: strLit("localhost") },
      port: { value: numLit(8080) },
      debug: { value: boolLit(false) },
    });
    const tv = absToTypeValue(o);
    expect(tv.kind).toBe("object");
    expect(typeValueToString(tv)).toContain("host");
    expect(typeValueToString(tv)).toContain("8080");
  });
});

describe("bridge TypeValue → Abs", () => {
  it("literal 6 → Abs exact 6", () => {
    const abs = typeValueToAbs(T.literal(6));
    expect(litValue(abs)).toBe(6);
    expect(abs.conf).toBe("exact");
  });

  it("primitive string → prim string", () => {
    const abs = typeValueToAbs(T.string);
    expect(formatShape(abs)).toBe("string");
  });

  it("object → obj slots", () => {
    const abs = typeValueToAbs(
      T.object({ a: T.literal(1), b: T.string }),
    );
    expect(abs.shape.k).toBe("obj");
  });

  it("round-trip literal", () => {
    const tv = absToTypeValue(numLit(42));
    const back = typeValueToAbs(tv);
    expect(litValue(back)).toBe(42);
  });

  it("round-trip primitive (lossless)", () => {
    const abs0 = {
      shape: { k: "prim" as const, type: "number" as const },
      conf: "exact" as const,
    };
    const tv = absToTypeValue(abs0);
    const back = typeValueToAbs(tv);
    expect(formatShape(back)).toBe("number");
  });
});

describe("bridgeIsLossy", () => {
  it("literal is not lossy", () => {
    expect(bridgeIsLossy(numLit(1)).lossy).toBe(false);
  });
  it("symbolic term is lossy", () => {
    const src = `
      function scale(x) { return x + 1; }
    `;
    const r = analyzeFn(src, "scale", [numVar("x")]);
    expect(bridgeIsLossy(r).lossy).toBe(true);
  });
});
