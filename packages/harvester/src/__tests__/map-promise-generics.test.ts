/**
 * Map/Set/Promise 泛型：K,V / T 实例化 + α 合一。
 */
import { describe, it, expect } from "vitest";
import { harvestDts } from "../index.ts";
import {
  getFnImpl,
  formatShape,
  instantiateReturn,
  relationFn,
  abs,
  v,
  abs as makeAbs,
} from "@nudojs/core";

function tvar(name: string) {
  return makeAbs({ k: "any" }, v(name), undefined, "path");
}
function numArr() {
  return abs(
    { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "exact",
  );
}
function prim(type: "number" | "string") {
  return abs({ k: "prim", type }, undefined, undefined, "exact");
}

describe("Map/Promise generic harvest", () => {
  it("Map<string, number> carries __key/__value for α unify", () => {
    const files = [
      writeTemp(
        "m.d.ts",
        `export declare function load(m: Map<string, number>): number;
export declare function save(m: Map<string, number>, v: number): void;
`,
      ),
    ];
    const env = harvestDts(files);
    const load = env.globals.load!;
    const rel = getFnImpl(load)!.relation!;
    expect(formatShape(rel.paramTypes[0]!)).toContain("Map");
    const m = rel.paramTypes[0]!;
    expect(m.shape.k).toBe("brand");
    const inner = m.shape.k === "brand" ? (m.shape.shape as { shape?: { slots?: Record<string, { value: unknown }> }; slots?: Record<string, { value: unknown }> }) : undefined;
    const slots = inner?.shape?.slots ?? inner?.slots;
    expect(slots).toBeDefined();
    expect(slots!.__key).toBeDefined();
    expect(slots!.__value).toBeDefined();
    expect(formatShape((slots!.__key!.value as never))).toContain("string");
    expect(formatShape((slots!.__value!.value as never))).toContain("number");
  });

  it("Promise<T> return keeps T and instantiates via relation", () => {
    const files = [
      writeTemp(
        "p.d.ts",
        `export declare function fetchIds(xs: number[]): Promise<number[]>;
`,
      ),
    ];
    const env = harvestDts(files);
    const fn = env.globals.fetchIds!;
    const rel = getFnImpl(fn)!.relation!;
    expect(rel.returnType.shape.k).toBe("eff");
    if (rel.returnType.shape.k !== "eff") return;
    // Promise<number[]> 的 inner 是 number[]
    expect(formatShape(rel.returnType.shape.inner)).toContain("number");
  });

  it("deep unify: Promise<T> param binds T from Promise<number[]>", () => {
    const T = tvar("T");
    const pT = abs({ k: "eff", eff: "promise", inner: abs({ k: "arr", element: T }) }, undefined, undefined, "path");
    const f = relationFn([pT], abs({ k: "arr", element: T }, undefined, undefined, "path"));
    const arg = abs(
      { k: "eff", eff: "promise", inner: numArr() },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(f, [arg]);
    expect(out.shape.k).toBe("arr");
    if (out.shape.k === "arr") {
      expect(out.shape.element.shape).toEqual({ k: "prim", type: "number" });
    }
  });

  it("deep unify: Map<K,V> pattern binds from Map<string, number>", () => {
    const K = tvar("K");
    const V = tvar("V");
    // pattern Map with __key/__value vars (same as absMapType)
    const pattern = abs(
      {
        k: "brand",
        name: "Map",
        shape: abs(
          {
            k: "obj",
            slots: {
              __key: { value: K },
              __value: { value: V },
            },
          },
          undefined,
          undefined,
          "path",
        ),
      },
      undefined,
      undefined,
      "path",
    );
    const f = relationFn([pattern], V);
    const arg = abs(
      {
        k: "brand",
        name: "Map",
        shape: abs(
          {
            k: "obj",
            slots: {
              __key: { value: prim("string") },
              __value: { value: prim("number") },
            },
          },
          undefined,
          undefined,
          "exact",
        ),
      },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(f, [arg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("nested Promise<Map<string, number>> maps both levels", () => {
    const files = [
      writeTemp(
        "pm.d.ts",
        `export declare function loadMap(): Promise<Map<string, number>>;
`,
      ),
    ];
    const env = harvestDts(files);
    const fn = env.globals.loadMap!;
    const rel = getFnImpl(fn)!.relation!;
    expect(rel.returnType.shape.k).toBe("eff");
    if (rel.returnType.shape.k !== "eff") return;
    expect(rel.returnType.shape.inner.shape.k).toBe("brand");
  });
});

function writeTemp(name: string, content: string): string {
  const { mkdtempSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nudo-mappromise-"));
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}
