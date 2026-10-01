import { describe, it, expect } from "vitest";
import { collectEvalDiagnostics } from "@nudojs/service";

describe("evaluator static diagnostics", () => {
  it("marks statements after return as unreachable", () => {
    const src = `
function f() {
  return 1;
  const dead = 2;
  console.log("no");
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.unreachable.length).toBeGreaterThanOrEqual(1);
    // dead 声明与后续 console
    const lines = d.unreachable.map((u) => u.range.start.line);
    expect(lines.some((l) => l >= 4)).toBe(true);
  });

  it("marks statements after throw as unreachable", () => {
    const src = `
function f(n) {
  if (n) {
    throw new Error("x");
    return 1;
  }
  return 0;
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.unreachable.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag code after if/else both return", () => {
    const src = `
function f(n) {
  if (n) { return 1; } else { return 2; }
}
`;
    const d = collectEvalDiagnostics(src);
    // if 内无后续语句
    expect(d.unreachable).toHaveLength(0);
  });

  it("flags unknown global calls as builtin-unknown", () => {
    const src = `
function f() {
  return someNativeApi(1);
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown.map((b) => b.name)).toContain("someNativeApi");
  });

  it("extraKnown (@nudo:mock / @nudo:env covered) globals are not flagged", () => {
    const src = `
function f() {
  return someNativeApi(1);
}
`;
    expect(collectEvalDiagnostics(src, ["someNativeApi"]).builtinUnknown).toHaveLength(0);
    // 无覆盖时仍报
    expect(collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name)).toContain("someNativeApi");
  });

  it("does not flag locals, imports, or known globals", () => {
    const src = `
import { helper } from "./h.js";
function local(x) { return x; }
function f() {
  const y = local(1);
  return helper(y) + Math.max(1, 2) + JSON.stringify(y);
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown).toHaveLength(0);
  });

  it("static require / require.resolve are not builtin-unknown", () => {
    const src = `
const a = require("./a.js");
const b = require(\`./b.js\`);
const c = require("./" + "c" + ".js");
const d = require.resolve("./d.js");
function f() { return a; }
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown.map((b) => b.name)).not.toContain("require");
    expect(d.builtinUnknown).toHaveLength(0);
  });

  it("dynamic require / require.resolve stay honest builtin-unknown", () => {
    const src = `
function f(name) {
  const m = require(name);
  const p = require.resolve("./" + name + ".js");
  return m;
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown.map((b) => b.name)).toContain("require");
  });

  it("does not flag rest / default / destructured bindings", () => {
    const src = `
export function f(x = 1, {a, b = 2}, [c, ...rest]) {
  const {p, ...others} = a;
  return x + b + c + rest + others + p;
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown).toHaveLength(0);
  });

  it("does not flag named function / class expression self-references", () => {
    const src = `
const g = function named(n) { return n < 2 ? 1 : n * named(n - 1); };
const K = class Klass { static make() { return Klass; } };
export function f(n) { return g(n) + K.make(); }
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown).toHaveLength(0);
  });

  it("flags free identifiers in computed keys / computed members", () => {
    const src = `
export class C {
  [computedKey]() { return 1; }
}
export function f(o) {
  const a = {[missing]: 1};
  const b = o[alsoMissing];
  return a + b + new C()[computedKey]();
}
`;
    const names = collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name);
    expect(names).toContain("missing");
    expect(names).toContain("alsoMissing");
    expect(names).toContain("computedKey");
  });

  it("non-computed property / member names stay name positions", () => {
    const src = `
export function f(o) {
  const a = {key: 1};
  const {key} = a;
  return a.key + o.name + key;
}
`;
    const d = collectEvalDiagnostics(src);
    expect(d.builtinUnknown).toHaveLength(0);
  });
});
