import { describe, it, expect, beforeEach } from "vitest";
import {
  canSkipLiteralCallScan,
  generalizeFromAst,
  resetGeneralizeMemo,
  getGeneralizeMemoSize,
  parseSource,
} from "../index.ts";

const BASE = `
function alpha(x) {
  return x + 1;
}
function beta(y) {
  return y * 2;
}
function gamma(z) {
  return alpha(z) + beta(z);
}
`;

beforeEach(() => {
  resetGeneralizeMemo();
});

describe("per-function L0 fingerprints", () => {
  it("editing one independent function does not miss another", () => {
    const file0 = parseSource(BASE);
    const a0 = generalizeFromAst("alpha", BASE, { file: file0 });
    const b0 = generalizeFromAst("beta", BASE, { file: file0 });
    expect(a0).toBeDefined();
    expect(b0).toBeDefined();

    const edited = BASE.replace("return y * 2;", "return y * 3;");
    const file1 = parseSource(edited);
    // beta changed -> new PolyFn
    const b1 = generalizeFromAst("beta", edited, { file: file1 });
    expect(b1).toBeDefined();
    expect(b1).not.toBe(b0);
    // alpha unchanged and does not reference beta -> same instance
    const a1 = generalizeFromAst("alpha", edited, { file: file1 });
    expect(a1).toBe(a0);
  });

  it("caller misses when callee body changes", () => {
    const file0 = parseSource(BASE);
    const g0 = generalizeFromAst("gamma", BASE, { file: file0 });
    const a0 = generalizeFromAst("alpha", BASE, { file: file0 });

    const edited = BASE.replace("return x + 1;", "return x + 10;");
    const file1 = parseSource(edited);
    const a1 = generalizeFromAst("alpha", edited, { file: file1 });
    const g1 = generalizeFromAst("gamma", edited, { file: file1 });
    expect(a1).not.toBe(a0);
    expect(g1).not.toBe(g0);
  });

  it("top-level non-function context change misses all", () => {
    const src = `const K = 1;\nfunction alpha(x) { return x + K; }\nfunction beta(y) { return y; }\n`;
    const file0 = parseSource(src);
    const a0 = generalizeFromAst("alpha", src, { file: file0 });
    const b0 = generalizeFromAst("beta", src, { file: file0 });

    const edited = `const K = 2;\nfunction alpha(x) { return x + K; }\nfunction beta(y) { return y; }\n`;
    const file1 = parseSource(edited);
    const a1 = generalizeFromAst("alpha", edited, { file: file1 });
    const b1 = generalizeFromAst("beta", edited, { file: file1 });
    expect(a1).not.toBe(a0);
    expect(b1).not.toBe(b0);
  });

  it("without file AST falls back to whole-source key", () => {
    const a0 = generalizeFromAst("alpha", BASE);
    const edited = BASE.replace("return y * 2;", "return y * 3;");
    const a1 = generalizeFromAst("alpha", edited);
    // no file -> whole source hash, alpha misses too
    expect(a1).not.toBe(a0);
  });

  it("refine leading comments are part of own slice", () => {
    const src1 = `
/**
 * @nudo:case "c" (1)
 */
function f(x) { return x + 1; }
`;
    const src2 = `
/**
 * @nudo:case "c" (2)
 */
function f(x) { return x + 1; }
`;
    const g1 = generalizeFromAst("f", src1, { file: parseSource(src1) });
    const g2 = generalizeFromAst("f", src2, { file: parseSource(src2) });
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
  });

  it("memo size grows with distinct fingerprints only", () => {
    const file = parseSource(BASE);
    generalizeFromAst("alpha", BASE, { file });
    generalizeFromAst("beta", BASE, { file });
    const n = getGeneralizeMemoSize();
    generalizeFromAst("alpha", BASE, { file });
    expect(getGeneralizeMemoSize()).toBe(n);
  });

  it("default-param sibling reference dirties caller L0", () => {
    const src1 = `
function helper() { return 1; }
function f(a = helper()) { return a; }
`;
    const src2 = `
function helper() { return 2; }
function f(a = helper()) { return a; }
`;
    const g1 = generalizeFromAst("f", src1, { file: parseSource(src1) });
    const g2 = generalizeFromAst("f", src2, { file: parseSource(src2) });
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
  });

  it("multi-declarator leading refine comment is part of own slice", () => {
    const src1 = `
const f = (x) => x,
  /**
   * @nudo:case "c" (1)
   */
  g = (y) => y + 1;
`;
    const src2 = `
const f = (x) => x,
  /**
   * @nudo:case "c" (2)
   */
  g = (y) => y + 1;
`;
    const g1 = generalizeFromAst("g", src1, { file: parseSource(src1) });
    const g2 = generalizeFromAst("g", src2, { file: parseSource(src2) });
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    expect(g2).not.toBe(g1);
  });
});

describe("canSkipLiteralCallScan depth cap", () => {
  it("does not skip when a call sits below the walk depth cap", () => {
    // 90 nested arrays push the CallExpression past hasAnyCallLike's depth>80
    // cut-off. Unexplored subtrees must be treated as "may contain a call".
    let nest = "f(-1)";
    for (let i = 0; i < 90; i++) nest = `[${nest}]`;
    const src = `const x = ${nest};\n`;
    const file = parseSource(src);
    expect(canSkipLiteralCallScan(src, file)).toBe(false);
  });

  it("still skips shallow call-free sources", () => {
    const src = `function id(x) { return x + 1; }\nconst y = id(2);\n`;
    // id(2) is a CallExpression — must NOT skip
    expect(canSkipLiteralCallScan(src, parseSource(src))).toBe(false);
    const pure = `const y = 1 + 2;\nfunction id(x) { return x + 1; }\n`;
    expect(canSkipLiteralCallScan(pure, parseSource(pure))).toBe(true);
  });
});
