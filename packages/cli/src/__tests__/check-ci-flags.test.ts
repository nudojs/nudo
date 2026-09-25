/**
 * check 缓存 / CI 注解决策纯函数。
 */
import { describe, it, expect } from "vitest";
import {
  shouldComputeCacheKey,
  shouldEmitGha,
  shouldPrintDocsLinks,
  shouldUseDiskCache,
} from "../check-ci-flags.ts";

describe("shouldEmitGha", () => {
  it("explicit true forces on", () => {
    expect(shouldEmitGha(true, undefined)).toBe(true);
    expect(shouldEmitGha(true, "false")).toBe(true);
    expect(shouldEmitGha(true, "true")).toBe(true);
  });

  it("explicit false forces off even in GHA env", () => {
    expect(shouldEmitGha(false, "true")).toBe(false);
    expect(shouldEmitGha(false, undefined)).toBe(false);
  });

  it("undefined follows env", () => {
    expect(shouldEmitGha(undefined, "true")).toBe(true);
    expect(shouldEmitGha(undefined, "false")).toBe(false);
    expect(shouldEmitGha(undefined, undefined)).toBe(false);
    expect(shouldEmitGha(undefined, "TRUE")).toBe(false);
  });
});

describe("shouldUseDiskCache", () => {
  const base = {
    diskEnabled: true,
    hasFrom: false,
    depTruncated: false,
    hasBareMiss: false,
  };

  it("all clear → true", () => {
    expect(shouldUseDiskCache(base)).toBe(true);
  });

  it.each([
    ["diskEnabled", { diskEnabled: false }],
    ["hasFrom", { hasFrom: true }],
    ["depTruncated", { depTruncated: true }],
    ["hasBareMiss", { hasBareMiss: true }],
  ] as const)("blocked by %s", (_k, over) => {
    expect(shouldUseDiskCache({ ...base, ...over })).toBe(false);
  });

  it("multiple blockers still false", () => {
    expect(
      shouldUseDiskCache({
        diskEnabled: true,
        hasFrom: true,
        depTruncated: true,
        hasBareMiss: true,
      }),
    ).toBe(false);
  });
});

describe("shouldComputeCacheKey", () => {
  it("useDisk alone → true", () => {
    expect(shouldComputeCacheKey({ useDisk: true })).toBe(true);
  });

  it("verbose or abs blocks", () => {
    expect(shouldComputeCacheKey({ useDisk: true, verbose: true })).toBe(false);
    expect(shouldComputeCacheKey({ useDisk: true, abs: true })).toBe(false);
    expect(shouldComputeCacheKey({ useDisk: true, verbose: false, abs: false })).toBe(true);
  });

  it("useDisk false → false regardless", () => {
    expect(shouldComputeCacheKey({ useDisk: false })).toBe(false);
    expect(shouldComputeCacheKey({ useDisk: false, verbose: true })).toBe(false);
  });
});

describe("shouldPrintDocsLinks", () => {
  const base = { issueCount: 1, reportOk: false };

  it("terminal with issues → true", () => {
    expect(shouldPrintDocsLinks({ ...base, json: false })).toBe(true);
    expect(shouldPrintDocsLinks({ ...base })).toBe(true);
  });

  it("json suppresses", () => {
    expect(shouldPrintDocsLinks({ ...base, json: true })).toBe(false);
  });

  it("no issues suppresses", () => {
    expect(shouldPrintDocsLinks({ issueCount: 0, reportOk: false })).toBe(false);
  });

  it("abs ok suppresses; abs failed prints", () => {
    expect(shouldPrintDocsLinks({ abs: true, issueCount: 1, reportOk: true })).toBe(false);
    expect(shouldPrintDocsLinks({ abs: true, issueCount: 1, reportOk: false })).toBe(true);
  });
});
