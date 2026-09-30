import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalAbsModuleGraph } from "@nudojs/service";
import { runTranspiled, callTranspiledExportFull, litValue, numLit, type Abs } from "@nudojs/core";

/** 求值引擎驱动：runTranspiled（注入模块图）+ 导出调用（取代 analyzeFn 的求值面） */
function analyzeExportWithModules(
  src: string,
  fnName: string,
  args: Abs[],
  modules: Record<string, unknown>,
): Abs {
  const run = runTranspiled(src, { mode: "analyze", modules: modules as never });
  return callTranspiledExportFull(run, fnName, args).result;
}

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
    expect(litValue(modules["./math.js"]!.named.answer!)).toEqual({ ok: true, value: 42 });

    const r = analyzeExportWithModules(mainSrc, "run", [numLit(21)], modules);
    expect(litValue(r)).toEqual({ ok: true, value: 42 });
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
    const result = analyzeExportWithModules(mainSrc, "go", [numLit(0)], modules);
    expect(litValue(result)).toEqual({ ok: true, value: 2 });
  });

  it("default export flows through the graph (evaluator bridge)", () => {
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
    const result = analyzeExportWithModules(mainSrc, "go", [numLit(0)], modules);
    expect(litValue(result)).toEqual({ ok: true, value: 2 });
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
    const result = analyzeExportWithModules(mainSrc, "go", [numLit(5)], modules);
    // dec(5)=4, inc(4)=5
    expect(litValue(result)).toEqual({ ok: true, value: 5 });
  });

  it("cycle does not hang and backfills in-cycle bindings (BUG-005)", () => {
    const dir = tmpProject({
      "a.js": `
import { b } from "./b.js";
export function fa(x) { return b(x); }
export const ka = 1;
`,
      "b.js": `
import { fa, ka } from "./a.js";
export function b(x) { return x; }
`,
    });
    const mainSrc = `import { fa, ka } from "./a.js"; export function go(x) { return fa(x); }`;
    const { modules, byPath, issues } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    expect(modules["./a.js"]).toBeDefined();
    // cycle recorded, load does not hang
    expect(issues.some((i) => i.kind === "cycle")).toBe(true);
    // in-cycle bindings must be backfilled into the placeholder (not stay { named: {} })
    expect(modules["./a.js"]!.named.fa).toBeDefined();
    expect(modules["./a.js"]!.named.ka).toBeDefined();
    const aExports = byPath.get(join(dir, "a.js"))!;
    const bExports = byPath.get(join(dir, "b.js"))!;
    expect(aExports.named.fa).toBeDefined();
    expect(aExports.named.ka).toBeDefined();
    expect(bExports.named.b).toBeDefined();
    // placeholder held by the cycle peer is the same object, now non-empty
    expect(Object.keys(aExports.named).length).toBeGreaterThan(0);
    expect(Object.keys(bExports.named).length).toBeGreaterThan(0);
  });

  it("export * as ns re-exports a namespace slot (BUG-004)", () => {
    const dir = tmpProject({
      "m.js": `export function inc(x) { return x + 1; }
export const k = 1;`,
      "barrel.js": `export * as ns from "./m.js";`,
      "main.js": `
import { ns } from "./barrel.js";
export function go(x) { return ns.inc(x); }
`,
    });
    const mainSrc = `import { ns } from "./barrel.js";
export function go(x) { return ns.inc(x); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    const barrel = modules["./barrel.js"]!;
    expect(barrel.named.ns).toBeDefined();
    const ns = barrel.named.ns!;
    expect(ns.shape.k).toBe("obj");
    expect((ns.shape as { open?: boolean }).open).toBe(true);
    expect(ns.conf).toBe("path");
    const slots = (ns.shape as { slots: Record<string, { value: unknown }> }).slots;
    expect(slots.inc).toBeDefined();
    expect(slots.k).toBeDefined();

    const result = analyzeExportWithModules(mainSrc, "go", [numLit(10)], modules);
    expect(litValue(result)).toEqual({ ok: true, value: 11 });
  });

  it("import * as ns missing member does not false-throw TypeError (BUG-004)", () => {
    const dir = tmpProject({
      "m.js": `export function inc(x) { return x + 1; }`,
      "main.js": `
import * as ns from "./m.js";
export function go() { return ns.notThere(); }
`,
    });
    const mainSrc = `import * as ns from "./m.js";
export function go() { return ns.notThere(); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    const run = runTranspiled(mainSrc, { mode: "analyze", modules });
    const res = callTranspiledExportFull(run, "go", []);
    // open+path：缺失成员是分析视图不完整，不得按「运行时缺失」假抛 TypeError
    expect(res.result).toBeDefined();
    const throwsShape = res.throws.shape as { k: string; name?: string; members?: Array<{ shape?: { name?: string } }> };
    if (throwsShape.k === "brand") {
      expect(throwsShape.name).not.toBe("TypeError");
    }
    if (throwsShape.k === "sum") {
      for (const m of throwsShape.members ?? []) {
        expect(m.shape?.name).not.toBe("TypeError");
      }
    }
  });

  it("imported always-throw fn surfaces throws non-never in caller (BUG-006)", () => {
    const dir = tmpProject({
      "a.js": `export function boom() { throw new TypeError("x"); }`,
      "b.js": `
import { boom } from "./a.js";
export function f() { return boom(); }
`,
    });
    const mainSrc = `import { boom } from "./a.js";
export function f() { return boom(); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "b.js"));
    const run = runTranspiled(mainSrc, { mode: "analyze", modules });
    const res = callTranspiledExportFull(run, "f", []);
    // always-throw：result=never，throws 必须非 never（不得假「不抛」）
    expect(res.result.shape.k).toBe("never");
    expect(res.throws.shape.k).not.toBe("never");
  });

  it("imported may-throw fn surfaces throws non-never in caller (BUG-006)", () => {
    const dir = tmpProject({
      "a.js": `export function maybe(x) { if (x) throw new TypeError("x"); return 1; }`,
      "b.js": `
import { maybe } from "./a.js";
export function f(x) { return maybe(x); }
`,
    });
    const mainSrc = `import { maybe } from "./a.js";
export function f(x) { return maybe(x); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "b.js"));
    const run = runTranspiled(mainSrc, { mode: "analyze", modules });
    const res = callTranspiledExportFull(run, "f", [numLit(1)]);
    // may-throw：throws 面必须非 never（不得丢弃）
    expect(res.throws.shape.k).not.toBe("never");
  });
});
