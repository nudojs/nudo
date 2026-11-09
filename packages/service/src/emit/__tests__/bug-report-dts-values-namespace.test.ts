/**
 * 缺陷报告分册 05-dts-fidelity —— 模块级值绑定 / namespace 成员 / readonly。
 *
 * 覆盖：Bug 72（对象 / 数组常量不投成冻结字面量类型）、Bug 75（namespace
 * 成员注解引用的模块私有类型）、Bug 76（namespace 内 export class 非空体）、
 * Bug 77（readonly 类字段 / `as const`）。
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

function moduleDts(source: string, path = "/test/bug-report-values.ts"): string {
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

describe("Bug 72 —— 模块级可变容器不投成字面量类型", () => {
  const SRC = `export let config = { retries: 3, label: "x" };
export const empty = [];
export const nums = [1, 2, 3];
export const scalar = 42;
export const nested = { a: { b: 1 } };
`;

  it("对象槽 / 数组元素 / 元组按基类型投影，标量绑定照旧拓宽", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("config: { retries: number; label: string }");
    expect(dts).toContain("empty: unknown[];");
    expect(dts).toContain("nums: number[];");
    expect(dts).toContain("scalar: number;");
    expect(dts).toContain("nested: { a: { b: number } };");
    expect(dts).not.toContain("retries: 3");
  });

  it("消费端对合法写入不再报 TS2322 / TS2345", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { config, empty, nums, scalar } from "./mod.js";\nconfig.retries = 5;\nempty.push(1);\nnums[0] = 9;\nscalar.toFixed(1);\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 75 —— namespace 成员注解引用的私有类型可解析", () => {
  const SRC = `interface Hidden { a: number }
type LocalAlias = string;

export function topLevel(x: Hidden): number { return x.a; }
export const anchor = 1;
export namespace NS {
  export function f(x: Hidden): number { return x.a; }
  export function g(y: LocalAlias): LocalAlias { return y; }
}
`;

  it("私有 interface / type 别名补进产物（tsc --declaration 同口径）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("interface Hidden { a: number }");
    expect(dts).toContain("type LocalAlias = string;");
    expect(dts).toContain("export function f(x: Hidden): number;");
  });

  it("产物自身过 tsc（改前 TS2304 ×3）", () => {
    const check = tscNoEmit({ "mod.d.ts": moduleDts(SRC) });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 76 —— namespace 内 export class 不再是空类体", () => {
  const SRC = `export const anchor = 1;
export namespace NS {
  export class C {
    v: number = 1;
    m(): number { return this.v; }
  }
}
`;

  it("类体带字段与方法（ambient 声明体合法）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export class C {");
    expect(dts).toMatch(/v: number;/);
    expect(dts).toMatch(/m\(\): number;/);
    expect(dts).not.toMatch(/export class C \{\}/);
  });

  it("消费端 new NS.C().v / .m() 通过 tsc（改前 TS2339 ×2）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { NS } from "./mod.js";\nconst c = new NS.C();\nexport const v: number = c.v;\nexport const m: number = c.m();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 77 —— readonly 语义", () => {
  const SRC = `export class Counter { readonly count: number = 0; m(): number { return this.count; } }
export const CFG = { host: "h" } as const;
`;

  it("readonly 字段 / as const 对象槽都带修饰符，字面量精度保留", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("readonly count: number;");
    expect(dts).toContain('readonly host: "h"');
  });

  it("消费端对只读值的写入被 tsc 拦下（改前假绿）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts":
        'import { Counter, CFG } from "./mod.js";\nconst c = new Counter();\nc.count = 99;\nCFG.host = "h";\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2540");
  });
});
