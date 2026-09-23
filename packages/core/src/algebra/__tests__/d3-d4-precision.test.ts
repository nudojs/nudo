/**
 * D3/D4 — infer 端到端收窄 + Promise.then 同步映射回调返回。
 */
import { describe, it, expect } from "vitest";
import { harvestDts } from "@nudojs/harvester";
import {
  getFnImpl,
  formatShape,
  instantiateReturn,
  relationFn,
  abs,
  runTranspiled,
  callTranspiledExportFull,
  type Abs,
} from "@nudojs/core";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function prim(t: "number" | "string") {
  return abs({ k: "prim", type: t }, undefined, undefined, "exact");
}
function arr(el: Abs) {
  return abs({ k: "arr", element: el }, undefined, undefined, "exact");
}
function promise(inner: Abs) {
  return abs({ k: "eff", eff: "promise", inner }, undefined, undefined, "exact");
}
function tvar(name: string) {
  return abs({ k: "any" }, { op: "var", id: name }, undefined, "path");
}

describe("D3 infer end-to-end (relation.inferFrom)", () => {
  it("T extends (infer E)[] ? E : never — el(number[]) => number", () => {
    const T = tvar("T");
    const E = tvar("E");
    // f<T>(xs: T): T extends (infer E)[] ? E : never
    const f = relationFn([T], E, {
      inferFrom: { fromVar: "T", via: "arr", inferVar: "E" },
      condFallback: abs({ k: "never" }, undefined, undefined, "exact"),
    });
    const out = instantiateReturn(f, [arr(prim("number"))]);
    expect(formatShape(out)).toBe("number");
  });

  it("T not array → fallback never", () => {
    const T = tvar("T");
    const E = tvar("E");
    const f = relationFn([T], E, {
      inferFrom: { fromVar: "T", via: "arr", inferVar: "E" },
      condFallback: abs({ k: "never" }, undefined, undefined, "exact"),
    });
    const out = instantiateReturn(f, [prim("string")]);
    expect(formatShape(out)).toBe("never");
  });

  it("T extends Promise<infer U> ? U : T — unwrap Promise<number>", () => {
    const T = tvar("T");
    const U = tvar("U");
    const f = relationFn([T], U, {
      inferFrom: { fromVar: "T", via: "promise", inferVar: "U" },
      condFallback: T,
    });
    const out = instantiateReturn(f, [promise(prim("number"))]);
    expect(formatShape(out)).toBe("number");
  });

  it("harvest: declare function el<T>(xs: T[]): T extends (infer E)[] ? E : never", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-d3-"));
    const p = join(dir, "a.d.ts");
    writeFileSync(
      p,
      `export declare function el<T>(xs: T[]): T extends (infer E)[] ? E : never;\n`,
      "utf-8",
    );
    const env = harvestDts([p]);
    const fn = env.globals.el!;
    const impl = getFnImpl(fn)!;
    expect(impl.relation?.inferFrom).toBeDefined();
    const out = instantiateReturn(fn, [arr(prim("string"))]);
    // T=string → string extends E[] ? false → never
    expect(formatShape(out)).toBe("never");
  });

  it("harvest: Unpack Promise — f<T>(x: T): T extends Promise<infer U> ? U : T", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-d3b-"));
    const p = join(dir, "b.d.ts");
    writeFileSync(
      p,
      `export declare function unpack<T>(x: T): T extends Promise<infer U> ? U : T;\n`,
      "utf-8",
    );
    const env = harvestDts([p]);
    const fn = env.globals.unpack!;
    const impl = getFnImpl(fn)!;
    expect(impl.relation?.inferFrom?.via).toBe("promise");
    expect(formatShape(instantiateReturn(fn, [promise(prim("number"))]))).toBe("number");
    expect(formatShape(instantiateReturn(fn, [prim("string")]))).toBe("string");
  });
});

describe("D4 Promise.then sync mapping", () => {
  it("then with relation callback fills promise inner immediately", () => {
    const src = `export function chain(p) {
  return p.then(x => String(x));
}
`;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "chain", [promise(prim("number"))]);
    expect(formatShape(r.result)).toBe("promise<string>");
  });

  it("then keeps element type when mapping arrays", () => {
    const src = `export function pack(p) {
  return p.then(x => [x, x]);
}
`;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "pack", [promise(prim("number"))]);
    expect(formatShape(r.result)).toContain("number");
    expect(formatShape(r.result)).toContain("promise");
  });
});
