/**
 * Bug 608 —— **guard 面**的导出名只过字符清洗（`safeExportIdent(name)`）⇒
 * **没有模块内去重集合** ⇒ 两个不同的源函数清洗后同名
 * （类方法 `A.b` 与顶层函数 `A_b` ⇒ 两个 `export function isA_bOutput`）
 * ⇒ 产物在 node 下 `SyntaxError: Identifier 'isA_bOutput' has already been
 * declared`、在 tsc 下 `TS2323` / `TS2393`。
 *
 * 修法（service 侧）：`generateGuardFunctionFromAbs(name, abs, used?)` 接受
 * **模块级去重集合**（与 zod 面 `safeExportIdent(name, used)` 同一套口径：
 * `isA_bOutput` / `isA_bOutput_2`）⇒ 调用方**按模块**传同一个集合即可消歧。
 *
 * 负控制：不传 `used` 时行为与旧版一致（只清洗、不去重）——旧调用方零影响。
 */
import { describe, it, expect } from "vitest";
import { num } from "@nudojs/core";
import { generateGuardFunctionFromAbs } from "../emit/guard-generator.ts";

/** 产物里的 `export function <name>` 名字（按出现顺序）。 */
function exportedGuardNames(source: string): string[] {
  return [...source.matchAll(/export function (\w+)\(/g)].map((m) => m[1]!);
}

describe("Bug 608: guard 导出名必须模块内去重（清洗碰撞不再产生同名导出）", () => {
  it("同一个 used 集合 ⇒ 清洗后同名的两个守卫拿到不同导出名", () => {
    const used = new Set<string>();
    // 类方法 `A.b` 与顶层函数 `A_b` ⇒ 清洗后都是 `isA_bOutput`
    const a = generateGuardFunctionFromAbs("isA_bOutput", num(), used);
    const b = generateGuardFunctionFromAbs("isA_bOutput", num(), used);

    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isA_bOutput_2"]);

    // 同一模块里两个守卫 ⇒ 导出名唯一（node / tsc 都不再报重复声明）
    const module = [a, b].join("\n");
    const names = exportedGuardNames(module);
    expect(names).toEqual(["isA_bOutput", "isA_bOutput_2"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("used 集合跨守卫共享 ⇒ 去重只影响同名者（不同名不受影响）", () => {
    const used = new Set<string>();
    const a = generateGuardFunctionFromAbs("isA_bOutput", num(), used);
    const b = generateGuardFunctionFromAbs("isOtherOutput", num(), used);
    const c = generateGuardFunctionFromAbs("isA_bOutput", num(), used);

    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isOtherOutput"]);
    expect(exportedGuardNames(c)).toEqual(["isA_bOutput_2"]);
  });

  it("负控制：不传 used ⇒ 只清洗、不去重（旧调用方行为不变）", () => {
    const a = generateGuardFunctionFromAbs("isA_bOutput", num());
    const b = generateGuardFunctionFromAbs("isA_bOutput", num());
    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isA_bOutput"]);
  });

  it("字符清洗仍然生效（A.b → isA_bOutput）", () => {
    const src = generateGuardFunctionFromAbs("isA.bOutput", num(), new Set<string>());
    expect(exportedGuardNames(src)).toEqual(["isA_bOutput"]);
  });
});
