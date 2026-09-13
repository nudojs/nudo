import { describe, it, expect } from "vitest";
import { hashSource, resetHashSourceCache } from "../hash-source.ts";

describe("hashSource", () => {
  it("is stable for identical input and differs on length/content", () => {
    resetHashSourceCache();
    const a = hashSource("hello world");
    expect(hashSource("hello world")).toBe(a);
    expect(hashSource("hello world!")).not.toBe(a);
    // pure 32-bit FNV can collide on crafted pairs; length+second mix should not
    expect(hashSource("a")).not.toBe(hashSource("b"));
  });

  it("includes length so truncated prefixes do not alias", () => {
    resetHashSourceCache();
    // classic FNV pitfalls often involve short suffixes; length disambiguates
    expect(hashSource("abc")).not.toBe(hashSource("abcabc"));
  });
});
