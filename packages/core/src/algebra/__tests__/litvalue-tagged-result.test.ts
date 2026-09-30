/**
 * FIX-D4 / DESIGN-001：litValue tagged result 回归。
 *
 * `litValue(): { ok: true; value: LiteralValue } | { ok: false }`：
 * 「无字面量」与「字面量 undefined」必须可区分；禁止用 `value !== undefined`
 * 判是否是字面量。本文件覆盖 lit(undefined) / lit(NaN) / bigint 全路径。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  bigintLit,
  callTranspiledExportFull,
  litValue,
  numLit,
  runTranspiled,
  unknown,
  type Abs,
  type LiteralValue,
  type LitValueResult,
} from "../index.ts";
import { lit } from "../term.ts";

function call(src: string, fnName = "f", args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

function okVal(v: LiteralValue): LitValueResult {
  return { ok: true, value: v };
}

describe("litValue tagged result: lit(undefined) vs no-literal", () => {
  it("lit(undefined) is ok:true value:undefined — not ok:false", () => {
    const u = abs({ k: "unknown" }, lit(undefined), undefined, "exact");
    expect(litValue(u)).toEqual(okVal(undefined));
    expect(litValue(u).ok).toBe(true);
  });

  it("abstract / non-lit Abs is ok:false", () => {
    expect(litValue(unknown)).toEqual({ ok: false });
    expect(litValue(numLit(1)).ok).toBe(true);
    const varAbs = abs({ k: "prim", type: "number" }, { op: "var", id: "x" }, undefined, "path");
    expect(litValue(varAbs)).toEqual({ ok: false });
  });

  it("undefined === undefined identity fold works via Object.is on values", () => {
    const r = call(`export function f() { return undefined === undefined; }`);
    expect(litValue(r.result)).toEqual(okVal(true));
  });

  it("map.get miss returns lit(undefined) — tagged ok:true", () => {
    const r = call(`export function f() { const m = new Map(); m.set("a", 1); return m.get("zzz"); }`);
    expect(litValue(r.result)).toEqual(okVal(undefined));
  });

  it("OOB array/tuple index returns lit(undefined) — tagged ok:true", () => {
    const r = call(`export function f() { return [1,2,3][10]; }`);
    expect(litValue(r.result)).toEqual(okVal(undefined));
    const r2 = call(`export function f() { return Array.of(3)[1]; }`);
    expect(litValue(r2.result)).toEqual(okVal(undefined));
  });

  it("missing object property returns lit(undefined) — tagged ok:true", () => {
    const r = call(`export function f() { return ({a:1}).b; }`);
    expect(litValue(r.result)).toEqual(okVal(undefined));
  });

  it("optional chain short-circuit returns lit(undefined) — tagged ok:true", () => {
    const r = call(`export function f(o) { return o?.x; }`, "f", [
      abs({ k: "unknown" }, lit(null), undefined, "exact"),
    ]);
    expect(litValue(r.result)).toEqual(okVal(undefined));
  });
});

describe("litValue tagged result: lit(NaN) SameValue", () => {
  it("lit(NaN) is ok:true value:NaN", () => {
    const n = numLit(NaN);
    const r = litValue(n);
    expect(r.ok).toBe(true);
    expect(r.ok && Number.isNaN(r.value as number)).toBe(true);
  });

  it("NaN === NaN folds false but x === x on NaN literal folds false", () => {
    const r = call(`export function f() { return NaN === NaN; }`);
    expect(litValue(r.result)).toEqual(okVal(false));
    const r2 = call(`export function f(x) { return x === x; }`, "f", [numLit(NaN)]);
    expect(litValue(r2.result)).toEqual(okVal(false));
  });

  it("lit(NaN) domain membership uses SameValue (Object.is) like leqAbs", () => {
    const r = call(`export function f() { return Number.isNaN(NaN); }`);
    expect(litValue(r.result)).toEqual(okVal(true));
    const r2 = call(`export function f() { return Object.is(NaN, NaN); }`);
    expect(litValue(r2.result)).toEqual(okVal(true));
  });

  it("formatShape renders NaN as NaN not null", () => {
    const r = litValue(numLit(NaN));
    expect(r.ok && Number.isNaN(r.value as number)).toBe(true);
  });
});

describe("litValue tagged result: bigint full path", () => {
  it("bigintLit produces ok:true bigint value (no as never)", () => {
    const b = bigintLit(10n);
    const r = litValue(b);
    expect(r).toEqual(okVal(10n));
    expect(r.ok && typeof r.value).toBe("bigint");
  });

  it("1n + 2n folds to bigint literal 3n", () => {
    const r = call(`export function f() { return 1n + 2n; }`);
    expect(litValue(r.result)).toEqual(okVal(3n));
  });

  it("bigint mixed with number throws TypeError (catchable)", () => {
    const r = call(
      `export function f() { try { return 1n + 1; } catch(e) { return e.constructor.name; } }`,
    );
    expect(litValue(r.result)).toEqual(okVal("TypeError"));
  });

  it("bigint string concat uses ToString: 10n + '' === '10'", () => {
    const r = call(`export function f() { return 10n + ''; }`);
    expect(litValue(r.result)).toEqual(okVal("10"));
  });

  it("typeof 1n is bigint", () => {
    const r = call(`export function f() { return typeof 1n; }`);
    expect(litValue(r.result)).toEqual(okVal("bigint"));
  });

  it("-1n folds to -1n; ~1n folds to -2n", () => {
    const r = call(`export function f() { return -1n; }`);
    expect(litValue(r.result)).toEqual(okVal(-1n));
    const r2 = call(`export function f() { return ~1n; }`);
    expect(litValue(r2.result)).toEqual(okVal(-2n));
  });
});

describe("litValue tagged result: compile-time shape", () => {
  it("result is discriminated union — .ok narrows .value", () => {
    const r = litValue(numLit(1));
    if (r.ok) {
      // r.value is LiteralValue here (including bigint / undefined)
      const v: LiteralValue = r.value;
      expect(v).toBe(1);
    } else {
      throw new Error("expected ok");
    }
  });

  it("lit(undefined) value is assignable to LiteralValue (undefined is a value)", () => {
    const r = litValue(abs({ k: "unknown" }, lit(undefined), undefined, "exact"));
    if (!r.ok) throw new Error("expected ok");
    const v: LiteralValue = r.value; // undefined is a legal LiteralValue
    expect(v).toBeUndefined();
  });
});
