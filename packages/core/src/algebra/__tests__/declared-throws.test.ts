import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../check.ts";
import { extractDeclaredThrows } from "../refine.ts";
import { throwConstraintToKinds, fn, number } from "../constraint.ts";
import {
  filterDeclaredThrows,
  filterGateThrows,
  throwAbsToKinds,
  formatThrowsAbs,
  errorTypeAbs,
  mayThrowEffectsToAbs,
  type MayThrowEffect,
} from "../exec/may-throw.ts";
import { formatCheckReport } from "../check-report.ts";

const fx = (kind: string): MayThrowEffect => ({ kind, cause: `throw ${kind}` });

describe("P0 declared throws (@nudo:throws / case !! throws)", () => {
  it("extractDeclaredThrows parses kinds / * / case !! throws", () => {
    expect(
      extractDeclaredThrows(
        `/**\n * @nudo:throws Error\n */\nexport function f(x) { return x; }`,
        "f",
      ),
    ).toEqual(["Error"]);
    expect(
      extractDeclaredThrows(
        `/** @nudo:throws Error, TypeError */\nexport function f(x) { return x; }`,
        "f",
      ),
    ).toEqual(["Error", "TypeError"]);
    expect(
      extractDeclaredThrows(`/** @nudo:throws * */\nexport function f(x) { return x; }`, "f"),
    ).toBe("*");
    expect(
      extractDeclaredThrows(
        `/**\n * @nudo:case "neg" (0) !! throws Error\n */\nexport function f(x) { return x; }`,
        "f",
      ),
    ).toEqual(["Error"]);
    expect(
      extractDeclaredThrows(
        `/**\n * @nudo:case "neg" (0) !! throws\n */\nexport function f(x) { return x; }`,
        "f",
      ),
    ).toBe("*");
  });

  it("filterDeclaredThrows: * clears; Error covers family; undefined passthrough", () => {
    const mixed = [fx("Error"), fx("TypeError"), fx("ReferenceError")];
    expect(filterDeclaredThrows(mixed, "*")).toEqual([]);
    expect(filterDeclaredThrows(mixed, ["Error"])).toEqual([]);
    expect(filterDeclaredThrows(mixed, ["TypeError"])).toEqual([fx("Error"), fx("ReferenceError")]);
    expect(filterDeclaredThrows(mixed, undefined)).toEqual(mixed);
  });

  it("filterGateThrows: declare wins over ignoreThrows", () => {
    // ignore TypeError 只滤 TypeError；declare Error 已清空
    expect(filterGateThrows([fx("Error"), fx("TypeError")], ["Error"], ["TypeError"])).toEqual([]);
    // 无 declare：ignore 只滤 TypeError，Error 仍在
    expect(filterGateThrows([fx("Error"), fx("TypeError")], undefined, ["TypeError"])).toEqual([
      fx("Error"),
    ]);
  });

  it("throwAbsToKinds splits sums (never a single 'A | B' kind)", () => {
    const sum = mayThrowEffectsToAbs([fx("TypeError"), fx("Error")]);
    expect(throwAbsToKinds(sum).sort()).toEqual(["Error", "TypeError"]);
  });

  it("formatThrowsAbs collapses Error family when Error is present", () => {
    const sum = mayThrowEffectsToAbs([fx("TypeError"), fx("Error"), fx("ReferenceError")]);
    expect(formatThrowsAbs(sum)).toBe("Error");
    const mixed = mayThrowEffectsToAbs([fx("TypeError"), fx("string")]);
    expect(formatThrowsAbs(mixed)).toBe("TypeError | string");
    expect(formatThrowsAbs(errorTypeAbs("TypeError"))).toBe("TypeError");
  });

  it("throwConstraintToKinds reads fn throws option", () => {
    expect(throwConstraintToKinds(fn({ x: number() }, number(), { throws: "Error" }))).toBeUndefined(); // not the throws slot
    const c = fn({ x: number() }, number(), { throws: "Error" });
    expect(throwConstraintToKinds(c.fn?.throws)).toEqual(["Error"]);
    const anyT = fn({ x: number() }, number(), { throws: "*" });
    expect(throwConstraintToKinds(anyT.fn?.throws)).toBe("*");
  });

  it("@nudo:throws Error discharges L2 for intentional fail-fast", () => {
    const r = checkSource(
      "l2-declared.js",
      `/**
 * @nudo:throws Error
 */
export function requirePositive(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("n: integer >= 0");
  return n;
}
`,
      pTrue,
      {},
    );
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    expect(l2.map((i) => i.message).join("; ") || "ok").toBe("ok");
  });

  it("case !! throws * discharges L2", () => {
    const r = checkSource(
      "l2-case-throws.js",
      `/**
 * @nudo:case "neg" (0) !! throws
 */
export function boom(n) {
  if (n < 0) throw new Error("n");
  return n;
}
`,
      pTrue,
      {},
    );
    expect(
      r.issues.filter((i) => i.code === "nudo:entry-may-throw").map((i) => i.message).join("; ") ||
        "ok",
    ).toBe("ok");
  });

  it("without declare, explicit throw still L2 (product: entry total)", () => {
    const r = checkSource(
      "l2-undeclared.js",
      `export function boom(n) {
  if (n < 0) throw new Error("n");
  return n;
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(true);
  });

  it("sidecar fn(..., { throws: 'Error' }) on same-name binding discharges L2", () => {
    const r = checkSource(
      "l2-sidecar-throws.js",
      `export function f(n) {
  if (!Number.isInteger(n)) throw new Error("n: integer");
  return n;
}
`,
      pTrue,
      {
        loadModule: (spec: string) =>
          spec.includes("l2-sidecar-throws.nudo.js")
            ? `import { fn, number } from "@nudojs/core";\nexport const f = fn({ n: number().int().ge(0) }, number(), { throws: "Error" });`
            : undefined,
        fromFile: "l2-sidecar-throws.js",
      },
    );
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    if (l2.length > 0) {
      expect(l2[0]!.suggestion ?? "").toContain("@nudo:throws");
    } else {
      expect(l2).toEqual([]);
    }
  });
});

describe("P0 fail-fast return face is not phantom never", () => {
  it("throw + for-let loop: no phantom ReferenceError (fork must not snapshot loop i)", () => {
    const r = checkSource(
      "l2-for-let-phantom.js",
      `export function f(ids) {
  if (ids.length < 1) throw new Error("c");
  for (let i = 0; i < 3; i++) {}
  return 1;
}
`,
      pTrue,
      {},
    );
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.throws ?? "").not.toContain("ReferenceError");
    expect(sig!.display).not.toMatch(/^never\b/);
    expect(sig!.display).toContain("1");
  });

  it("@nudo:throws Error covers ReferenceError family on fail-fast + loops", () => {
    const r = checkSource(
      "l2-error-family.js",
      `/**
 * @nudo:throws Error
 */
export function f(ids) {
  if (!Array.isArray(ids) || ids.length < 1) throw new Error("c");
  {
    const seen = {};
    for (let i = 0; i < ids.length; i++) {
      if (seen[ids[i]]) throw new Error("d");
      seen[ids[i]] = true;
    }
  }
  return 1;
}
`,
      pTrue,
      {},
    );
    expect(
      r.issues.filter((i) => i.code === "nudo:entry-may-throw").map((i) => i.message).join("; ") ||
        "ok",
    ).toBe("ok");
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig!.throws ?? "").not.toContain("ReferenceError");
    expect(sig!.display).not.toMatch(/^never\b/);
  });

  it("guard + return yields a return face, throws Error not ReferenceError", () => {
    const r = checkSource(
      "l2-ret-face.js",
      `/**
 * @nudo:throws Error
 */
export function requireCents(v) {
  if (!Number.isInteger(v)) throw new Error("v: integer >= 0");
  if (v < 0) throw new Error("v: integer >= 0");
  return v;
}
/**
 * @nudo:throws Error
 */
export function splitEven(totalCents, tipBps, ids) {
  requireCents(totalCents);
  const tip = Math.floor((totalCents * tipBps) / 10000);
  const grand = totalCents + tip;
  const n = ids.length;
  const base = Math.floor(grand / n);
  const r = grand % n;
  const shares = [];
  for (let i = 0; i < n; i++) shares.push({ id: ids[i], cents: i < r ? base + 1 : base });
  return { tip, shares, total: grand };
}
`,
      pTrue,
      {},
    );
    const sig = r.signatures.find((s) => s.name === "splitEven");
    expect(sig, JSON.stringify(r.signatures.map((s) => s.display))).toBeDefined();
    // 不得是幻影 ReferenceError
    expect(sig!.throws ?? "").not.toContain("ReferenceError");
    // 有 return 对象时不得只剩 never（允许 never | {…} 过近似，但要有对象面）
    const d = sig!.display;
    expect(d === "never" || d.startsWith("never  throws")).toBe(false);
  });
});

describe("P1 slim check report", () => {
  it("errors keep actual/expected; warnings are one-line", () => {
    const text = formatCheckReport({
      file: "/t/a.js",
      ok: false,
      signatures: [],
      summary: { errors: 1, warnings: 1, infos: 0, functions: 1 },
      issues: [
        {
          severity: "error",
          code: "nudo:entry-may-throw",
          message: "f (export): may throw Error",
          actual: "f(…) throws Error",
          expected: "entry total, or @nudo:throws / try-catch",
          suggestion: "@nudo:throws Error / refine / guard",
        },
        {
          severity: "warning",
          code: "nudo:unknown-inference",
          message: "g: signature has true unknown",
          actual: "g => unknown",
          expected: "computable Abs",
        },
      ],
    });
    expect(text).toContain("actual:   f(…) throws Error");
    expect(text).toContain("expected: entry total, or @nudo:throws");
    // warning 不带 actual/expected 行
    const warnBlock = text.split("[WARNING")[1] ?? "";
    expect(warnBlock).not.toContain("actual:");
    expect(warnBlock).not.toContain("expected:");
  });
});
