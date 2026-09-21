import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalAbsModuleGraph } from "@nudojs/service";
import { analyzeFn, litValue, numLit } from "@nudojs/core";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-abs-mod-"));
  dirs.push(dir);
  for (const [rel, src] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, src, "utf-8");
  }
  return dir;
}

describe("Abs module graph", () => {
  it("evaluates a relative import and binds named exports", () => {
    const dir = tmpProject({
      "math.js": `
export function double(x) { return x * 2; }
export const answer = 42;
`,
      "main.js": `
import { double, answer } from "./math.js";
export function run(n) { return double(n); }
`,
    });
    const mainSrc = `import { double, answer } from "./math.js";
export function run(n) { return double(n); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    expect(modules["./math.js"]).toBeDefined();
    expect(modules["./math.js"]!.named.double).toBeDefined();
    expect(litValue(modules["./math.js"]!.named.answer!)).toBe(42);

    const r = analyzeFn(
      mainSrc,
      "run",
      [numLit(21)],
      undefined,
      undefined,
      undefined,
      modules,
    );
    expect(litValue(r)).toBe(42);
  });

  it("chained relative imports resolve", () => {
    const dir = tmpProject({
      "a.js": `export function inc(x) { return x + 1; }`,
      "b.js": `
import { inc } from "./a.js";
export function twice(x) { return inc(inc(x)); }
`,
      "main.js": `
import { twice } from "./b.js";
export function go(x) { return twice(x); }
`,
    });
    const mainSrc = `import { twice } from "./b.js";
export function go(x) { return twice(x); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    const result = analyzeFn(
      mainSrc,
      "go",
      [numLit(0)],
      undefined,
      undefined,
      undefined,
      modules,
    );
    expect(litValue(result)).toBe(2);
  });

  it("default export flows through the graph (B-path bridge)", () => {
    const dir = tmpProject({
      "inc.js": `export default function(x) { return x + 1; }`,
      "main.js": `
import inc from "./inc.js";
export function go(x) { return inc(inc(x)); }
`,
    });
    const mainSrc = `import inc from "./inc.js";
export function go(x) { return inc(inc(x)); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    expect(modules["./inc.js"]!.default).toBeDefined();
    const result = analyzeFn(
      mainSrc,
      "go",
      [numLit(0)],
      undefined,
      undefined,
      undefined,
      modules,
    );
    expect(litValue(result)).toBe(2);
  });

  it("barrel re-exports (export * + default re-export) resolve", () => {
    const dir = tmpProject({
      "base.js": `export function inc(x) { return x + 1; }
export default function dec(x) { return x - 1; }`,
      "barrel.js": `export * from "./base.js";
export { default } from "./base.js";`,
      "main.js": `
import { inc } from "./barrel.js";
import dec from "./barrel.js";
export function go(x) { return inc(dec(x)); }
`,
    });
    const mainSrc = `import { inc } from "./barrel.js";
import dec from "./barrel.js";
export function go(x) { return inc(dec(x)); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    expect(modules["./barrel.js"]!.named.inc).toBeDefined();
    expect(modules["./barrel.js"]!.default).toBeDefined();
    const result = analyzeFn(
      mainSrc,
      "go",
      [numLit(5)],
      undefined,
      undefined,
      undefined,
      modules,
    );
    // dec(5)=4, inc(4)=5
    expect(litValue(result)).toBe(5);
  });

  it("cycle does not hang", () => {
    const dir = tmpProject({
      "a.js": `
import { b } from "./b.js";
export function a(x) { return b(x); }
`,
      "b.js": `
import { a } from "./a.js";
export function b(x) { return x; }
`,
    });
    const mainSrc = `import { a } from "./a.js"; export function go(x) { return a(x); }`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    expect(modules["./a.js"]).toBeDefined();
  });
});
