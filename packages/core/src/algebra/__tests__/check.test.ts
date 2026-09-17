import { describe, it, expect } from "vitest";
import { checkSource, formatCheckReport, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

describe("nudo check gate", () => {
  it("literal call violating constraint is error", () => {
    // @nudo:refine 声明契约；调用 -1 应报错
    const src = `
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const r = needsPositive(-1);
`;
    const report = checkSource("t.js", withStdImport(src), pTrue, stdOpts);
    expect(report.ok).toBe(false);
    const err = report.issues.find((i) => i.severity === "error");
    expect(err).toBeDefined();
    expect(err!.code).toBe("nudo:constraint-violated");
  });

  it("valid literal call is ok", () => {
    const src = `
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const r = needsPositive(5);
`;
    const report = checkSource("t.js", withStdImport(src), pTrue, stdOpts);
    expect(report.ok).toBe(true);
    expect(report.signatures.some((f) => f.name === "needsPositive")).toBe(true);
  });

  it("reports intensional signatures", () => {
    const src = `
function add(a, b) { return a + b; }
function scale(x) { return add(x, 1); }
`;
    const report = checkSource("t.js", withStdImport(src), pTrue, stdOpts);
    const scale = report.signatures.find((f) => f.name === "scale");
    expect(scale!.display).toContain("A1");
  });

  it("formatCheckReport is Nudo-native (signatures + issues)", () => {
    const bad = checkSource(
      "t.js",
      withStdImport(`/**
 * @nudo:refine x positive
 */
function f(x){ if (x>0) return x; return 0; }
f(-1);
`),
      pTrue,
      stdOpts,
    );
    const text = formatCheckReport(bad);
    expect(text).toContain("FAILED");
    expect(text).toContain("signatures");
    expect(text).toContain("actual:");
    expect(text).toContain("expected:");
  });

  it("formatCheckReport default omits term/pred/conf detail (D2)", () => {
    const ok = checkSource(
      "t.js",
      withStdImport(`/**
 * @nudo:refine x positive
 */
function f(x){ if (x>0) return x; return 0; }
f(1);
`),
      pTrue,
      stdOpts,
    );
    const text = formatCheckReport(ok);
    expect(text).toContain("OK");
    expect(text).toContain("signatures");
    expect(text).not.toContain("term:");
    const verbose = formatCheckReport(ok, { verbose: true });
    expect(verbose).toContain("term:");
  });
});

describe("nudo check gate: real-world regression (slots prototype leak / guarded access)", () => {
  it("__proto__ member on brand instance must not crash (slots['__proto__'] hits Object.prototype)", () => {
    const r = checkSource(
      "proto-brand",
      "function Events() {}\nvar prefix = '~';\nif (Object.create) {\n  if (!new Events().__proto__) prefix = false;\n}",
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("object literal member named toString/valueOf must not read through the prototype chain", () => {
    const r = checkSource("proto-obj", "var o = {};\nfunction f(x) { return x.toString ? 1 : 0; }\nf(o);");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("guarded param access (x && x.__esModule && x.default) is not a required slot", () => {
    const r = checkSource(
      "cjs-helper",
      'function getDefaultExportFromCjs(x) { return x && x.__esModule && x.default ? x.default : x; }\nvar ee = { exports: {} };\nvar mod = getDefaultExportFromCjs(ee.exports);',
    );
    expect(r.issues.filter((i) => i.severity === "error" && i.code === "nudo:arg-structure")).toEqual([]);
  });

  it("unconditional scalar retype still violates (gold assign-prim-mismatch), branch retype does not", () => {
    const unconditional = checkSource("prim", 'let n = 1;\nn = "str";');
    expect(unconditional.issues.some((i) => i.code === "nudo:assign-mismatch")).toBe(true);
    const conditional = checkSource("prim-if", 'let n = 1;\nif (Object.create) { n = "str"; }');
    expect(conditional.issues.some((i) => i.code === "nudo:assign-mismatch")).toBe(false);
  });
});
