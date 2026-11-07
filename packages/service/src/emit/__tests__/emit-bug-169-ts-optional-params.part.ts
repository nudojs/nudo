/**
 * BUG-169 —— TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面
 * 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码
 * 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。
 *
 * 根因：`?` 在 strip-types 阶段就被删（不进 JS 产物），而 `FormalParam` 的
 * `kind:"id"` 位硬写 `optional: false`；`tsOptionalParams`（core）早就有正确的
 * 源码文本判据却只被字面量实参扫描使用。
 *
 * 修法：`formalParamsFromNodes(params, source)` 把 `tsOptionalParams` 的结果并进
 * `FormalParam.optional`（与 JS 默认值同一条「可省」通道）⇒ dts 的 `?` /
 * standard 的 `required` 判定 / zod 的槽 `.optional()` 都从这一个数据源读。
 *
 * 本钉是差分口径：三面可省性 ≡ 源码（JS 默认值 ∪ TS `?`）。
 */
import { describe, it, expect } from "vitest";
import { abs, obj, type Abs } from "@nudojs/core";
import { analyzeFile, type CaseResult } from "@nudojs/service";
import { unifiedParamFace } from "nudojs/commands/export/contract-face.ts";
import { dtsModuleSurface, projectFunctionDts } from "../dts-generator.ts";
import { absToZodSchemaModule } from "../schema-generator.ts";
import { absToStandardSchemaFunction } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const SRC = `export function f(a: number, b?: string): string {
  return b ?? "";
}
export function g(a: number, b = 2): number {
  return a + b;
}
`;

const anyAbs: Abs = abs({ k: "any" }, undefined, undefined, "path");

function formalsOf(name: string): Array<[string, boolean | undefined]> {
  const result = analyzeFile("/test/optional-param.ts", SRC);
  const fn = result.functions.find((x) => x.name === name)!;
  return (fn.formals ?? []).map((f) => [f.kind, f.optional]);
}

describe("BUG-169: TS 可选形参进三个产物面（可省性 ≡ 源码）", () => {
  it("数据源：FormalParam.optional ≡ 源码（JS 默认值 ∪ TS `?`）", () => {
    expect(formalsOf("f")).toEqual([
      ["id", false],
      ["id", true],
    ]);
    expect(formalsOf("g")).toEqual([
      ["id", false],
      ["default", true],
    ]);
  });

  it("dts 面：可省位印 `?`（消费端 `f(1)` 不再 TS2554）", () => {
    const result = analyzeFile("/test/optional-param.ts", SRC);
    const fn = result.functions.find((x) => x.name === "f")!;
    const lines = projectFunctionDts(fn, undefined, dtsModuleSurface(SRC)).lines.join("\n");
    expect(lines).toMatch(/b\?:/);
    expect(lines).not.toMatch(/b: string/);
  });

  it("standard 面：`{ a }` 通过、缺 `a` 仍报 required", async () => {
    const result = analyzeFile("/test/optional-param.ts", SRC);
    const fn = result.functions.find((x) => x.name === "f")!;
    const { source } = absToStandardSchemaFunction({
      fn: "f",
      inputs: [
        { name: "a", abs: anyAbs },
        { name: "b", abs: anyAbs },
      ],
      formals: fn.formals,
    });
    const mod = await loadGeneratedModule(source);
    const input = mod.fInput!["~standard"];
    expect(input.validate({ a: 1 }).issues).toBeUndefined();
    expect(input.validate({ a: 1, b: "s" }).issues).toBeUndefined();
    const missing = input.validate({});
    expect(missing.issues?.[0]?.message).toBe("required");
  });

  it("zod 面：可选槽渲染 `.optional()`（槽可选性由同一 FormalParam 驱动）", () => {
    const slots = {
      a: { value: anyAbs },
      b: { value: anyAbs, optional: true },
    };
    const source = absToZodSchemaModule({ fInput: obj(slots) }).source;
    expect(source).toContain("b: z.unknown().optional()");
    expect(source).not.toContain("a: z.unknown().optional()");
  });

  it("zod 面（入口角色表）：`unifiedParamFace` 把 `b?` 判为可省", () => {
    const fn = analyzeFile("/test/optional-param.ts", SRC).functions.find((x) => x.name === "f")!;
    // 唯一一条「一键实参」观测 ⇒ minArity = 1 ⇒ 下标 1 的可省性只能来自 TS `?`
    // （契约面缺席、FormalParam 之外没有别的信息源）。
    const witness: CaseResult = { name: "c", argAbs: [anyAbs], abs: anyAbs, throwsAbs: anyAbs };
    expect(unifiedParamFace(fn, undefined, [witness]).map((f) => [f.name, f.optional])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    // 对照：无观测 ⇒ 既有的「按最少实参元数放宽」仍生效（不收紧）
    expect(unifiedParamFace(fn, undefined, []).map((f) => [f.name, f.optional])).toEqual([
      ["a", true],
      ["b", true],
    ]);
  });
});
