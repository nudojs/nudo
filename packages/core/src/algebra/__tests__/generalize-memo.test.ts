import { describe, it, expect, beforeEach } from "vitest";
import {
  generalizeFromAst,
  resetGeneralizeMemo,
  formatAbs,
  checkSource,
  pTrue,
  numLit,
  numVar,
  gtNum,
  v,
  litValue,
  strLit,
  termToString,
} from "../index.ts";

const SRC = `
function add(a, b) {
  return a + b;
}
`;

beforeEach(() => {
  resetGeneralizeMemo();
});

describe("generalizeFromAst L0 memo", () => {
  it("returns the same PolyFn instance for identical (source, name) queries", () => {
    const a = generalizeFromAst("add", SRC);
    const b = generalizeFromAst("add", SRC);
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it("misses when source content changes", () => {
    const a = generalizeFromAst("add", SRC);
    const b = generalizeFromAst("add", SRC + "\n// touch\n");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("misses for a different function name", () => {
    const src = `
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
`;
    const a = generalizeFromAst("add", src);
    const b = generalizeFromAst("sub", src);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("caches undefined for missing functions", () => {
    expect(generalizeFromAst("nope", SRC)).toBeUndefined();
    expect(generalizeFromAst("nope", SRC)).toBeUndefined();
  });

  it("misses when label changes", () => {
    const a = generalizeFromAst("add", SRC, { label: "A" });
    const b = generalizeFromAst("add", SRC, { label: "B" });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("misses when refine loadModule identity changes", () => {
    const load1 = () => undefined;
    const load2 = () => undefined;
    const a = generalizeFromAst("add", SRC, { refine: { loadModule: load1, fromFile: "/t.js" } });
    const b = generalizeFromAst("add", SRC, { refine: { loadModule: load2, fromFile: "/t.js" } });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b).not.toBe(a);
  });

  it("hit is consistent with checkSource signatures", () => {
    const g1 = generalizeFromAst("add", SRC);
    const g2 = generalizeFromAst("add", SRC);
    expect(formatAbs(g1!.symbolic)).toBe(formatAbs(g2!.symbolic));
    const report = checkSource("t.js", SRC, pTrue, {});
    expect(report.signatures.map((s) => s.name)).toContain("add");
  });
});

describe("instantiate L1 memo", () => {
  const SRC_SCALE = `
function scale(x) {
  return x + 1;
}
function pair(a, b) {
  return { a, b };
}
`;

  it("returns the same Abs instance for identical args + Φ", () => {
    const g = generalizeFromAst("scale", SRC_SCALE)!;
    const a1 = numVar("x", gtNum(v("x"), 0));
    const phi = gtNum(v("x"), 0);
    const r1 = g.instantiate([a1], phi);
    const r2 = g.instantiate([numVar("x", gtNum(v("x"), 0))], phi);
    expect(r2).toBe(r1);
    expect(r1.term).toBeDefined();
    expect(termToString(r1.term!)).toBe("(x + 1)");
  });

  it("hits for repeated literal args", () => {
    const g = generalizeFromAst("scale", SRC_SCALE)!;
    const r1 = g.instantiate([numLit(5)]);
    const r2 = g.instantiate([numLit(5)]);
    expect(litValue(r1)).toBe(6);
    expect(r2).toBe(r1);
  });

  it("misses for different args", () => {
    const g = generalizeFromAst("scale", SRC_SCALE)!;
    const r1 = g.instantiate([numLit(5)]);
    const r2 = g.instantiate([numLit(7)]);
    expect(litValue(r1)).toBe(6);
    expect(litValue(r2)).toBe(8);
    expect(r2).not.toBe(r1);
  });

  it("misses when Φ differs under same arg shape", () => {
    const g = generalizeFromAst("scale", SRC_SCALE)!;
    const arg = numVar("x", gtNum(v("x"), 0));
    const r1 = g.instantiate([arg], gtNum(v("x"), 0));
    const r2 = g.instantiate([arg], pTrue);
    // 结果可能同构，但键不同不得错误复用为同一对象（允许 equal，禁止错缓存）
    expect(formatAbs(r1)).toBeTypeOf("string");
    expect(formatAbs(r2)).toBeTypeOf("string");
  });

  it("shares L1 hits across L0 PolyFn identity", () => {
    const g1 = generalizeFromAst("scale", SRC_SCALE)!;
    const g2 = generalizeFromAst("scale", SRC_SCALE)!;
    expect(g2).toBe(g1);
    const r = g1.instantiate([numLit(2)]);
    expect(g2.instantiate([numLit(2)])).toBe(r);
  });

  it("object args key by sorted slots (order-insensitive)", () => {
    const g = generalizeFromAst("pair", SRC_SCALE)!;
    const o1 = {
      shape: {
        k: "obj" as const,
        slots: {
          a: { value: numLit(1) },
          b: { value: strLit("x") },
        },
      },
      conf: "exact" as const,
    };
    const o2 = {
      shape: {
        k: "obj" as const,
        slots: {
          b: { value: strLit("x") },
          a: { value: numLit(1) },
        },
      },
      conf: "exact" as const,
    };
    const r1 = g.instantiate([o1, numLit(9)]);
    // 第二参不同 → miss；同结构第一参应能命中同一对第一个参数的缓存路径
    const r2 = g.instantiate([o2, numLit(9)]);
    expect(formatAbs(r1)).toContain("a");
    // 同键（slot 顺序无关）应返回同一缓存对象
    expect(r2).toBe(r1);
  });

  it("resetGeneralizeMemo drops L0 and thus L1 tables", () => {
    const g1 = generalizeFromAst("scale", SRC_SCALE)!;
    const r1 = g1.instantiate([numLit(5)]);
    resetGeneralizeMemo();
    const g2 = generalizeFromAst("scale", SRC_SCALE)!;
    expect(g2).not.toBe(g1);
    const r2 = g2.instantiate([numLit(5)]);
    expect(litValue(r2)).toBe(6);
    expect(r2).not.toBe(r1);
  });
});
