import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile, tryBPathCall, isBPathCapable, clearBPathCache } from "@nudojs/service";
import { typeValueToString, $lit, absToString } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("B-path @nudo:env", () => {
  it("isBPathCapable allows builtin and path env", () => {
    expect(isBPathCapable("function f() { return 1; }", ["es"])).toBe(true);
    expect(isBPathCapable("function f() { return 1; }", ["./custom.ts"])).toBe(true);
  });

  it("JSON.parse via @nudo:env es", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-env-"));
    dirs.push(dir);
    const main = `/// @nudo:env es

/**
 * @nudo:case "t" ("{}")
 */
export function parseId(s) {
  return typeof JSON.parse(s);
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    const r = tryBPathCall(main, p, "parseId", [$lit("{}")], { envNames: ["es"] });
    expect(r).toBeDefined();
    expect(absToString(r!)).toContain("string");
  });

  it("analyzeFile works with @nudo:env es", () => {
    clearBPathCache();
    const source = `/// @nudo:env es

/**
 * @nudo:case "t" (5)
 */
function addOne(n) {
  return Math.floor(n) + 1;
}
`;
    const result = analyzeFile("/test/env.js", source);
    const fn = result.functions.find((f) => f.name === "addOne");
    expect(fn).toBeDefined();
    expect(typeValueToString(fn!.cases[0].result)).toBe("6");
  });
});
