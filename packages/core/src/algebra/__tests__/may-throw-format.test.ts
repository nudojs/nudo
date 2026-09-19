/** P2: formatThrowsAbs 形状覆盖 + check 真 unknown → nudo:unknown-inference */
import { describe, it, expect } from "vitest";
import { abs } from "../abs.ts";
import { formatThrowsAbs, errorTypeAbs, mayThrowEffectsToAbs } from "../exec/may-throw.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

describe("formatThrowsAbs shape coverage", () => {
  it("brand / sum keep concrete names", () => {
    expect(formatThrowsAbs(errorTypeAbs("TypeError"))).toBe("TypeError");
    const sum = mayThrowEffectsToAbs([
      { kind: "TypeError", cause: "a" },
      { kind: "RangeError", cause: "b" },
    ]);
    expect(formatThrowsAbs(sum)).toBe("RangeError | TypeError");
  });
  it("prim / any / unknown are honest, not invented Error", () => {
    expect(formatThrowsAbs(abs({ k: "prim", type: "string" }))).toBe("string");
    expect(formatThrowsAbs(abs({ k: "prim", type: "number" }))).toBe("number");
    expect(formatThrowsAbs(abs({ k: "any" }))).toBe("any");
    expect(formatThrowsAbs(abs({ k: "unknown" }))).toBe("unknown");
    expect(formatThrowsAbs(abs({ k: "never" }))).toBeUndefined();
  });
});

describe("nudo:unknown-inference", () => {
  it("does not fire on unconstrained any entry", () => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const r = checkSource(
      "unk-ok.js",
      "export function id(x){ return x; }\n",
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:unknown-inference")).toBe(false);
  });
});
