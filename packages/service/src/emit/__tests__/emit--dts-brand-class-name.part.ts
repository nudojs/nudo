/**
 * Bug 233 —— dts 面不得产出「从未声明的类型名」（用户类 brand）。
 *
 * 改前：`absToTSType(brand("Counter"))` = `Counter` ⇒ 产物里那个类名**从未
 * 声明** ⇒ 消费方 tsc 报 **TS2304**（"Cannot find name 'Counter'"）。
 *
 * 修法（模块面口径）：
 * - **本地声明**的类 ⇒ 保留类名 + `declare class`（Bug 517 既有口径不变）；
 * - **import 进来**的类 ⇒ 保留类名 + 补 `import type { C } from "…";`
 *   （族 15 S11 的 zod 白名单口径：「补 import 的类名不能被误杀」——不能把
 *   所有未声明的类型名一律降级）；
 * - **两边都没有**的类名（用户类 brand 来自未声明的名字）⇒ 降级为 `unknown`
 *   并在产物头部留**降级台账**（可诊断）。
 *
 * TS 全局类型名（Date / RegExp / Error / URL …，与 zod 白名单同名单）原样保留。
 * 纯投影面（`absToTSType` 单值投影，无模块面）保持既有口径不变。
 */
import { describe, it, expect } from "vitest";
import { abs, num, objOf, type Abs } from "@nudojs/core";
import {
  absToTSType,
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
} from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");

/** 假 fn（返回位给定） */
function fakeFn(name: string, outAbs: Abs): unknown {
  return { name, cases: [{ name: "c", argAbs: [num()], args: [], abs: outAbs }] };
}

/** 模块面 dts（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, fn: unknown): string {
  const surface = dtsModuleSurface(source);
  const typed = fn as Parameters<typeof projectFunctionDts>[0];
  const projection = projectFunctionDts(typed, undefined, surface);
  return projectModuleDts(surface, [{ fn: typed, projection }]).lines.join("\n");
}

describe("Bug 233 —— dts 面不得产出未声明的类型名", () => {
  it("未声明的类 brand：降级为 unknown + 降级台账（改前：TS2304）", () => {
    const dts = moduleDts(
      `export function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    // 返回位不再是「从未声明的类型名」
    expect(dts).not.toMatch(/:\s*Counter/);
    expect(dts).toMatch(/export declare function make\([^)]*\): unknown;/);
    // 可诊断：台账点名被降级的类名
    expect(dts).toContain("nudo:unresolved-class");
    expect(dts).toContain("Counter");
  });

  it("import 进来的类：类名保留 + 补 import type（不被误杀）", () => {
    const dts = moduleDts(
      `import { Counter } from "./counter.js";\nexport function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    expect(dts).toContain('import type { Counter } from "./counter.js";');
    expect(dts).toMatch(/export declare function make\([^)]*\): Counter;/);
    expect(dts).not.toContain("nudo:unresolved-class");
  });

  it("import 进来的类：产物可编译（消费方能按该类使用）", () => {
    const dts = moduleDts(
      `import { Counter } from "./counter.js";\nexport function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    const check = tscNoEmit({
      "counter.d.ts": `export declare class Counter { v: number; }\n`,
      "lib.d.ts": dts,
      "use.ts": `import { make } from "./lib.js";\nimport { Counter } from "./counter.js";\nexport const c: Counter = make(1);\n`,
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("改前形态确实红（未声明的类型名 ⇒ TS2304）", () => {
    const before = `export declare function make(x: number): Counter;\n`;
    const check = tscNoEmit({
      "lib.d.ts": before,
      "use.ts": `import { make } from "./lib.js";\nexport const c = make(1);\n`,
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2304");
  });

  it("负控制：本地声明的类不变（Bug 517 口径：声明 + 类名保留）", () => {
    const dts = moduleDts(
      `export class Counter {\n  constructor(v) { this.v = v; }\n}\nexport function make() { return 1; }\n`,
      fakeFn("make", brandOf("Counter")),
    );
    expect(dts).toContain("declare class Counter");
    expect(dts).toMatch(/export declare function make\([^)]*\): Counter;/);
    expect(dts).not.toContain("nudo:unresolved-class");
  });

  it("负控制：TS 全局类型名 brand 逐字不变（与 zod 白名单同名单）", () => {
    const dts = moduleDts(
      `export function make() { return 1; }\n`,
      fakeFn("make", brandOf("Date")),
    );
    expect(dts).toMatch(/export declare function make\([^)]*\): Date;/);
    expect(dts).not.toContain("nudo:unresolved-class");
  });

  it("负控制：纯投影面（无模块面）保持既有口径（类名原样）", () => {
    expect(absToTSType(brandOf("User"))).toBe("User");
  });
});
