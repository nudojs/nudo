import { describe, it, expect, beforeEach } from "vitest";
import { generalizeFromAst, resetGeneralizeMemo, parseSource } from "../index.ts";
import { fnFingerprints } from "../../internal.ts";

const SRC = `const a = (x) => x, b = (x) => x + 1;
function gamma(x) { return b(x); }
`;

beforeEach(() => {
  resetGeneralizeMemo();
});

describe("multi-declarator fingerprints", () => {
  it("indexes every function declarator", () => {
    const fps = fnFingerprints(SRC, parseSource(SRC));
    expect([...fps.keys()].sort()).toEqual(["a", "b", "gamma"]);
  });

  it("caller misses L0 when callee in same declarator statement changes", () => {
    const f0 = parseSource(SRC);
    const g0 = generalizeFromAst("gamma", SRC, { file: f0 });
    expect(g0).toBeDefined();

    const edited = SRC.replace("b = (x) => x + 1", "b = (x) => x + 10");
    const f1 = parseSource(edited);
    const g1 = generalizeFromAst("gamma", edited, { file: f1 });
    expect(g1).not.toBe(g0);
  });

  it("independent sibling in same statement does not dirty the other's callers", () => {
    const f0 = parseSource(SRC);
    const a0 = generalizeFromAst("a", SRC, { file: f0 });
    const g0 = generalizeFromAst("gamma", SRC, { file: f0 });
    expect(a0).toBeDefined();
    expect(g0).toBeDefined();

    // Only a changes; gamma calls b — a's own-slice must not drag gamma.
    const edited = SRC.replace("a = (x) => x", "a = (x) => x + 100");
    const f1 = parseSource(edited);
    const a1 = generalizeFromAst("a", edited, { file: f1 });
    const g1 = generalizeFromAst("gamma", edited, { file: f1 });
    expect(a1).not.toBe(a0);
    expect(g1).toBe(g0);
  });
});
