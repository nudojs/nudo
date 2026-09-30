import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
  transpile,
} from "@nudojs/core";

describe("evaluator switch", () => {
  it("selects matching case by concrete disc", () => {
    const src = `
export function go(n) {
  switch (n) {
    case 1:
      return "one";
    case 2:
      return "two";
    default:
      return "other";
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(1)]).result)).toEqual({ ok: true, value: "one" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(2)]).result)).toEqual({ ok: true, value: "two" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(9)]).result)).toEqual({ ok: true, value: "other" });
  });

  it("handles fall-through", () => {
    const src = `
export function go(n) {
  switch (n) {
    case 1:
    case 2:
      return "small";
    case 3:
      return "three";
    default:
      return "big";
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(1)]).result)).toEqual({ ok: true, value: "small" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(2)]).result)).toEqual({ ok: true, value: "small" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(3)]).result)).toEqual({ ok: true, value: "three" });
  });

  it("abstract disc joins branches", () => {
    const src = `
export function go(n) {
  switch (n) {
    case 1:
      return 10;
    default:
      return 20;
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", [
      { shape: { k: "prim", type: "number" }, conf: "exact" },
    ]);
    // 抽象 number → join(10, 20) → 枚举 10 | 20
    const fmt = formatAbs(r.result);
    expect(fmt).toContain("10");
    expect(fmt).toContain("20");
  });

  it("transpiles switch to $switch", () => {
    const out = transpile(`export function f(n) { switch (n) { case 1: return 1; default: return 0; } }`);
    expect(out).toContain("$switch(");
  });

  // switch case 匹配是严格相等（===），不是 SameValue：
  // NaN !== NaN（不匹配自身 case）；0 === -0（互相匹配）。
  const go1 = (src: string, arg: unknown) =>
    callTranspiledExportFull(runTranspiled(src, { mode: "analyze" }), "go", [arg as never]);

  it("NaN discriminant does not match NaN case (strict equality)", () => {
    const r = go1(
      `export function go(n) {
      switch (n) { case NaN: return "nan"; default: return "dflt"; }
    }`,
      $lit(NaN),
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "dflt" });
  });

  it("0 matches -0 case and vice versa (strict equality)", () => {
    const src = `export function go(n) {
      switch (n) { case -0: return "negzero"; default: return "dflt"; }
    }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(0)]).result)).toEqual({ ok: true, value: "negzero" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(-0)]).result)).toEqual({ ok: true, value: "negzero" });
    const src2 = `export function go(n) {
      switch (n) { case 0: return "zero"; default: return "dflt"; }
    }`;
    const exports2 = runTranspiled(src2, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports2, "go", [$lit(-0)]).result)).toEqual({ ok: true, value: "zero" });
  });

  it("NaN case does not match NaN expression (0/0)", () => {
    const r = go1(
      `export function go() {
      switch (0 / 0) { case NaN: return "nan"; default: return "dflt"; }
    }`,
      $lit(0),
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "dflt" });
  });

  it("string case matching is strict (no cross-type coercion)", () => {
    const exports = runTranspiled(
      `export function go(n) {
      switch (n) { case "1": return "str"; default: return "dflt"; }
    }`,
      { mode: "analyze" },
    );
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(1)]).result)).toEqual({ ok: true, value: "dflt" });
  });

  // R2B-002：litValue 哨兵——lit(undefined) 必须进精确匹配路径，
  // 且 case undefined 用 === 命中；旧写法 dv !== undefined 会落入 fork 近似。
  it("case undefined matches undefined discriminant exactly (not fork-join)", () => {
    const src = `export function go(n) {
      switch (n) { case 1: return 1; case undefined: return 2; default: return 3; }
    }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(undefined)]).result)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("case undefined does not match other discriminants", () => {
    const src = `export function go(n) {
      switch (n) { case undefined: return 2; default: return 3; }
    }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(1)]).result)).toEqual({ ok: true, value: 3 });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(null)]).result)).toEqual({ ok: true, value: 3 });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(undefined)]).result)).toEqual({
      ok: true,
      value: 2,
    });
  });
});
