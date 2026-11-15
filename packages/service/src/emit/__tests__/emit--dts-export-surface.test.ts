/**
 * 缺陷报告分册 05-dts-fidelity —— 导出面 / 默认导出 / 再导出 / 顶层类型 / enum。
 *
 * 覆盖：Bug 11（Unicode 导出名）、Bug 12A（匿名默认类）、Bug 19
 * （`export * as ns from`）、Bug 20（非函数 default 表达式）、Bug 22
 * （顶层 export interface / type）、Bug 25（const enum）、Bug 30
 * （再导出字符串名引号）。
 *
 * 用 CLI 同一条模块面投影链（analyzeFile → dtsModuleSurface →
 * projectFunctionDts → projectModuleDts）+ 真 tsc --noEmit --strict 校验产物。
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

/** CLI export 面筛选（与 packages/nudojs/src/commands/export/dts-face.ts 同口径）。 */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** CLI `export --format dts` 的产品面路径（值类型来自分析面 bindings）。 */
function moduleDts(source: string, path = "/test/bug-report-export.ts"): string {
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

describe("Bug 11 —— Unicode 导出名原样保留", () => {
  const SRC = `export function café(x) { return x; }
export const 日本 = 1;
`;

  it("dts 不再把合法 Unicode 绑定名洗成 ASCII", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare function café(");
    expect(dts).not.toContain("caf_");
    expect(dts).toContain("export declare const 日本: number;");
  });

  it("消费端 `import { café }` 通过 tsc（改前 TS2305）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import { café, 日本 } from "./mod.js";\nexport const y = café(1);\nexport const z: number = 日本;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 12A —— 匿名默认类产出合法 ambient 声明", () => {
  const SRC = `export default class { m() { return 1; } }
`;

  it("不是 `declare class default`（保留字当类名）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export default class _default {");
    expect(dts).not.toContain("class default");
    // Bug 39 补齐类方法入口兜底后返回类型从 unknown 变精确值（此处为
    // number）；本例钉的是匿名默认类的**类名合法性**，不钉返回类型。
    expect(dts).toMatch(/m\(\): [^;]+;/);
  });

  it("产物过 tsc --noEmit --strict（改前 TS1005）", () => {
    const check = tscNoEmit({ "mod.d.ts": moduleDts(SRC) });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 19 —— `export * as ns from` 发射合法语法", () => {
  const SRC = `export * as ns from "./a.js";
export function anchor(x) { return x; }
`;

  it("用 `export * as ns from`，不是 `export { * as ns } from`", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain('export * as ns from "./a.js";');
    expect(dts).not.toContain("export { * as ns }");
    expect(dts).not.toContain("{ * as");
  });

  it("产物过 tsc（改前 TS1003/1005/1128/1434）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "a.d.ts": "export declare function f(): number;\n",
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 20 —— 非函数 / 非标识符 default 表达式不消失", () => {
  const SRC = `export default 42;
export function f() { return 1; }
`;

  it("发射 default 值绑定（改前整条消失）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("declare const _default: number;");
    expect(dts).toContain("export { _default as default };");
  });

  it("消费端 `import v from` 通过 tsc（改前 TS1192）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import v from "./mod.js";\nexport const x: number = v;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 22 —— 顶层 export interface / export type 进产物", () => {
  const SRC = `export interface Top { b: number }
export type Alias = number;
export namespace NS { export interface Inner { a: number } }
export function useTop(t: Top): Alias { return t.b; }
`;

  it("顶层类型声明原文镜像（namespace 内同名声明照旧保留）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export interface Top { b: number }");
    expect(dts).toContain("export type Alias = number;");
    expect(dts).toContain("export interface Inner { a: number }");
  });

  it("消费端 type import 通过 tsc（改前 TS2305）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import type { Top, Alias } from "./mod.js";\nexport const a: Top = { b: 1 };\nexport const b: Alias = 2;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 25 —— `export const enum` 保留 const 限定", () => {
  const SRC = `export const enum Mode { A = "a", B = "b" }
`;

  it("发射 `export declare const enum`（改前丢 const ⇒ 运行时 import 报错）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare const enum Mode {");
    expect(dts).toContain('A = "a",');
  });

  it("消费端 tsc 通过且 const enum 成员可内联使用", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "use.ts": 'import { Mode } from "./mod.js";\nexport const a = Mode.A;\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});

describe("Bug 30 —— 再导出字符串导出名走 exportNameRepr", () => {
  const SRC = `export { f as "a-b" } from "./a.js";
export function anchor(x) { return x; }
`;

  it(`\`as "a-b"\` 不丢引号`, () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain('export { f as "a-b" } from "./a.js";');
    expect(dts).not.toContain("f as a-b");
  });

  it("产物过 tsc（改前 TS1005×3）", () => {
    const check = tscNoEmit({
      "mod.d.ts": moduleDts(SRC),
      "a.d.ts": "export declare function f(x: unknown): unknown;\n",
      "use.ts": 'import { "a-b" as ab } from "./mod.js";\nexport const z = ab(1);\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });
});
