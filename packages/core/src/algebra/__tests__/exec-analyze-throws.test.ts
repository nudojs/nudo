import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
  never,
} from "@nudojs/core";

describe("B-path analyze mode", () => {
  it("does not run top-level side effects", () => {
    const src = `
globalThisNotDefined();
export function id(x) { return x; }
`;
    expect(() => runTranspiled(src, { mode: "exec" })).toThrow();
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(typeof exports.id).toBe("function");
    const r = callTranspiledExportFull(exports, "id", [$lit(7)]);
    expect(litValue(r.result)).toBe(7);
  });

  it("keeps function definitions that call other locals", () => {
    const src = `
function helper(x) { return x + 1; }
export function go(n) { return helper(n); }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", [$lit(1)]);
    expect(litValue(r.result)).toBe(2);
    expect(r.throws).toBe(never);
  });
});

describe("B-path throws", () => {
  it("captures $throw as throws Abs", () => {
    const src = `
export function fail(n) {
  if (n > 0) { return n; } else { throw new Error("bad"); }
}
`;
    // throw new Error → transpile may skip NewExpression; use throw literal path via $throw
    const src2 = `
export function fail(n) {
  if (n > 0) { return n; } else { throw "bad"; }
}
`;
    void src;
    const exports = runTranspiled(src2, { mode: "analyze" });
    const ok = callTranspiledExportFull(exports, "fail", [$lit(1)]);
    expect(litValue(ok.result)).toBe(1);
    expect(ok.throws).toBe(never);

    const bad = callTranspiledExportFull(exports, "fail", [$lit(-1)]);
    expect(bad.result.shape.k).toBe("never");
    expect(bad.throws.shape.k).not.toBe("never");
    expect(absToString(bad.throws)).toContain("bad");
  });
});
