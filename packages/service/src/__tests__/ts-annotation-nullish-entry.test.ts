/**
 * TS 注解里的 `null` / `undefined` 必须进入 **service 的入口实参 Abs**。
 *
 * `absShapeForTsTypeText` 只产 Shape，Shape 表达不了 nullish 字面量（Abs 用
 * `unknown shape + lit term`）⇒ 旧入口播种把 `string | null` 整条退成 any：
 * entry@ 观测的返回位被放宽（dts `string | unknown`）、zod 入参 `z.unknown()`、
 * guard 恒真 —— 与同一份产物里 `@param x - string | null` 的注解原文自相矛盾；
 * 而 check 泛化面（generalize.ts）早已走 Abs 面（`absTypeForTsTypeText`）。
 *
 * 修法：service 的 `tsAnnotationArgAbs` 与 core 泛化面**同一映射链**（Abs 面）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Abs } from "@nudojs/core";
import { analyzeFile, resetAllAnalysisCaches } from "../index.ts";
import { generateDts } from "../emit/dts-generator.ts";
import { absToZodSchemaModule } from "../emit/schema-generator.ts";
import { tsAnnotationArgAbs } from "../ts-annotation.ts";

const SRC = `export function pick(x: string | null): string { return x ?? ""; }
export function plain(x: string): string { return x ?? ""; }
export function guarded(x: string | null): string {
  if (x === null) return "";
  return x.toUpperCase();
}
`;

function witnessOf(name: string): Abs | undefined {
  return analyzeFile("/t/nullish.ts", SRC).functions.find((f) => f.name === name)
    ?.combinedAbs;
}

beforeEach(() => {
  resetAllAnalysisCaches();
});

describe("TS 注解 nullish 成员的入口 Abs", () => {
  it("BUG-210 `string | null` 保留 null 字面量成员，不再整条退 any", () => {
    const a = tsAnnotationArgAbs("string | null");
    expect(a.shape.k).toBe("sum");
    const members = a.shape.k === "sum" ? a.shape.members : [];
    expect(members.some((m) => m.term?.op === "lit" && m.term.value === null)).toBe(true);
    expect(members.some((m) => m.shape.k === "prim" && m.shape.type === "string")).toBe(true);
    // 不可映射 / 无注解仍是 any（负控制：不发明类型）
    expect(tsAnnotationArgAbs("SomeUnmappedAlias").shape.k).toBe("any");
  });

  it("BUG-210 entry@ 观测返回位：`x ?? \"\"` 折 string，不再被 any 拉宽成 `string | unknown`", () => {
    const pick = witnessOf("pick");
    expect(pick?.shape).toMatchObject({ k: "prim", type: "string" });
    const guarded = witnessOf("guarded");
    expect(guarded?.shape).toMatchObject({ k: "prim", type: "string" });
    expect(witnessOf("plain")?.shape).toMatchObject({ k: "prim", type: "string" });

    const dts = generateDts(analyzeFile("/t/nullish.ts", SRC));
    expect(dts).toMatch(/function pick\(x: string \| null\): string;/);
    expect(dts).toMatch(/function guarded\(x: string \| null\): string;/);
    expect(dts).not.toContain("string | unknown");
  });

  it("BUG-210 zod 入参投影：nullish 成员发布成 z.union([z.string(), z.null()])，不是 z.unknown()", () => {
    const { source } = absToZodSchemaModule({ pickInput: tsAnnotationArgAbs("string | null") });
    expect(source).toContain("z.union([z.string(), z.null()])");
    expect(source).not.toContain("z.unknown()");
  });
});
