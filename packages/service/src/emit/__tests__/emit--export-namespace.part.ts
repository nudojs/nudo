/**
 * BUG-191 —— `export namespace NS { … }` 在导出面 / dts 产物**完全不可见**，
 * 而 nudo 自己的求值器把 namespace 物化成了运行时对象 ⇒ 引擎内部两套导出面
 * 互相矛盾 ⇒ 消费端 `import { NS }` 报 **TS2305**。
 *
 * 根因（两处平行缺口）：
 * - `packages/core/src/algebra/scan-named-exports.ts` 的 `ExportNamedDeclaration`
 *   声明分支只认 Function / Class / Variable ⇒ `TSModuleDeclaration` 落到
 *   `continue` 被静默丢弃；
 * - `dts-generator.ts` 的模块面导出名表与声明发射同款缺口 ⇒ 即使导出面登记
 *   了，`.d.ts` 里也没有 `NS`。
 *
 * 本钉钉死三件事：导出面含 NS（及成员键）、dts 导出名表含 NS、`.d.ts` 里
 * 真的有 `export declare namespace NS { … }`（消费端 import 才不报 TS2305）。
 */
import { describe, it, expect } from "vitest";
import { localNamedExports } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";

const SRC = `export namespace NS {
  export const x: number = 1;
  export function f(a: string): number {
    return a.length;
  }
  export interface Shape {
    a: number;
  }
  export namespace Inner {
    export const y = "s";
  }
}
export function unrelated(): number {
  return 1;
}
`;

function moduleDts(source: string, path = "/test/namespace.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions.map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("BUG-191: export namespace 进入导出面与 .d.ts", () => {
  it("导出面（check 入口表 / 侧车绑定 / dts 裁剪同源）含 NS 与其运行时成员键", () => {
    const names = localNamedExports(SRC);
    expect(names.has("NS")).toBe(true);
    // 成员契约键与 `Class.method` 同口径；interface 是纯类型 ⇒ 运行时不占键
    expect(names.has("NS.x")).toBe(true);
    expect(names.has("NS.f")).toBe(true);
    expect(names.has("NS.Inner")).toBe(true);
    expect(names.has("NS.Inner.y")).toBe(true);
    expect(names.has("NS.Shape")).toBe(false);
    // 负控制：普通导出面不受影响
    expect(names.has("unrelated")).toBe(true);
  });

  it("dts 模块面登记 NS（导出名 → 本地绑定）", () => {
    const surface = dtsModuleSurface(SRC);
    expect(surface.exportBindings.get("NS")).toBe("NS");
    expect(surface.namespaces?.get("NS")?.members.length).toBeGreaterThan(0);
  });

  it("`.d.ts` 发射 `export declare namespace NS { … }`（消费端 import 不再 TS2305）", () => {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare namespace NS {");
    // 成员：声明类型原样镜像（不是 any / unknown）
    expect(dts).toContain("export const x: number;");
    expect(dts).toContain("export function f(a: string): number;");
    expect(dts).toContain("export interface Shape {");
    // 嵌套 namespace 递归落地
    expect(dts).toContain("export namespace Inner {");
    // 负控制：普通函数仍在（namespace 分支不得吞掉其它导出声明）
    expect(dts).toMatch(/export declare function unrelated\(/);
  });
});
