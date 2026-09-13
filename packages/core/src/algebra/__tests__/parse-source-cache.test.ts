import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSource,
  resetParseSourceCache,
  getParseSourceCacheSize,
} from "../index.ts";

const SRC = "function add(a, b) { return a + b; }\n";

beforeEach(() => {
  resetParseSourceCache();
});

describe("parseSource AST LRU", () => {
  it("returns same File for identical source", () => {
    const a = parseSource(SRC);
    const b = parseSource(SRC);
    expect(b).toBe(a);
    expect(getParseSourceCacheSize()).toBe(1);
  });

  it("misses when source changes", () => {
    const a = parseSource(SRC);
    const b = parseSource(SRC + "\n// t\n");
    expect(b).not.toBe(a);
    expect(getParseSourceCacheSize()).toBe(2);
  });

  it("does not cache errorRecovery parses", () => {
    parseSource(SRC, { errorRecovery: true });
    expect(getParseSourceCacheSize()).toBe(0);
    parseSource(SRC);
    expect(getParseSourceCacheSize()).toBe(1);
  });

  it("LRU evicts oldest beyond cap", () => {
    for (let i = 0; i < 20; i++) {
      parseSource(`${SRC}// ${i}\n`);
    }
    expect(getParseSourceCacheSize()).toBeLessThanOrEqual(16);
  });
});
