import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
  transpile,
} from "@nudojs/core";

describe("B-path try/catch", () => {
  it("catches $throw and binds Abs value", () => {
    const src = `
export function go(n) {
  try {
    if (n > 0) {
      return n;
    } else {
      throw "neg";
    }
  } catch (e) {
    return e;
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const ok = callTranspiledExportFull(exports, "go", [$lit(3)]);
    expect(litValue(ok.result)).toBe(3);
    expect(ok.throws.shape.k).toBe("never");

    const bad = callTranspiledExportFull(exports, "go", [$lit(-1)]);
    expect(litValue(bad.result)).toBe("neg");
  });

  it("finally runs after catch", () => {
    const src = `
export function go() {
  let t = 0;
  try {
    throw "x";
  } catch (e) {
    t = 1;
  } finally {
    t = t + 10;
  }
  return t;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(11);
  });

  it("uncaught throw still reports throws", () => {
    const src = `
export function go() {
  throw "boom";
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(r.result.shape.k).toBe("never");
    expect(absToString(r.throws)).toContain("boom");
  });

  it("transpiles try/catch", () => {
    const out = transpile(`export function f() { try { return 1; } catch (e) { return 0; } }`);
    expect(out).toContain("try {");
    expect(out).toContain("$catchVal(");
  });
});
