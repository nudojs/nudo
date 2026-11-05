/**
 * dts 导出面 / 类投影 / 再导出面回归钉（族 15 · S1）。
 *
 * 覆盖 Bug 514（default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、
 * 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级
 * `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、
 * 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。
 *
 * 投影入口与 CLI `export --format dts` 同口径：模块面（dtsModuleSurface）
 * + 逐函数投影（projectFunctionDts）+ 模块合成（projectModuleDts）。
 */
import { describe, it, expect } from "vitest";
import { localNamedExports } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import {
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
} from "../dts-generator.ts";

/** CLI export 面筛选（与 packages/nudojs/src/commands/export.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name)) return true;
    if (name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    if (m && entryNames.has(m[1])) return true;
    return false;
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, path = "/test/surface.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("dts 导出面（S1）", () => {
  it("Bug 514：default（匿名 / 箭头）导出进 dts", () => {
    const anon = moduleDts(`export default function (x) {
  return x + 1;
}
`);
    expect(anon).toMatch(/export default function \(x: (any|unknown)\): .*;/);
    const arrow = moduleDts(`export default (x) => x + 1;
`);
    expect(arrow).toMatch(/export default function \(x: (any|unknown)\): .*;/);
  });

  it("Bug 514：CJS 绑定（exports.compute）进 dts", () => {
    const dts = moduleDts(`exports.compute = (a, b) => a + b;
`);
    expect(dts).toContain("export declare function compute(");
    expect(dts).not.toContain("No exported");
  });

  it("Bug 514：const + export list 绑定进 dts", () => {
    const dts = moduleDts(`const greet = function () {
  return "hi";
};
export { greet };
`);
    expect(dts).toContain("export declare function greet(");
  });

  it("Bug 515：default 具名导出写成 export default function", () => {
    const dts = moduleDts(`export default function addOne(x) {
  return x + 1;
}
`);
    expect(dts).toContain("export default function addOne(");
    expect(dts).not.toContain("export declare function addOne");
  });

  it("Bug 515：别名导出按导出名声明（internal 不是导出名）", () => {
    const dts = moduleDts(`const internal = (x) => x + 1;
export { internal as publicName };
`);
    expect(dts).toContain("export { internal as publicName };");
    expect(dts).not.toContain("export declare function internal");
    expect(dts).not.toContain("export declare function publicName");
  });

  it("Bug 517：brand 引用的类被声明（不再 TS2304）", () => {
    const dts = moduleDts(`export class User {
  constructor(name) {
    this.name = name;
  }
}
export function makeUser(name) {
  return new User(name);
}
`);
    expect(dts).toContain("class User");
    expect(dts).toMatch(/makeUser\([^)]*\): User;/);
  });

  it("Bug 518：类方法不是模块级导出（没有 C_m 顶层导出）", () => {
    const dts = moduleDts(`export class C {
  m(x) {
    return x + 1;
  }
}
`);
    expect(dts).not.toContain("C_m");
    expect(dts).not.toContain("export declare function C_m");
    expect(dts).toMatch(/m\(x: (any|unknown)\): unknown;/);
  });

  it("Bug 550：类本身 + 构造器 + 静态方法进 dts", () => {
    const dts = moduleDts(`export class C {
  constructor(v) {
    this.v = v;
  }
  m(x) {
    return x + 1;
  }
  static s(x) {
    return x + 2;
  }
}
`);
    expect(dts).toContain("export declare class C {");
    // BUG-003：类形参无类型证据 ⇒ 按 `any` 口径（CLAUDE.md：入口**无约束**
    // 形参显示 any；`unknown` 只表示推断失败），并与 check 签名面一致。
    expect(dts).toContain("constructor(v: any);");
    expect(dts).toMatch(/m\(x: (any|unknown)\): unknown;/);
    expect(dts).toMatch(/static s\(x: (any|unknown)\): unknown;/);
  });

  it("Bug 939：再导出面（export * from / export {x} from）进 dts", () => {
    const dts = moduleDts(`export * from "./dep.js";
export { helper } from "./dep.js";
export function own(n) {
  return n * 3;
}
`);
    expect(dts).toContain(`export * from "./dep.js";`);
    expect(dts).toContain(`export { helper } from "./dep.js";`);
    expect(dts).toContain("export declare function own(");
  });

  it("模块面：导出名表（导出名 → 本地绑定）", () => {
    const surface = dtsModuleSurface(`const internal = (x) => x + 1;
export { internal as publicName };
export default function addOne(x) {
  return x + 1;
}
export function plain() {}
`);
    expect(surface.exportBindings.get("publicName")).toBe("internal");
    expect(surface.exportBindings.get("default")).toBe("addOne");
    expect(surface.exportBindings.get("plain")).toBe("plain");
  });

  it("模块面：类面（导出名 + 成员 + 构造器形参）", () => {
    const surface = dtsModuleSurface(`export class C {
  constructor(v) {}
  m(x) {}
  static s(x) {}
}
`);
    const cls = surface.classes.get("C");
    expect(cls?.exportName).toBe("C");
    expect(cls?.ctorParams).toEqual(["v"]);
    expect(cls?.instanceMethods.map((m) => m.name)).toEqual(["m"]);
    expect(cls?.staticMethods.map((m) => m.name)).toEqual(["s"]);
  });

  it("Bug 550：default 类与别名类按导出名声明", () => {
    const def = moduleDts(`export default class D {
  m(x) {
    return x + 1;
  }
}
`);
    expect(def).toContain("export default class D {");
    const alias = moduleDts(`class A {
  m(x) {
    return x + 1;
  }
}
export { A as Public };
`);
    expect(alias).toContain("declare class A {");
    expect(alias).toContain("export { A as Public };");
    expect(alias).not.toContain("export declare function A");
  });

  // ── 负控制：本条修复不该波及的邻近形态 ──────────────────────────
  it("负控制：非导出的顶层函数不进 dts（导出面过滤不变）", () => {
    const dts = moduleDts(`export function public1(x) {
  return x + 1;
}
function helper(x) {
  return x + 2;
}
`);
    expect(dts).toContain("export declare function public1(");
    expect(dts).not.toContain("helper");
  });

  it("负控制：未导出的类不进 dts（只有导出面进类声明）", () => {
    const dts = moduleDts(`class Hidden {
  m(x) {
    return x + 1;
  }
}
export function plain(x) {
  return x + 2;
}
`);
    expect(dts).toContain("export declare function plain(");
    expect(dts).not.toContain("Hidden");
  });

  it("负控制：无模块面时类方法沿用历史 Class_method 投影（#494 口径）", () => {
    const source = `export class C {
  m(x) {
    return x + 1;
  }
}
`;
    const result = analyzeFile("/test/no-surface.js", source);
    const fn = result.functions.find((f) => f.name === "C.m");
    expect(fn).toBeDefined();
    const proj = projectFunctionDts(fn!);
    expect(proj.lines.join("\n")).toMatch(/export declare function C_m\b/);
    expect(proj.lines.join("\n")).not.toMatch(/C\.m/);
  });

  it("负控制：非法标识符名仍被清洗（#494 双保险不变）", () => {
    const fn = {
      name: "a-b",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      paramNames: ["x"],
      cases: [
        {
          name: "entry@L1",
          argAbs: [],
          abs: { shape: { k: "prim", type: "number" } } as never,
          throwsAbs: { shape: { k: "never" } } as never,
        },
      ],
    } as unknown as Parameters<typeof projectFunctionDts>[0];
    const proj = projectFunctionDts(fn);
    expect(proj.lines.join("\n")).toMatch(/export declare function a_b\b/);
  });
});
