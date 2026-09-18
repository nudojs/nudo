import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";
import { formatAbs } from "@nudojs/core";

/** C2.3：调用点上的 == / != 字面量 Abstract Equality 折叠 */
describe("loose equality folding (C2.3)", () => {
  it("folds 5==5, 5=='5', 0==false, null==undefined; 0=='x' is false", () => {
    const src = `
function f() {
  const a = 5 == 5;
  const b = 5 == "5";
  const c = 0 == false;
  const d = null == undefined;
  const e = 0 == "x";
  return [a, b, c, d, e];
}
f();
`;
    const r = analyzeFile("eq.js", src);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const fn = r.functions.find((f) => f.name === "f");
    expect(fn).toBeDefined();
    const call = fn!.cases?.find((c) => String(c.name ?? "").startsWith("call@"));
    expect(call).toBeDefined();
    const text = formatAbs(call!.abs);
    expect(text).toContain("true");
    expect(text).toContain("false");
  });

  it("!=' folds negation", () => {
    const src = `
function g() {
  return 1 != "1";
}
g();
`;
    const r = analyzeFile("ne.js", src);
    const fn = r.functions.find((f) => f.name === "g");
    const call = fn!.cases?.find((c) => String(c.name ?? "").startsWith("call@"));
    const text = formatAbs(call!.abs);
    expect(text).toContain("false");
  });
});
