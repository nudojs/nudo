/**
 * Bug 027 —— `export --format dts` 把**非同 prim 的字面量 union** 拓宽成基类型
 * ⇒ 发布的 `.d.ts` 允许契约违约的调用（双门禁对撞）。
 *
 * 同一次运行、同一份契约三个面三种说法：
 *   check 签名   `pick(v: lit(1) | lit("x")) => number | string`
 *   dts（改前）  `pick(v: number | string): number | string`   ← **拓宽**
 *   zod          `z.union([z.literal(1), z.literal("x")])`      ← 保字面量
 *
 * 根因：`contractLiteralTSType` **只读顶层 pred**。同 prim 字面量 union 在 Abs
 * 面上被特化成「prim + or(eq…)」，字面量在顶层 pred 里 ⇒ 保形 ✓；而**非同
 * prim** 的 union 落成 **sum 形状** ⇒ 字面量挂在**各成员自己的** pred 上、顶层
 * pred 为空 ⇒ 取不到 ⇒ 落回 `absToTSType(widenTopLevelAbs(a))` ⇒ 拓宽成
 * `number | string` ⇒ 消费方 tsc 放行 `pick(99)`，运行时被 nudo 门禁判违约。
 *
 * 修法：与 zod 面**同源**——union 臂**逐成员**取字面量集后合并。
 */
import { describe, it, expect } from "vitest";
import { constraintToEntryAbs, litC, number, string, union } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { projectFunctionDts } from "../emit/dts-generator.ts";

/** `pick(v) { return v; }` 的 dts 行（契约面：形参 + 返回同一条约束） */
function dtsOf(c: ReturnType<typeof union>): string {
  const result = analyzeFile("/test/bug027.js", `export function pick(v) { return v; }\n`);
  const fn = result.functions.find((f) => f.name === "pick")!;
  return projectFunctionDts(fn, {
    params: [{ name: "v", abs: constraintToEntryAbs(c, "v") }],
    return: constraintToEntryAbs(c, "return"),
  }).lines.join("\n");
}

describe("Bug 027 · 契约的 union 字面量域必须在 dts 面保形", () => {
  it("非同 prim 字面量 union ⇒ `1 | \"x\"`（改前 `number | string`）", () => {
    const text = dtsOf(union(litC(1), litC("x")));
    expect(text).toContain(`export declare function pick(v: 1 | "x"): 1 | "x";`);
    // 拓宽的痕迹不得出现（形参位 / 返回位都不行）
    expect(text).not.toContain("number | string");
  });

  it("同 prim 字面量 union 仍保形（回归钉）", () => {
    const text = dtsOf(union(litC("a"), litC("b")));
    expect(text).toContain(`pick(v: "a" | "b"): "a" | "b"`);
  });

  it("含 nullish 字面量的混合 union 也保形（字面量在 term 里也要读）", () => {
    const text = dtsOf(union(litC(1), litC(null)));
    expect(text).toContain("pick(v: 1 | null)");
  });

  it("负控制：成员不是字面量域（union(number(), string())）仍按 widen 口径", () => {
    const text = dtsOf(union(number(), string()));
    expect(text).toContain("pick(v: number | string): number | string");
  });

  it("负控制：带界成员（union(number().gt(0), lit(0))）不整体当字面量域", () => {
    const text = dtsOf(union(number().gt(0), litC(0)));
    // 有界成员不可表达为有限字面量集 ⇒ 整条不保形（回落 widen）
    expect(text).toContain("pick(v: number): number");
  });
});
