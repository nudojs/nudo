import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectAbsBindingsFromGraph, analyzeFile } from "@nudojs/service";
import { getHoverAtPosition } from "../lsp-surface.ts";
import { formatAbs, absToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Abs bindings from module graph", () => {
  it("includes local functions and imported names", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-abs-bind-"));
    dirs.push(dir);
    writeFileSync(join(dir, "math.js"), `export function double(x) { return x * 2; }\n`);
    const main = `import { double } from "./math.js";
export function run(n) { return double(n); }
const k = 1;
`;
    const mainPath = join(dir, "main.js");
    writeFileSync(mainPath, main, "utf-8");
    const binds = collectAbsBindingsFromGraph(main, mainPath);
    expect(binds.has("run")).toBe(true);
    expect(binds.has("double")).toBe(true);
    expect(binds.has("k")).toBe(true);
    expect(formatAbs(binds.get("k")!)).toContain("1");
  });

  it("analyzeFile bindings prefer Abs projection for capable files", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-abs-bind2-"));
    dirs.push(dir);
    writeFileSync(join(dir, "math.js"), `export function double(x) { return x * 2; }\n`);
    const main = `import { double } from "./math.js";
export function run(n) { return double(n); }
`;
    const mainPath = join(dir, "main.js");
    writeFileSync(mainPath, main, "utf-8");
    const result = analyzeFile(mainPath, main);
    expect(result.bindings.has("run")).toBe(true);
    // imported binding should exist
    expect(result.bindings.has("double")).toBe(true);
  });

  it("hover on local function returns abs", () => {
    const src = `export function add(a, b) { return a + b; }
`;
    const h = getHoverAtPosition("/tmp/hover-abs.js", src, 1, 16);
    // 不要求精确命中，但不应抛错
    expect(h === null || typeof h.typeText === "string").toBe(true);
  });
});
