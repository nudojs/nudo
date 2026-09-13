import { describe, it, expect } from "vitest";
import { numLit, unknown } from "@nudojs/core";
import { mockSeedFingerprint } from "../bpath-run.ts";

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
});
