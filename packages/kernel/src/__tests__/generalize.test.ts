import { describe, it, expect } from "vitest";
import {
  generalizeFromAst,
  generalizeAll,
  numLit,
  numVar,
  gtNum,
  v,
  litValue,
  termToString,
  formatAbs,
} from "../index.ts";

const SRC = `
const add = (a, b) => a + b;
function scale(x) {
  return add(x, 1);
}
function twice(x) {
  const c = add(x, 1);
  return add(c, 1);
}
function id(x) { return x; }
function pair(a, b) { return { a, b }; }
`;

describe("generalize", () => {
  it("scale generalizes to term = A1+1", () => {
    const g = generalizeFromAst("scale", SRC);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.params).toEqual(["x"]);
    expect(g.typeParams.length).toBe(1);
    expect(g.symbolic.term).toBeDefined();
    expect(termToString(g.symbolic.term!)).toBe("(A1 + 1)");
  });

  it("instantiate scale with x>0 gives (x+1)>1", () => {
    const g = generalizeFromAst("scale", SRC);
    expect(g).toBeDefined();
    if (!g) return;
    const phi = gtNum(v("x"), 0);
    const r = g.instantiate([numVar("x", gtNum(v("x"), 0))], phi);
    expect(termToString(r.term!)).toBe("(x + 1)");
    expect(r.pred!.op).toBe("gt");
  });

  it("instantiate scale with literal 5 gives 6", () => {
    const g = generalizeFromAst("scale", SRC);
    if (!g) return;
    const r = g.instantiate([numLit(5)]);
    expect(litValue(r)).toBe(6);
    expect(r.conf).toBe("exact");
  });

  it("id is identity: term stays A1", () => {
    const g = generalizeFromAst("id", SRC);
    if (!g) return;
    expect(g.symbolic.term?.op).toBe("var");
    if (g.symbolic.term?.op === "var") {
      expect(g.symbolic.term.id).toBe("A1");
    }
  });

  it("twice nests to (A1+1)+1", () => {
    const g = generalizeFromAst("twice", SRC);
    if (!g) return;
    const ts = termToString(g.symbolic.term!);
    expect(ts === "((A1 + 1) + 1)" || ts === "(A1 + 2)").toBe(true);
  });

  it("generalizeAll finds all functions", () => {
    const all = generalizeAll(SRC);
    const names = all.map((g) => g.name).sort();
    expect(names).toContain("add");
    expect(names).toContain("scale");
    expect(names).toContain("twice");
    expect(names).toContain("id");
  });

  it("display mentions type params", () => {
    const g = generalizeFromAst("scale", SRC);
    if (!g) return;
    expect(g.display).toContain("scale");
    expect(g.display).toContain("A1");
  });
});
