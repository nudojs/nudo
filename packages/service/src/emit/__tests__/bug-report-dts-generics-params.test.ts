/**
 * 缺陷报告分册 05-dts-fidelity —— 泛型 / 类型形参 / 形参可省性 / 超类。
 *
 * 覆盖：Bug 49（namespace 限定超类）、Bug 57（函数 / 方法级类型形参槽）、
 * Bug 70（默认值 + 后随 rest 的可省性）、Bug 71（构造器 / static 默认值）、
 * Bug 73（导入泛型基类的类型实参）、Bug 74（类类型形参默认值）。
 *
 * 用 CLI 同一条模块面投影链 + 真 tsc --noEmit --strict 校验产物 / 消费端。
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

function moduleDts(source: string, path = "/test/bug-report-generics.ts"): string {
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

describe("Bug 49 —— `extends NS.Base` 不再整条消失", () => {
  const SRC = `import DBase, { Base } from "./base.js";
import * as NS from "./base.js";
export class Sub extends Base { s() { return 3; } }
export class DSub extends DBase { s() { return 4; } }
export class NSub extends NS.Base { s() { return 5; } }
export function anchor(x) { return x; }
`;
  const BASE_DTS = `export declare class Base { b(): unknown; }
export default class DBase { d(): unknown; }
`;

  it("保留 extends NS.Base 并补 import * as NS", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare class NSub extends NS.Base {");
    expect(dts).toContain('import * as NS from "./base.js";');
    // 同模块的 Identifier / default import 基类照旧保留
    expect(dts).toContain("export declare class Sub extends Base {");
    expect(dts).toContain("export declare class DSub extends DBase {");
  });

  it("消费端能访问继承来的 b()（改前 TS2339）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "base.d.ts": BASE_DTS,
      "use.ts":
        'import { NSub } from "./mod.js";\ndeclare const n: NSub;\nexport const b = n.b();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 57 —— 函数 / 方法级类型形参槽", () => {
  const SRC = `export class Box<T> {
  constructor(public v: T) {}
}
export function gen<T>(x: T): T { return x; }
export function pair<A, B>(a: A, b: B): [A, B] { return [a, b]; }
`;

  it("函数声明带 <T> / <A, B>，类级 <T> 保留", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare function gen<T>(");
    expect(dts).toContain("export declare function pair<A, B>(");
    expect(dts).toContain("export declare class Box<T> {");
  });

  it("消费端显式类型实参通过 tsc（改前 TS2558 ×2）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Box, gen, pair } from "./mod.js";\nexport const boxed = new Box<number>(1);\nexport const g = gen<string>("x");\nexport const p = pair<number, string>(1, "s");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("类方法自己的 <U> 也保留", () => {
    const dts = moduleDts(`export class C { m<U>(x: U): U { return x; } }
`);
    expect(dts).toMatch(/\bm<U>\(/);
  });
});

describe("Bug 70 —— 后随 rest 的默认形参仍可省", () => {
  const SRC = `export function f(a = 1, ...rest) { return [a, rest]; }
export class C { m(a = 1, ...rest) { return [a, rest]; } }
`;

  it("默认形参渲染成 `a?:`，不是 `a: … | undefined`", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("f(a?: unknown, ...rest: unknown[])");
    expect(dts).toContain("m(a?: unknown, ...rest: unknown[])");
    expect(dts).not.toContain("a: unknown | undefined");
  });

  it("消费端 f() / c.m() 通过 tsc（改前 TS2555）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { f, C } from "./mod.js";\nexport const a = f();\nexport const b = f(1);\nexport const c = new C().m();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 71 —— 构造器 / static 方法默认值不丢", () => {
  const SRC = `export class C {
  constructor(a = 1) { this.a = a; }
  static make(x = 2) { return new C(); }
  inst(y = 3) { return y; }
}
`;

  it("构造器 / static 形参带 `?`（与实例位一致）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("constructor(a?: unknown);");
    expect(dts).toContain("static make(x?: unknown): unknown;");
    expect(dts).toContain("inst(y?: unknown)");
  });

  it("消费端 new C() / C.make() 通过 tsc（改前 TS2554）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { C } from "./mod.js";\nexport const c = new C();\nexport const d = C.make();\nexport const e = new C().inst();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 73 —— 导入的泛型基类保留类型实参", () => {
  const SRC = `import { Base } from "./base.js";
export class Derived extends Base<string> { y: number = 1; z(): number { return this.y; } }
`;

  it("`extends Base<string>` 不是 `extends Base`", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare class Derived extends Base<string> {");
    expect(dts).not.toMatch(/extends Base \{/);
  });

  it("产物自身过 tsc（改前 TS2314）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "base.d.ts": "export declare class Base<T> { t: T; get(): T; }\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 74 —— 类类型形参默认值", () => {
  const SRC = `export class Box<T = string> {
  value: T = "x" as T;
  get(): T { return this.value; }
}
export function mk(): Box { return new Box(); }
`;

  it("`class Box<T = string>` 不是 `class Box<T>`", () => {
    expect(moduleDts(SRC)).toContain("export declare class Box<T = string> {");
  });

  it("裸泛型引用 `mk(): Box` 不再让产物 TS2314", () => {
    const check = tscNoEmit({ "mod.d.ts": moduleDts(SRC) });
    expect(check.ok, check.stderr).toBe(true);
  });
});
