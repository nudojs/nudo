import { describe, it, expect } from "vitest";
import { T, getFnSig, isFnSig, typeValueEquals, typeValueToString } from "../index.ts";

describe("T.fnSig with impl", () => {
  it("creates fnSig without impl (backward compatible)", () => {
    const fn = T.fnSig([T.number], T.string);
    expect(isFnSig(fn)).toBe(true);
    const sig = getFnSig(fn)!;
    expect(sig.impl).toBeUndefined();
    expect(typeValueEquals(sig.returnType, T.string)).toBe(true);
  });

  it("creates fnSig with impl", () => {
    const fn = T.fnSig([T.number], T.number, T.never, (args) => {
      if (args[0].kind === "literal" && typeof args[0].value === "number") {
        return T.literal(args[0].value * 2);
      }
      return undefined;
    });
    expect(isFnSig(fn)).toBe(true);
    const sig = getFnSig(fn)!;
    expect(sig.impl).toBeDefined();
  });

  it("impl returns concrete value for literal args", () => {
    const fn = T.fnSig([T.number], T.number, T.never, (args) => {
      if (args[0].kind === "literal" && typeof args[0].value === "number") {
        return T.literal(args[0].value * 2);
      }
      return undefined;
    });
    const sig = getFnSig(fn)!;
    const result = sig.impl!([T.literal(5)]);
    expect(result).toBeDefined();
    expect(typeValueEquals(result!, T.literal(10))).toBe(true);
  });

  it("impl returns undefined for symbolic args (fallback to returnType)", () => {
    const fn = T.fnSig([T.number], T.number, T.never, (args) => {
      if (args[0].kind === "literal" && typeof args[0].value === "number") {
        return T.literal(args[0].value * 2);
      }
      return undefined;
    });
    const sig = getFnSig(fn)!;
    const result = sig.impl!([T.number]);
    expect(result).toBeUndefined();
  });

  it("typeValueToString still works for fnSig with impl", () => {
    const fn = T.fnSig([T.number, T.string], T.boolean, T.never, () => T.literal(true));
    const str = typeValueToString(fn);
    expect(str).toContain("number");
    expect(str).toContain("string");
    expect(str).toContain("boolean");
  });
});
