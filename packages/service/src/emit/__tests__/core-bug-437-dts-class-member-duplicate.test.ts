/**
 * Bug 437 —— dts 面的**回归钉**（service 侧）。
 *
 * core 侧的类方法普查名不再让**静态方法与实例方法同名**时共用一个名字
 * （`scan-top-functions.ts` 的 `collectClassMethods`；service 侧
 * `analyzer-ast.ts` 同口径）⇒ `analysis.functions` 里不再有两条 `C.m` ⇒
 * dts 类体里也不该再出现**重复的实例成员声明**。
 *
 * dts 的正确形态（族 14/15 已把静态方法投影成 `static m(...)`）：
 * ```ts
 * export declare class C {
 *   m(x: any): unknown;          // 实例方法（普查面）
 *   static m(x: unknown): unknown; // 静态方法（源码面 class surface）
 * }
 * ```
 * ⚠ 修名前多出来的那条 `m(x: any): unknown;`（静态方法被当成实例成员再投影一次）
 * 就是本钉要拦住的。
 */
import { describe, it, expect } from "vitest";
import { localNamedExports } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";

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
function moduleDts(source: string, path = "/test/b437.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

const SAME_NAME = `export class C {
  m(x) {
    return "inst";
  }
  static m(y) {
    return "stat";
  }
}
`;

describe("Bug 437 — dts 面：静态与实例同名 ⇒ 类体里不重复声明成员", () => {
  it("普查面只有一条 C.m", () => {
    const result = analyzeFile("/test/b437.js", SAME_NAME);
    const names = result.functions.map((f) => f.name);
    expect(names.filter((n) => n === "C.m").length).toBe(1);
  });

  it("dts 类体：实例方法一条 + 静态方法一条（无重复成员）", () => {
    const dts = moduleDts(SAME_NAME);
    expect(dts).toContain("export declare class C {");
    expect(dts).toMatch(/static m\(y: (any|unknown)\): unknown;/);
    // 实例成员 `m(...)` 只出现一次（重复的那条是静态方法被当成实例成员再投影）
    const instanceMembers = dts.match(/^\s*m\(x: (any|unknown)\): unknown;$/gm) ?? [];
    expect(instanceMembers.length).toBe(1);
  });

  it("dts 产物里不出现模块级的 C_m 声明（类成员不是模块级导出）", () => {
    const dts = moduleDts(SAME_NAME);
    expect(dts).not.toContain("export declare function C_m");
  });
});
