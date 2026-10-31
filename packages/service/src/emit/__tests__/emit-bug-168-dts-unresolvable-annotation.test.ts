/**
 * BUG-168 — dts 面把 TS 注解原文抄进产物，却**不校验该名字在产物里可解析**
 * ⇒ 发布的 `.d.ts` 里出现从未声明的类型名（TS2304），且 `nudo export`
 * exit 0、零台账；同一形参 check 面说 `any`、dts 面说 `T`（两面相反）。
 *
 * 判据（本钉）：注解原文里的**类型名**必须在产物里可解析 ——
 *   本地 `declare class`（含未导出但被注解引用的类）/ 已 import 的名字 /
 *   TS 全局类型名（`Date` / `Record` / `Promise` …）才放行；
 *   类型形参（`<T>`）/ 本地 interface / type 别名 / 未导入的名字 ⇒ **不放行**，
 *   回落 `paramTypeFromAbs` 的观测口径（与 check 面一致）并留
 *   `nudo:dropped-type-annotation` 台账。
 */
import { describe, it, expect } from "vitest";
import { localNamedExports } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

/** CLI export 面筛选（与 packages/nudojs/src/commands/export.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name)) return true;
    if (name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI `export --format dts` 的产品面路径） */
function moduleDts(source: string, path = "/test/bug168-annotation.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("BUG-168 — 注解原文的类型名必须在产物里可解析", () => {
  it("泛型函数的类型形参不放行：`id<T>(x: T)` ⇒ `id(x: any)` + 台账", () => {
    const dts = moduleDts(`export function id<T>(x: T): T {
  return x;
}
`);
    expect(dts).toContain("export declare function id(x: any): any;");
    expect(dts).not.toContain("id(x: T)");
    expect(dts).toContain("nudo:dropped-type-annotation id.x: T");
  });

  it("多类型形参：`pair<A, B>` ⇒ 两个形参都回落观测口径（与 check 面同为 any）", () => {
    const dts = moduleDts(`export function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
`);
    expect(dts).toContain("export declare function pair(a: any, b: any): [any, any];");
    expect(dts).not.toContain("pair(a: A");
    expect(dts).not.toContain("b: B)");
  });

  it("本地 interface 不放行（产物不发射 interface 声明）⇒ 回落 + 台账", () => {
    const dts = moduleDts(`interface Point { x: number; y: number }
export function dist(p: Point): number {
  return p.x + p.y;
}
`);
    expect(dts).toContain("export declare function dist(p: any)");
    expect(dts).not.toContain("declare interface Point");
    expect(dts).toContain("nudo:dropped-type-annotation dist.p: Point");
  });

  it("TS 全局类型名照旧放行（Date / Record / Promise 不产生台账）", () => {
    const dts = moduleDts(`export function when(d: Date, o: Record<string, number>): Promise<number> {
  return Promise.resolve(d.getTime() + o.n);
}
`);
    expect(dts).toContain("d: Date");
    expect(dts).toContain("o: Record<string, number>");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("本地类（未导出）被注解引用 ⇒ 补 `declare class`（产物必须能解析该名）", () => {
    const dts = moduleDts(`class Helper {
  constructor() {
    this.n = 1;
  }
}
export function useHelper(h: Helper): number {
  return h.n;
}
`);
    expect(dts).toContain("declare class Helper {");
    expect(dts).toContain("export declare function useHelper(h: Helper)");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("别的模块的 import ⇒ 补 `import type`（否则消费方 TS2304）", () => {
    const dts = moduleDts(`import type { User } from "./types";
export function name(u: User): string {
  return String(u);
}
`);
    expect(dts).toContain('import type { User } from "./types";');
    expect(dts).toContain("export declare function name(u: User)");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "types.d.ts": "export type User = { id: number };\n",
      "use.ts": 'import { name } from "./mod.js";\nexport const s: string = name({ id: 1 });\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("泛型类保留类型形参槽（消费端 `new Box<string>` 不再 TS2558）", () => {
    const dts = moduleDts(`export class Box<T> {
  constructor(v) {
    this.v = v;
  }
}
`);
    expect(dts).toContain("export declare class Box<T> {");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Box } from "./mod.js";\nexport const b: Box<string> = new Box<string>("x");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("产出的 .d.ts 真能过 tsc --noEmit --strict（BUG-168 的主症状是 TS2304）", () => {
    const dts = moduleDts(`export function id<T>(x: T): T {
  return x;
}
export function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
`);
    const check = tscNoEmit({ "mod.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  });
});
