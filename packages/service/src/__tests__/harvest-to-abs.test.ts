/**
 * harvest → Abs：fn mock / 泛型实例化 / 模块图注入。
 * 用本地 mini 包（不依赖 lodash），避免 vitest isolate 堆爆。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  harvestedValueToAbs,
  bareSpecToAbsModules,
  evalAbsModuleGraph,
  clearHarvestCache,
} from "@nudojs/service";
import {
  runTranspiled,
  callTranspiledExportFull,
  numLit,
  absToString,
  getFnImpl,
  relationFn,
  num,
  str,
  abs,
  formatShape,
  type Abs,
} from "@nudojs/core";

const dirs: string[] = [];
let pkgRoot: string;

beforeAll(() => {
  // node_modules/@types/demo-lib + node_modules/demo-lib
  const root = join(process.cwd(), "packages/service/src/__tmp-harvest-pkg");
  mkdirSync(join(root, "node_modules", "demo-lib"), { recursive: true });
  mkdirSync(join(root, "node_modules", "@types", "demo-lib"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "demo-lib", "package.json"),
    JSON.stringify({ name: "demo-lib", version: "1.0.0", main: "index.js" }),
    "utf-8",
  );
  writeFileSync(join(root, "node_modules", "demo-lib", "index.js"), "module.exports = {};\n", "utf-8");
  writeFileSync(
    join(root, "node_modules", "@types", "demo-lib", "package.json"),
    JSON.stringify({ name: "@types/demo-lib", version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(
    join(root, "node_modules", "@types", "demo-lib", "index.d.ts"),
    `export declare function chunk<T>(xs: T[], n: number): T[][];
export declare function uniq<T>(xs: T[]): T[];
export declare function label(s: string): string;
`,
    "utf-8",
  );
  writeFileSync(join(root, "probe.js"), "export {};\n", "utf-8");
  pkgRoot = root;
  dirs.push(root);
  clearHarvestCache();
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("harvest → Abs", () => {
  it("fn Abs becomes callable absFunction with declared return", () => {
    const a0 = relationFn([num()], str(), { conf: "exact" });
    const a = harvestedValueToAbs(a0);
    expect(a.shape.k).toBe("fn");
    expect(a.conf).toBe("mock");
    expect(getFnImpl(a)?.apply).toBeTypeOf("function");
    const r = getFnImpl(a)!.apply!([numLit(1)]);
    expect(absToString(r)).toContain("string");
  }, 30_000);

  it("bareSpecToAbsModules finds demo-lib from package root", () => {
    const file = join(pkgRoot, "probe.js");
    clearHarvestCache();
    const mods = bareSpecToAbsModules("demo-lib", file);
    expect(mods).toBeDefined();
    expect(Object.keys(mods!.named).length).toBeGreaterThan(2);
    expect(mods!.named.label).toBeDefined();
    expect(mods!.named.uniq).toBeDefined();
  }, 30_000);

  it("module graph injects bare import into B export call", () => {
    const main = `import { chunk } from "demo-lib";
export function go(x) { return chunk(x, 2); }
`;
    const mainPath = join(pkgRoot, "main.js");
    writeFileSync(mainPath, main, "utf-8");
    clearHarvestCache();
    const { modules } = evalAbsModuleGraph(main, mainPath);
    expect(modules["demo-lib"]).toBeDefined();
    const run = runTranspiled(main, { mode: "analyze", modules: modules as never });
    const r = callTranspiledExportFull(run, "go", [numLit(4)]).result satisfies Abs;
    expect(r).toBeDefined();
    expect(["mock", "partial", "path", "exact", "widened", "opaque"]).toContain(r.conf);
  }, 30_000);

  it("generic harvest instantiates T from call-site args", () => {
    clearHarvestCache();
    const mods = bareSpecToAbsModules("demo-lib", join(pkgRoot, "probe.js"));
    const uniq = mods?.named?.uniq;
    expect(uniq).toBeDefined();
    const impl = getFnImpl(uniq!);
    expect(impl?.relation).toBeDefined();
    const numArr = abs(
      { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const out = impl!.apply!([numArr]);
    expect(formatShape(out)).toBe("number[]");
    expect(out.shape.k).toBe("arr");
    if (out.shape.k === "arr") {
      expect(out.shape.element.shape).toEqual({ k: "prim", type: "number" });
    }
  }, 30_000);
});
