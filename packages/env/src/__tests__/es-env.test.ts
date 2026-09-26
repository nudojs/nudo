import { describe, it, expect } from "vitest";
import { defineEnv } from "../es.ts";
import {
  formatShape,
  litValue,
  getFnImpl,
  numLit,
  strLit,
  boolLit,
} from "@nudojs/core";
import type { Abs } from "@nudojs/core";

/**
 * ES env face (packages/env/src/es.ts) — load + high-frequency builtins.
 * Asserts Abs-native signatures exist (shape-level; not full ES soundness).
 * Style mirrors node-env-gaps.test.ts.
 */

type Env = ReturnType<typeof defineEnv>;

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

/** clean = format 串不含 unknown/any 叶子 token */
function expectLeafClean(fmt: string, label: string): void {
  expect(fmt, `${label} should not mention unknown/any`).not.toMatch(
    /(^|[^\w])(unknown|any)([^\w]|$)/,
  );
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs | undefined;
    }
    if (!cur || cur.shape.k !== "obj") return undefined;
    const slot = cur.shape.slots[k];
    cur = slot?.value;
  }
  return cur;
}

function globalOf(env: Env, name: string): Abs {
  const g = env.globals[name];
  expect(g, `global "${name}" missing`).toBeTruthy();
  return g!;
}

describe("es env load + key builtins", () => {
  const env = defineEnv();

  it("loads without throwing and exposes a globals table", () => {
    expect(env).toBeTruthy();
    expect(env.globals).toBeTypeOf("object");
    expect(Object.keys(env.globals).length).toBeGreaterThan(15);
    expect(env.modules).toBeUndefined();
  });

  it("JSON.parse / JSON.stringify are typed functions", () => {
    const JSON_ = globalOf(env, "JSON");
    const parse = walk(JSON_, "parse");
    const stringify = walk(JSON_, "stringify");
    expect(shapeOf(parse, "JSON.parse")).toContain("=>");
    expect(shapeOf(stringify, "JSON.stringify")).toContain("=>");
    // stringify literal folds to a string Abs
    const impl = getFnImpl(stringify!);
    expect(impl).toBeTruthy();
    const folded = impl!.apply!([globalOf(env, "undefined")]);
    // undefined → JSON.stringify(undefined) === undefined → undef leaf
    expect(folded).toBeTruthy();
  });

  it("Math exposes high-frequency numeric ops + constants", () => {
    const Math_ = globalOf(env, "Math");
    for (const name of [
      "abs",
      "ceil",
      "floor",
      "round",
      "max",
      "min",
      "pow",
      "sqrt",
      "random",
    ] as const) {
      const fn = walk(Math_, name);
      expect(shapeOf(fn, `Math.${name}`)).toContain("=>");
      expectLeafClean(shapeOf(fn, `Math.${name}`), `Math.${name}`);
    }
    for (const name of ["PI", "E"] as const) {
      const c = walk(Math_, name);
      expect(shapeOf(c, `Math.${name}`)).toContain("number");
    }
    // literal folding: Math.floor(3.7) → 3
    const floor = walk(Math_, "floor")!;
    const impl = getFnImpl(floor)!;
    const folded = impl.apply!([numLit(3.7)]);
    expect(litValue(folded!)).toBe(3);
  });

  it("Number static checks and parseInt/parseFloat are present", () => {
    const Number_ = globalOf(env, "Number");
    for (const name of [
      "isFinite",
      "isInteger",
      "isNaN",
      "isSafeInteger",
      "parseFloat",
      "parseInt",
    ] as const) {
      expect(shapeOf(walk(Number_, name), `Number.${name}`)).toContain("=>");
    }
    for (const name of [
      "MAX_SAFE_INTEGER",
      "MIN_SAFE_INTEGER",
      "NaN",
      "EPSILON",
    ] as const) {
      expect(shapeOf(walk(Number_, name), `Number.${name}`)).toContain("number");
    }
  });

  it("Promise statics return promise-shaped results", () => {
    const Promise_ = globalOf(env, "Promise");
    const resolve = walk(Promise_, "resolve");
    expect(shapeOf(resolve, "Promise.resolve")).toContain("=>");
    expect(shapeOf(walk(Promise_, "reject"), "Promise.reject")).toContain("=>");
    expect(shapeOf(walk(Promise_, "all"), "Promise.all")).toContain("=>");
    expect(shapeOf(walk(Promise_, "race"), "Promise.race")).toContain("=>");
  });

  it("console methods are void functions", () => {
    const console_ = globalOf(env, "console");
    for (const name of ["log", "error", "warn", "info", "assert"] as const) {
      const fn = walk(console_, name);
      expect(shapeOf(fn, `console.${name}`)).toContain("=>");
    }
  });

  it("Error family constructors carry Error brands", () => {
    for (const name of [
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "URIError",
    ] as const) {
      const s = shapeOf(globalOf(env, name), name);
      expect(s).toContain(name);
      expectLeafClean(s, name);
    }
  });

  it("Array.isArray + Reflect high-frequency ops resolve", () => {
    const Array_ = globalOf(env, "Array");
    expect(shapeOf(walk(Array_, "isArray"), "Array.isArray")).toContain("=>");
    const Reflect_ = globalOf(env, "Reflect");
    for (const name of ["get", "set", "has", "apply", "ownKeys"] as const) {
      expect(shapeOf(walk(Reflect_, name), `Reflect.${name}`)).toContain("=>");
    }
  });

  it("global numeric/URI helpers are typed", () => {
    for (const name of [
      "parseInt",
      "parseFloat",
      "isNaN",
      "isFinite",
      "encodeURI",
      "decodeURI",
      "encodeURIComponent",
      "decodeURIComponent",
    ] as const) {
      const s = shapeOf(globalOf(env, name), name);
      expect(s).toContain("=>");
    }
    expect(shapeOf(globalOf(env, "NaN"), "NaN")).toContain("number");
    expect(shapeOf(globalOf(env, "Infinity"), "Infinity")).toContain("number");
  });

  it("Boolean/String coercions fold on literals", () => {
    const booleanFn = globalOf(env, "Boolean");
    const impl = getFnImpl(booleanFn)!;
    expect(litValue(impl.apply!([strLit("x")])!)).toBe(true);
    const stringFn = globalOf(env, "String");
    const sImpl = getFnImpl(stringFn)!;
    expect(litValue(sImpl.apply!([boolLit(false)])!)).toBe("false");
  });
});
