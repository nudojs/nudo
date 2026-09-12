import { it, expect, describe, afterAll } from "vitest";
import { analyzeFile, clearBPathCache } from "@nudojs/service";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-imp-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "imp", version: "1.0.0" }));
  writeFileSync(
    join(dir, "util.js"),
    `export function add(a, b) {
  return a + b;
}
export default function mul(a, b) {
  return a * b;
}
`,
  );
  return dir;
}

function goResult(dir: string, src: string) {
  writeFileSync(join(dir, "index.js"), src);
  const r = analyzeFile(join(dir, "index.js"), src);
  const go = r.functions.find((f) => f.name === "go");
  return { result: go?.cases[0]?.result, diagnostics: r.diagnostics };
}

describe("B-path import default / namespace", () => {
  it("named import", () => {
    clearBPathCache();
    const dir = setup();
    const { result } = goResult(
      dir,
      `import { add } from "./util.js";
/**
 * @nudo:case "nums" (1, 2)
 */
export function go(a, b) {
  return add(a, b);
}
`,
    );
    expect(result).toMatchObject({ kind: "literal", value: 3 });
  });

  it("default import of export default function", () => {
    clearBPathCache();
    const dir = setup();
    const { result, diagnostics } = goResult(
      dir,
      `import mul from "./util.js";
/**
 * @nudo:case "nums" (3, 4)
 */
export function go(a, b) {
  return mul(a, b);
}
`,
    );
    expect(result).toMatchObject({ kind: "literal", value: 12 });
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("namespace import member call", () => {
    clearBPathCache();
    const dir = setup();
    const { result, diagnostics } = goResult(
      dir,
      `import * as util from "./util.js";
/**
 * @nudo:case "nums" (5, 6)
 */
export function go(a, b) {
  return util.add(a, b);
}
`,
    );
    expect(result).toMatchObject({ kind: "literal", value: 11 });
    expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("namespace import default slot", () => {
    clearBPathCache();
    const dir = setup();
    const { result } = goResult(
      dir,
      `import * as util from "./util.js";
/**
 * @nudo:case "nums" (2, 5)
 */
export function go(a, b) {
  return util.default(a, b);
}
`,
    );
    expect(result).toMatchObject({ kind: "literal", value: 10 });
  });
});
