import { it, expect, describe, afterAll } from "vitest";
import { analyzeFile, clearBPathCache, evalAbsModuleGraph } from "@nudojs/service";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function setup(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bdiag-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "bdiag", version: "1.0.0" }));
  for (const [name, src] of Object.entries(files)) {
    writeFileSync(join(dir, name), src);
  }
  return dir;
}

function analyze(dir: string, src: string, file = "index.js") {
  writeFileSync(join(dir, file), src);
  clearBPathCache();
  return analyzeFile(join(dir, file), src);
}

describe("B module-load diagnostics (host, no TypeValue double)", () => {
  it("reports circular import once via B module graph", () => {
    const dir = setup({
      "a.js": `import { b } from "./b.js";
export function a(n) { return n <= 0 ? 0 : b(n - 1); }
`,
      "b.js": `import { a } from "./a.js";
export function b(n) { return n <= 0 ? 1 : a(n - 1); }
`,
    });
    const src = `import { a } from "./a.js";
/**
 * @nudo:case "n" (2)
 */
export function go(n) { return a(n); }
`;
    const r = analyze(dir, src);
    const cycles = r.diagnostics.filter((d) => d.code === "nudo:module-cycle");
    expect(cycles.length).toBe(1);
    expect(cycles[0]!.message).toContain("Circular module load");
    expect(cycles[0]!.message).toContain("->");
  });

  it("reports missing relative import once via B module graph", () => {
    const dir = setup({});
    const src = `import { x } from "./nope.js";
/**
 * @nudo:case
 */
export function go() { return x; }
`;
    const r = analyze(dir, src);
    const missing = r.diagnostics.filter((d) => d.code === "nudo:module-missing");
    expect(missing.length).toBe(1);
    expect(missing[0]!.message).toContain("nope.js");
  });

  it("B module graph issues come from evalAbsModuleGraph", () => {
    const dir = setup({
      "a.js": `import { b } from "./b.js";
export function a() { return b(); }
`,
      "b.js": `import { a } from "./a.js";
export function b() { return a(); }
`,
    });
    const src = `import { a } from "./a.js";
export function go() { return a(); }
`;
    writeFileSync(join(dir, "index.js"), src);
    clearBPathCache();
    const g = evalAbsModuleGraph(src, join(dir, "index.js"));
    expect(g.issues.some((i) => i.kind === "cycle")).toBe(true);
  });

  it("recursion-truncated is not double-reported when Abs budget fires", () => {
    const dir = setup({});
    // 抽象参数触发调用预算截断；B Abs 路径与 TypeValue 都可能记 recursion:*
    const src = `
/**
 * @nudo:case "n" (number())
 */
export function deep(n) {
  if (n <= 0) return 0;
  return 1 + deep(n - 1);
}
const boom = deep(3);
`;
    const r = analyze(dir, src);
    const rec = r.diagnostics.filter((d) => d.code === "nudo:recursion-truncated");
    // 至多一条（B 截断则压 TypeValue；否则 TypeValue 自报）
    expect(rec.length).toBeLessThanOrEqual(1);
  });
});
