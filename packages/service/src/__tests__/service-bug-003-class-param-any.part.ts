/**
 * BUG-003 —— `export --format dts` 把类成员渲染成 `unknown`。
 *
 * 三个丢信息点（`dtsClassDeclaration`）：① 构造器 / 静态方法形参**硬编码**
 * `unknown`；② 静态方法返回硬编码 `unknown`；③ 实例方法返回只吃
 * case/combinedAbs 证据（分析面对类成员给的就是 `unknown`）。
 *
 * 本文件钉住 ①：类形参按 `CLAUDE.md` 的分面约定 = **无约束 ⇒ `any`**
 * （真正的 `unknown` 表示推断失败），并与同一次运行的 `nudo check` 签名面
 * （`Widget(w: any, h: any)`）一致。
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

describe("BUG-003 —— 类形参不再硬编码 unknown", () => {
  it("构造器形参 = any（无约束入口形参的约定口径）", () => {
    const dts = classDts();
    expect(dts).toContain("constructor(w: any, h: any);");
    expect(dts).not.toContain("constructor(w: unknown");
  });
});
