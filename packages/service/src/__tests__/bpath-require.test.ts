import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeFile,
  tryBPathCall,
  tryBPathCallFull,
  isBPathCapable,
  clearBPathCache,
} from "@nudojs/service";
import { formatShape, $lit, litValue } from "@nudojs/core";

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
    expect(formatShape(c!.abs)).toBe("2");
  });

  it("template / concat require specs resolve like string literals", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-req3-"));
    dirs.push(dir);
    writeFileSync(join(dir, "math.js"), `export function double(x) { return x * 2; }\n`);
    const main = `
const a = require(\`./math.js\`);
const b = require("./" + "math" + ".js");
/**
 * @nudo:case "t" (21)
 */
export function go(n) {
  return a.double(n) + b.double(0);
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    const r = tryBPathCall(main, p, "go", [$lit(21)]);
    expect(r).toBeDefined();
    expect(litValue(r!)).toBe(42);
  });

  it("dynamic require degrades to unknown without crashing", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-req4-"));
    dirs.push(dir);
    const main = `
/**
 * @nudo:case "t" ("./x.js")
 */
export function go(spec) {
  const m = require(spec);
  return m;
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    // tryBPathCall 对裸 unknown 会吞掉（undefined）——用 Full 看诚实结果
    const full = tryBPathCallFull(main, p, "go", [$lit("./x.js")]);
    expect(full).toBeDefined();
    expect(formatShape(full!.result)).toBe("unknown");
  });

  it("optional require prefers the success side", () => {
    clearBPathCache();
    const dir = mkdtempSync(join(tmpdir(), "nudo-req5-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.js"), `export function tag() { return "from-a"; }\n`);
    writeFileSync(join(dir, "b.js"), `export function tag() { return "from-b"; }\n`);
    const main = `
/**
 * @nudo:case "t" (0)
 */
export function go(n) {
  let m;
  try { m = require("./missing.js"); } catch { m = require("./b.js"); }
  return m.tag();
}
/**
 * @nudo:case "t2" (0)
 */
export function go2(n) {
  let m;
  try { m = require("./a.js"); } catch { m = require("./b.js"); }
  return m.tag();
}
`;
    const p = join(dir, "main.js");
    writeFileSync(p, main, "utf-8");
    const r = tryBPathCall(main, p, "go", [$lit(0)]);
    expect(r).toBeDefined();
    expect(litValue(r!)).toBe("from-b");
    const r2 = tryBPathCall(main, p, "go2", [$lit(0)]);
    expect(r2).toBeDefined();
    expect(litValue(r2!)).toBe("from-a");
  });
});
