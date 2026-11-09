/**
 * 缺陷报告分册 06-module-boundary —— 模块边界与导出扫描（dts 产物面回归）。
 *
 * 覆盖：Bug 61（`export const C = class {}` 落成 `const C: unknown`）、
 * Bug 62（CJS 值导出在 dts 面整体缺席 / 值-only 空产物）、Bug 63（解构导出
 * 绑定在 dts 面整体缺席）、Bug 64（未导出内部基类发成 `declare class Base {}`）。
 *
 * 用 CLI 同一条模块面投影链 + 真 tsc --noEmit --strict 校验消费端。
 */
import { describe, it, expect } from "vitest";
import { localNamedExports, type Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import {
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
} from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

function moduleDts(source: string, path = "/test/mb/mod.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return projectModuleDts(surface, entries, { values }).lines.join("\n");
}

// ---------------------------------------------------------------------------
// Bug 61 — 类表达式
// ---------------------------------------------------------------------------
describe("Bug 61 — export const C = class {} 在 dts 面是类，不是 unknown", () => {
  const SRC = `export const C = class {
  constructor() { throw new TypeError("boom"); }
};
export const D = class {
  m() { throw new RangeError("r"); }
};
`;

  it("类表登记 C / D（不是只走 const 值通道）", () => {
    const surface = dtsModuleSurface(SRC);
    expect(surface.classes.has("C")).toBe(true);
    expect(surface.classes.has("D")).toBe(true);
  });

  it("产物含可 new 的类声明，不再是 const C: unknown", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("declare class C");
    expect(dts).toContain("declare class D");
    expect(dts).not.toContain("const C: unknown");
    expect(dts).not.toContain("const D: unknown");
  });

  it("消费端 new C() / new D().m() 通过 tsc（不再 TS18046）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { C, D } from "./mod.js";\nconst c = new C();\nconst d = new D();\nd.m();\nexport { c, d };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 62 — CJS 值导出
// ---------------------------------------------------------------------------
describe("Bug 62 — CJS 值导出进 dts 值声明", () => {
  const VALS = `exports.num = 1;
exports.str = "s";
exports.obj = { a: 1 };
exports.arr = [1, 2];
exports.fn = function fn(x) { return x; };
`;
  const ONLY = `exports.num = 1;
exports.str = "s";
`;

  it("exportBindings 与 values 都登记四个值导出（不再只 bind）", () => {
    const surface = dtsModuleSurface(VALS);
    for (const name of ["num", "str", "obj", "arr"]) {
      expect(surface.exportBindings.has(name)).toBe(true);
      expect(surface.values.has(name)).toBe(true);
    }
  });

  it("产物发射四个值声明，类型不再是 TS2305", () => {
    const dts = moduleDts(VALS, "/test/mb/vals.cjs");
    expect(dts).toContain("export declare const num: number;");
    expect(dts).toContain("export declare const str: string;");
    expect(dts).toContain("export declare const obj: { a: number };");
    expect(dts).toContain("export declare const arr: number[];");
  });

  it("值-only 模块有值声明 ⇒ 不触发空产物早退", () => {
    expect(dtsModuleSurface(ONLY).values.size).toBeGreaterThan(0);
    const dts = moduleDts(ONLY, "/test/mb/only.cjs");
    expect(dts).toContain("export declare const num: number;");
    expect(dts).toContain("export declare const str: string;");
  });

  it("消费端 import { num, str, obj, arr } 通过 tsc", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(VALS, "/test/mb/vals.cjs"),
      "use.ts":
        'import { num, str, obj, arr } from "./mod.js";\nexport const a: number = num;\nexport const b: string = str;\nexport const c: { a: number } = obj;\nexport const d: number[] = arr;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 63 — 解构导出绑定
// ---------------------------------------------------------------------------
describe("Bug 63 — 解构导出绑定进 dts 面", () => {
  const SRC = `const src = { a: 1, b: "s" };
export const { a, b } = src;
const arr = [1, 2, 3];
export const [c, ...rest] = arr;
export const plain = 9;
`;
  const ONLY = `const src = { a: 1, b: "s" };
export const { a, b } = src;
`;

  it("exportBindings / values 展开 ObjectPattern 与 ArrayPattern（含 RestElement）", () => {
    const surface = dtsModuleSurface(SRC);
    for (const name of ["a", "b", "c", "rest", "plain"]) {
      expect(surface.exportBindings.has(name)).toBe(true);
      expect(surface.values.has(name)).toBe(true);
    }
  });

  it("四个解构绑定各有声明（不再只剩 plain）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare const a: number;");
    expect(dts).toContain("export declare const b: string;");
    expect(dts).toContain("export declare const c: number;");
    expect(dts).toContain("export declare const rest: number[];");
  });

  it("解构-only 模块也有产物（不空早退）", () => {
    expect(dtsModuleSurface(ONLY).values.size).toBeGreaterThan(0);
    expect(moduleDts(ONLY)).toContain("export declare const a: number;");
  });

  it("消费端 import { a, b, c, rest, plain } 通过 tsc（不再 TS2305）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { a, b, c, rest, plain } from "./mod.js";\nexport const A: number = a;\nexport const B: string = b;\nexport const C: number = c;\nexport const R: number[] = rest;\nexport const P: number = plain;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 64 — 未导出内部基类
// ---------------------------------------------------------------------------
describe("Bug 64 — 内部基类的继承方法在 dts 面可见", () => {
  const SRC = `class Base {
  m() { throw new TypeError("boom"); }
  n() { return 1; }
}
export class Derived extends Base {
  k() { return 2; }
}
`;

  it("非导出基类 Base 的类面带自己的实例方法 m / n", () => {
    const base = dtsModuleSurface(SRC).classes.get("Base");
    expect(base).toBeDefined();
    const names = (base?.instanceMethods ?? []).map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["m", "n"]));
  });

  it("产物里 m / n 可见（不再 declare class Base {}）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toMatch(/\bm\(\s*\):/);
    expect(dts).toMatch(/\bn\(\s*\):/);
  });

  it("消费端 d.n() / d.m() 通过 tsc（不再 TS2339）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Derived } from "./mod.js";\nconst d = new Derived();\nd.k();\nd.n();\nd.m();\nexport { d };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});
