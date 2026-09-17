import { it, expect, describe, afterAll } from "vitest";
import { analyzeFile, clearBPathCache } from "@nudojs/service";
import { litValue, formatShape } from "@nudojs/core";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function setup(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mod-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "mod", version: "1.0.0" }));
  for (const [name, src] of Object.entries(files)) {
    writeFileSync(join(dir, name), src);
  }
  return dir;
}

function goResult(dir: string, src: string) {
  writeFileSync(join(dir, "index.js"), src);
  clearBPathCache();
  const r = analyzeFile(join(dir, "index.js"), src);
  const f = r.functions.find((x) => x.name === "go");
  return { abs: f?.cases[0]?.abs, diags: r.diagnostics };
}

describe("B-path re-export / export *", () => {
  it("export { add } from './core.js'", () => {
    const dir = setup({
      "core.js": `export function add(a, b) { return a + b; }
`,
      "barrel.js": `export { add } from "./core.js";
`,
    });
    const { abs } = goResult(
      dir,
      `import { add } from "./barrel.js";
/**
 * @nudo:case "n" (2, 3)
 */
export function go(a, b) { return add(a, b); }
`,
    );
    expect(litValue(abs!)).toBe(5);
  });

  it("export { add as default } from './core.js'", () => {
    const dir = setup({
      "core.js": `export function add(a, b) { return a + b; }
`,
      "barrel.js": `export { add as default } from "./core.js";
`,
    });
    const { abs } = goResult(
      dir,
      `import add from "./barrel.js";
/**
 * @nudo:case "n" (4, 6)
 */
export function go(a, b) { return add(a, b); }
`,
    );
    expect(litValue(abs!)).toBe(10);
  });

  it("export * from './core.js'", () => {
    const dir = setup({
      "core.js": `export function add(a, b) { return a + b; }
export function mul(a, b) { return a * b; }
`,
      "barrel.js": `export * from "./core.js";
`,
    });
    const { abs } = goResult(
      dir,
      `import { mul } from "./barrel.js";
/**
 * @nudo:case "n" (3, 5)
 */
export function go(a, b) { return mul(a, b); }
`,
    );
    expect(litValue(abs!)).toBe(15);
  });

  it("class default export", () => {
    const dir = setup({
      "box.js": `export default class Box {
  constructor(v) { this.v = v; }
  get() { return this.v; }
}
`,
    });
    const { abs } = goResult(
      dir,
      `import Box from "./box.js";
/**
 * @nudo:case "v" (7)
 */
export function go(v) {
  const b = new Box(v);
  return b.get();
}
`,
    );
    expect(litValue(abs!)).toBe(7);
  });

  it("async default export", () => {
    const dir = setup({
      "afn.js": `export default async function load(x) { return x + 1; }
`,
    });
    const { abs } = goResult(
      dir,
      `import load from "./afn.js";
/**
 * @nudo:case "x" (9)
 */
export async function go(x) { return await load(x); }
`,
    );
    expect(abs!.shape.k).toBe("eff");
    expect(formatShape(abs!)).toBe("promise<10>");
  });
});
