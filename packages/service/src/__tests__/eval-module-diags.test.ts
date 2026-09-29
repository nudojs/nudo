import { it, expect, describe, afterAll } from "vitest";
import { analyzeFile, clearEvalCache, evalAbsModuleGraph } from "@nudojs/service";
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
  clearEvalCache();
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
    clearEvalCache();
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

describe("nudo:missing-export (named import / re-export 缺名)", () => {
  it("reports missing named import against a successfully evaluated module", () => {
    const dir = setup({
      "m.js": `export const a = 1;\n`,
    });
    const src = `import { b } from "./m.js";
/**
 * @nudo:case
 */
export function go() { return b; }
`;
    const r = analyze(dir, src);
    const missing = r.diagnostics.filter((d) => d.code === "nudo:missing-export");
    expect(missing.length).toBe(1);
    expect(missing[0]!.severity).toBe("error");
    expect(missing[0]!.message).toContain("m.js");
    expect(missing[0]!.message).toContain("b");
  });

  it("does not report when the named export exists", () => {
    const dir = setup({
      "m.js": `export const a = 1;\n`,
    });
    const src = `import { a } from "./m.js";
/**
 * @nudo:case
 */
export function go() { return a; }
`;
    const r = analyze(dir, src);
    expect(r.diagnostics.filter((d) => d.code === "nudo:missing-export")).toEqual([]);
  });

  it("reports re-export missing name and keeps the unknown slot for consumers", () => {
    const dir = setup({
      "m.js": `export const a = 1;\n`,
      "barrel.js": `export { nope } from "./m.js";\n`,
    });
    const src = `import { nope } from "./barrel.js";
/**
 * @nudo:case
 */
export function go() { return nope; }
`;
    const r = analyze(dir, src);
    const missing = r.diagnostics.filter((d) => d.code === "nudo:missing-export");
    // 仅 barrel 对 m.js 的 re-export 缺名报一条；消费方从 barrel 拿到的是 unknown 槽（名仍在）
    expect(missing.length).toBe(1);
    expect(missing[0]!.message).toContain("nope");
    expect(missing[0]!.message).toContain("m.js");

    // 槽位：barrel 的导出表必须仍有 nope（unknown），消费方 import 不落空
    writeFileSync(join(dir, "index.js"), src);
    clearEvalCache();
    const g = evalAbsModuleGraph(src, join(dir, "index.js"));
    const barrel = g.modules["./barrel.js"];
    expect(barrel).toBeDefined();
    expect(barrel!.named.nope).toBeDefined();
    expect(barrel!.evaluated).toBe(true);
  });

  it("fail-closed empty table (eval failure) does not stack missing-export on module-missing", () => {
    const dir = setup({});
    // 模块文件不存在 → module-missing；不得叠报 missing-export
    const src = `import { x } from "./nope.js";
/**
 * @nudo:case
 */
export function go() { return x; }
`;
    const r = analyze(dir, src);
    expect(r.diagnostics.filter((d) => d.code === "nudo:module-missing").length).toBe(1);
    expect(r.diagnostics.filter((d) => d.code === "nudo:missing-export")).toEqual([]);
  });

  it("evalAbsModuleGraph issues carry kind missing-export", () => {
    const dir = setup({
      "m.js": `export const a = 1;\n`,
    });
    const src = `import { b } from "./m.js";
export function go() { return b; }
`;
    writeFileSync(join(dir, "index.js"), src);
    clearEvalCache();
    const g = evalAbsModuleGraph(src, join(dir, "index.js"));
    expect(g.issues.some((i) => i.kind === "missing-export" && i.label.includes("b"))).toBe(true);
  });
});

describe("export slots survive undefined / missing re-export names", () => {
  it("export let x keeps the named slot (value undefined ≠ never exported)", () => {
    const dir = setup({
      "m.js": `export let x;\nexport const y = 1;\n`,
    });
    const src = `import { x, y } from "./m.js";
/**
 * @nudo:case
 */
export function go() { return [x, y]; }
`;
    const r = analyze(dir, src);
    // x 是 undefined 值槽，不是 missing-export
    expect(r.diagnostics.filter((d) => d.code === "nudo:missing-export")).toEqual([]);
  });

  it("export default undefined keeps the default slot", () => {
    const dir = setup({
      "m.js": `export default undefined;\n`,
    });
    const src = `import d from "./m.js";
/**
 * @nudo:case
 */
export function go() { return d; }
`;
    const r = analyze(dir, src);
    expect(r.diagnostics.filter((d) => d.code === "nudo:missing-export")).toEqual([]);
  });
});
