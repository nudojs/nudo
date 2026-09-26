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
  it("sum keeps any/unknown arms honest (no silent filter)", () => {
    const mixed = mayThrowEffectsToAbs([
      { kind: "TypeError", cause: "a" },
      { kind: "any", cause: "b" },
    ]);
    expect(formatThrowsAbs(mixed)).toBe("TypeError | any");
  });
  it("prim / any / unknown are honest, not invented Error", () => {
    expect(formatThrowsAbs(abs({ k: "prim", type: "string" }, undefined, undefined, "exact"))).toBe("string");
    expect(formatThrowsAbs(abs({ k: "prim", type: "number" }, undefined, undefined, "exact"))).toBe("number");
    expect(formatThrowsAbs(abs({ k: "any" }, undefined, undefined, "exact"))).toBe("any");
    expect(formatThrowsAbs(abs({ k: "unknown" }, undefined, undefined, "exact"))).toBe("unknown");
    expect(formatThrowsAbs(abs({ k: "never" }, undefined, undefined, "exact"))).toBeUndefined();
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
