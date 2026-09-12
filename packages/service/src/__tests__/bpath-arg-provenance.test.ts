import { it, expect, describe, afterAll } from "vitest";
import { analyzeFile, clearBPathCache } from "@nudojs/service";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function analyze(src: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-prov-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "prov", version: "1.0.0" }));
  writeFileSync(join(dir, "index.js"), src);
  clearBPathCache();
  return analyzeFile(join(dir, "index.js"), src);
}

describe("B argument provenance on method-missing", () => {
  it("origin points at the argument literal, not just the callee", () => {
    const src = `function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(42);
`;
    const r = analyze(src);
    const diags = r.diagnostics.filter(
      (d) => d.code === "nudo:no-method" && d.message.includes("toUpperCase"),
    );
    expect(diags.length).toBe(1);
    const origin = diags[0]!.origin;
    expect(origin).toBeDefined();
    // `const boom = badNum(42);` — 42 starts at column 20
    expect(origin!.line).toBe(4);
    expect(origin!.column).toBeGreaterThanOrEqual(18);
    expect(origin!.column).toBeLessThanOrEqual(22);
  });

  it("mocked top-level call does not hit real fetch", () => {
    const src = `// @nudo:mock fetch = sinon.stub().onFirstCall().returns({ data: "first" })
function run() { return fetch(); }
const r = run();
function badNum(n) {
  return n.toUpperCase();
}
const boom = badNum(7);
`;
    const r = analyze(src);
    const fetchErrs = r.diagnostics.filter(
      (d) => d.message.includes("fetch") && d.severity === "error",
    );
    expect(fetchErrs).toHaveLength(0);
    const diags = r.diagnostics.filter(
      (d) => d.code === "nudo:no-method" && d.message.includes("toUpperCase"),
    );
    expect(diags.length).toBe(1);
    expect(diags[0]!.origin?.column).toBeGreaterThanOrEqual(16);
  });

  it("unknown-global is not double-reported with builtin-unknown", () => {
    const src = `function f() {
  return WeakRef;
}
const boom = f();
`;
    const r = analyze(src);
    const globals = r.diagnostics.filter((d) => d.code === "nudo:unknown-global");
    const builtins = r.diagnostics.filter((d) => d.code === "nudo:builtin-unknown");
    expect(builtins.some((d) => d.message.includes("WeakRef"))).toBe(true);
    expect(globals.filter((d) => d.message.includes("WeakRef"))).toHaveLength(0);
  });
});
