import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTranspiled, callTranspiledExport, $lit, litValue } from "@nudojs/core";
import { tryBPathCall, isBPathCapable, analyzeFile } from "@nudojs/service";
import { typeValueToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpPair(math: string, main: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-imp-"));
  dirs.push(dir);
  writeFileSync(join(dir, "math.js"), math, "utf-8");
  writeFileSync(join(dir, "main.js"), main, "utf-8");
  return { dir, mainPath: join(dir, "main.js"), main };
}

describe("B-path imported functions", () => {
  it("runTranspiled + injected JS exports from dep", () => {
    const dep = runTranspiled(`export function double(x) { return x * 2; }`);
    const main = runTranspiled(
      `import { double } from "./math.js";
export function run(n) { return double(n); }`,
      { modules: { "./math.js": dep as never } },
    );
    const r = callTranspiledExport(main, "run", [$lit(21)]);
    expect(litValue(r)).toBe(42);
  });

  it("tryBPathCall via module graph (Abs absFunction dep)", () => {
    const { main, mainPath } = tmpPair(
      `export function double(x) { return x * 2; }`,
      `import { double } from "./math.js";
export function run(n) { return double(n); }
`,
    );
    const r = tryBPathCall(main, mainPath, "run", [$lit(21)]);
    expect(r).toBeDefined();
    expect(litValue(r!)).toBe(42);
  });

  it("analyzeFile case polish uses B path for relative import", () => {
    const { dir, main, mainPath } = tmpPair(
      `export function triple(x) { return x * 3; }`,
      `import { triple } from "./b.js";
/**
 * @nudo:case "four" (4)
 */
export function run(n) { return triple(n); }
`.replace("./b.js", "./math.js"),
    );
    void dir;
    const result = analyzeFile(mainPath, main);
    const run = result.functions.find((f) => f.name === "run");
    expect(run).toBeDefined();
    const c = run!.cases.find((x) => x.name === "four");
    expect(c).toBeDefined();
    expect(typeValueToString(c!.result)).toBe("12");
    // B 路径应挂上 intension
    expect(c!.intension?.abs ?? c!.intension?.display).toBeTruthy();
  });

  it("isBPathCapable allows class; rejects async/require", () => {
    expect(isBPathCapable("function f() { return 1; }")).toBe(true);
    expect(isBPathCapable("class A { constructor() { this.x = 1; } }")).toBe(true);
    expect(isBPathCapable("async function f() { return 1; }")).toBe(false);
    expect(isBPathCapable("const x = require('fs');")).toBe(false);
  });
});

describe("transpile import emission", () => {
  it("preserves relative import", async () => {
    const { transpile } = await import("@nudojs/core");
    const out = transpile(
      `import { double } from "./math.js";
export function run(n) { return double(n); }`,
    );
    expect(out).toContain('from "./math.js"');
    expect(out).toContain("double");
  });
});
