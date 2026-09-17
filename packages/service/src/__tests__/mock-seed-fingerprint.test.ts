import { describe, it, expect } from "vitest";
import { numLit, unknown } from "@nudojs/core";
import { parseCaseArgExpr } from "@nudojs/parser";
import { mockSeedFingerprint } from "../bpath-run.ts";
import { mockDirectivesToAbsSeeds } from "../mock-abs.ts";

describe("mockSeedFingerprint", () => {
  it("misses when mock values change under the same names", () => {
    const a = mockSeedFingerprint({ fetch: numLit(1) });
    const b = mockSeedFingerprint({ fetch: numLit(2) });
    expect(a).not.toBe(b);
  });

  it("hits for identical name+value sets regardless of key order", () => {
    const a = mockSeedFingerprint({ x: numLit(1), y: unknown });
    const b = mockSeedFingerprint({ y: unknown, x: numLit(1) });
    expect(a).toBe(b);
  });

  it("empty and missing mocks share the dash key", () => {
    expect(mockSeedFingerprint(undefined)).toBe("-");
    expect(mockSeedFingerprint({})).toBe("-");
  });

  it("misses when real sinon.stub().returns value changes", () => {
    const seeds1 = mockDirectivesToAbsSeeds([
      {
        directives: [
          {
            kind: "mock",
            name: "fetch",
            sinonExpr: { type: "sinon.stub", returnValue: parseCaseArgExpr("1").abs },
          } as never,
        ],
      },
    ]);
    const seeds2 = mockDirectivesToAbsSeeds([
      {
        directives: [
          {
            kind: "mock",
            name: "fetch",
            sinonExpr: { type: "sinon.stub", returnValue: parseCaseArgExpr("2").abs },
          } as never,
        ],
      },
    ]);
    const a = mockSeedFingerprint(seeds1.seedVars, seeds1.seedFns);
    const b = mockSeedFingerprint(seeds2.seedVars, seeds2.seedFns);
    expect(a).not.toBe(b);
  });

  it("includes seedFns in the fingerprint", () => {
    const a = mockSeedFingerprint(
      {},
      { load: { params: ["x"], body: { type: "Identifier", name: "x" } as never } },
    );
    const b = mockSeedFingerprint(
      {},
      { load: { params: ["y"], body: { type: "Identifier", name: "y" } as never } },
    );
    expect(a).not.toBe(b);
  });
});