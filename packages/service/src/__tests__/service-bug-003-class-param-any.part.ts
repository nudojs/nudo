/**
 * BUG-003 —— `export --format dts` 的类成员投影。
 *
 * 三个丢信息点（`dtsClassDeclaration`）：① 构造器 / 静态方法形参无类型
 * 证据；② 静态方法返回硬编码 `unknown`；③ 实例方法返回只吃
 * case/combinedAbs 证据（分析面对类成员给的就是 `unknown`）。
 *
 * 历史：BUG-003 曾把 ① 从硬编码 `unknown` 改成 `any`，理由是
 * `CLAUDE.md` 的展示面分面约定（无约束 ⇒ any）。2026-11-06 产品裁定
 * 「nudo any ≈ TS unknown」明确该规则只管 **nudo 展示 / CLI 面**；
 * **TS 投影面**把无约束 any 映成 TS `unknown`（top）⇒ ① 回到 `unknown`，
 * 但理由不是「推断失败」，而是「TS 侧的 top」。`nudo check` 的签名面
 * （`Widget(w: any, h: any)`）仍按展示面规则打印 any，两者作用域不同。
 *
 * ③ 的证据通道在 analyzer 侧（类成员的 `combinedAbs` 恒为 `unknown`，
 * `generalizeFromAst` 对 `Widget.area` 返回 undefined）⇒ 已上报为遗留项。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../emit/dts-generator.ts";

const SRC = `export class Widget {\n  constructor(w, h) {\n    this.w = w;\n    this.h = h;\n  }\n  area() {\n    return this.w * this.h;\n  }\n}\n`;

function classDts(): string {
  const result = analyzeFile("/test/bug003.js", SRC);
  const surface = dtsModuleSurface(SRC);
  const mod = projectModuleDts(
    surface,
    result.functions.map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) })),
  );
  return mod.lines.join("\n");
}

describe("BUG-003 —— 类形参归一为 TS unknown（TS 投影面）", () => {
  it("构造器形参 = unknown（nudo 展示面仍为 any，两个作用域不同）", () => {
    const dts = classDts();
    expect(dts).toContain("constructor(w: unknown, h: unknown);");
    expect(dts).not.toContain("constructor(w: any");
  });
});
