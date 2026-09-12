import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeFile,
  tryBPathCall,
  isBPathCapable,
  clearBPathCache,
} from "@nudojs/service";
import { typeValueToString, $lit, litValue } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("B-path require", () => {
  it("relative require injects Abs exports", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-req-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "math.js"),
      `function double(x) { return x * 2; }\nexport { double };\n`,
    );
    const main = `
const math = require("./math.js");
/**
 * @nudo:case "t" (21)
 */
export function go(n) {
  return math.double(n);
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    expect(isBPathCapable(main)).toBe(true);
    const r = tryBPathCall(main, p, "go", [$lit(21)]);
    expect(r).toBeDefined();
    expect(litValue(r!)).toBe(42);
  });

  it("analyzeFile case works with require", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-req2-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.js"), `export function inc(x) { return x + 1; }\n`);
    const main = `
const util = require("./util.js");
/**
 * @nudo:case "t" (1)
 */
function go(n) {
  return util.inc(n);
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    const result = analyzeFile(p, main);
    const go = result.functions.find((f) => f.name === "go");
    expect(go).toBeDefined();
    const c = go!.cases.find((x) => x.name === "t");
    expect(typeValueToString(c!.result)).toBe("2");
  });
});
