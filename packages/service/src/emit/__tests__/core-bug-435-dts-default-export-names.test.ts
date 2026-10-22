/**
 * Bug 435 —— `nudo export --format dts` 把**具名 default 导出**投影成**具名导出**
 * ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入
 * 直接 **TS2349**。
 *
 * 现状：**假阳性** —— 症状已被族 15（Bug 514，commit `dde4b037`）修掉：
 * `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面**
 * 取**导出名**（`export default function f(...)` 的导出名是 `default`，**不是**
 * `export declare function f`）。本钉把**四种 default 形态**的导出名钉死
 * （**不改实现**）。
 *
 * 落点说明：本钉写在 **service 的 dts 生成器单测**里（`packages/service/src/emit/
 * __tests__/`），**不写**在 `packages/nudojs/src/commands/export/**` 的命令测试里
 * （该目录族 17 在改）。导出面裁剪谓词与 CLI `export --format dts` 同口径：
 * `exportFacePredicate(localNamedExports(source))`（CLI 侧见
 * `packages/nudojs/src/commands/export/dts-face.ts`）。
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

/** CLI export 面筛选（与 packages/nudojs/src/commands/export/dts-face.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, path = "/test/default-surface.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("Bug 435 —— dts 面的 default 导出名（四形态）", () => {
  it("形态①：export default function named ⇒ 导出名是 default（不是具名导出）", () => {
    const dts = moduleDts(`export default function named(x) {
  return x + 1;
}
`);
    expect(dts).toContain("export default function named(");
    // 不得凭空虚构运行时不存在的具名导出（改前的症状）
    expect(dts).not.toContain("export declare function named");
    expect(dts).not.toMatch(/export\s*\{[^}]*\bnamed\b/);
  });

  it("形态②：export default class K ⇒ 导出名是 default（类不被降成模块级函数）", () => {
    const dts = moduleDts(`export default class K {
  m(x) {
    return x + 1;
  }
}
`);
    expect(dts).toContain("export default class K {");
    expect(dts).not.toContain("export declare function K");
    expect(dts).not.toContain("K_m");
  });

  it("形态③：匿名 default（export default function (x)）⇒ 导出名是 default", () => {
    const dts = moduleDts(`export default function (x) {
  return x + 1;
}
`);
    expect(dts).toMatch(/export default function \(x: (any|unknown)\): .*;/);
    expect(dts).not.toContain("export declare function");
  });

  it("形态④：箭头 default（export default (x) => …）⇒ 导出名是 default", () => {
    const dts = moduleDts(`export default (x) => x + 1;
`);
    expect(dts).toMatch(/export default function \(x: (any|unknown)\): .*;/);
    expect(dts).not.toContain("export declare function");
  });

  it("形态④′：const + export default arrow ⇒ 导出名是 default（本地名不作导出名）", () => {
    const dts = moduleDts(`const arrow = (x) => x + 1;
export default arrow;
`);
    expect(dts).toContain("export default function arrow(");
    expect(dts).not.toContain("export declare function arrow");
  });

  it("模块面：default 的导出绑定（导出名 → 本地绑定名）", () => {
    const surface = dtsModuleSurface(`export default function named(x) {
  return x + 1;
}
`);
    expect(surface.exportBindings.get("default")).toBe("named");
  });

  it("模块面：匿名 / 箭头 default 没有本地绑定名", () => {
    expect(
      dtsModuleSurface(`export default function (x) {
  return x + 1;
}
`).exportBindings.get("default"),
    ).toBe("");
    expect(
      dtsModuleSurface(`export default (x) => x + 1;
`).exportBindings.get("default"),
    ).toBe("");
  });

  // ── 负控制：本条修复不该波及的邻近形态 ──────────────────────────
  it("负控制：非 default 的具名导出仍是 export declare function（导出面过滤不变）", () => {
    const dts = moduleDts(`export function other(y) {
  return y + 1;
}
`);
    expect(dts).toContain("export declare function other(");
  });

  it("负控制：未导出的本地函数不进 dts", () => {
    const dts = moduleDts(`export default function named(x) {
  return x + 1;
}
function helper(x) {
  return x + 2;
}
`);
    expect(dts).not.toContain("helper");
  });
});
