import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { harvestedValueToAbs, bareSpecToAbsModules, evalAbsModuleGraph } from "@nudojs/service";
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
  type Abs,
} from "@nudojs/core";

const dirs: string[] = [];
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
  });

  it("bareSpecToAbsModules finds lodash from monorepo root", () => {
    const file = join(process.cwd(), "packages/service/src/__probe.js");
    const mods = bareSpecToAbsModules("lodash", file);
    expect(mods).toBeDefined();
    expect(Object.keys(mods!.named).length).toBeGreaterThan(10);
  }, 60_000);

  it("module graph injects bare import into B export call", () => {
    // 放在 monorepo 内，harvest 才能找到 node_modules/@types/lodash
    const dir = join(process.cwd(), "packages/service/src/__tmp-bare-mod");
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    const main = `import { chunk } from "lodash";
export function go(x) { return chunk(x, 2); }
`;
    const mainPath = join(dir, "main.js");
    writeFileSync(mainPath, main, "utf-8");
    const { modules } = evalAbsModuleGraph(main, mainPath);
    expect(modules["lodash"]).toBeDefined();
    const run = runTranspiled(main, { mode: "analyze", modules: modules as never });
    const r = callTranspiledExportFull(run, "go", [numLit(4)]).result satisfies Abs;
    expect(r).toBeDefined();
    expect(["mock", "partial", "path", "exact", "widened", "opaque"]).toContain(r.conf);
  }, 60_000);

  it("generic harvest instantiates T from call-site args (lodash uniq)", () => {
    const file = join(process.cwd(), "packages/service/src/__probe2.js");
    const mods = bareSpecToAbsModules("lodash", file);
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
    expect(out.shape.k).toBe("arr");
    if (out.shape.k === "arr") {
      expect(out.shape.element.shape).toEqual({ k: "prim", type: "number" });
    }
  }, 60_000);
});
