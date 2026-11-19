/**
 * entry@ 入口实参的 **TS 注解 Abs** 必须带「键集不完备」标记。
 *
 * TS 结构类型不封闭值域：`x: { a: number }` 的合法实参 `{a:1, c:2}` 多出的
 * 键静态不可知 ⇒ 键家族（Object.keys/values/entries）只能折 `string[]`。
 * 标记是 Abs 级 side table（objects.ts 的 `markKeySetOpenAbs`），**造新 Abs
 * 就丢**——service 的入口播种（`tsAnnotationArgAbs`）此前直接
 * `makeAbsVal(shape)` ⇒ 键家族按声明槽折 exact 字面元组（`["a"]`），
 * dts / zod / guard 三个产物面据此发布**一次观测值**，运行时校验器拒收函数
 * 自己产生的合法输出。
 *
 * 断言钉住两面：entry@ **见证 Abs**（导出面与 check 面共用的签名数据源）与
 * 产物投影（dts / zod）。`nudo check` 的签名面此前已由 core 泛化面判对，
 * 所以这里看的是 service 播种面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Abs, Shape } from "@nudojs/core";
import { analyzeFile, resetAllAnalysisCaches } from "../index.ts";
import { generateDts } from "../emit/dts-generator.ts";
import { absToZodSchemaModule } from "../emit/schema-generator.ts";

const SRC = `export function k0(x: any) { return Object.keys(x); }
export function k1(x: { a: number }) { return Object.keys(x); }
export function k3(x: { a: number; b?: string }) { return Object.keys(x); }
export function kv(x: { a: number }) { return Object.values(x); }
export function ke(x: { a: number }) { return Object.entries(x); }
export function kn(x: { a: { b: number } }) { return Object.keys(x.a); }
`;

function witnessOf(name: string) {
  return analyzeFile("/t/keys.ts", SRC).functions.find((f) => f.name === name)
    ?.combinedAbs;
}

/** arr 元素的形状（非 arr ⇒ undefined；供断言窄化） */
function elemShapeOf(a: Abs | undefined): Shape | undefined {
  return a && a.shape.k === "arr" ? a.shape.element.shape : undefined;
}

function dtsText(): string {
  return generateDts(analyzeFile("/t/keys.ts", SRC));
}

beforeEach(() => {
  resetAllAnalysisCaches();
});

describe("entry@ 注解 Abs 的键集不完备标记", () => {
  it("BUG-205 开放对象注解的键家族见证 Abs 是 arr(string)：改前 == 声明槽的 exact 字面元组 [\"a\"] / [\"a\",\"b\"]；嵌套对象槽（x.a）同口径", () => {
    for (const name of ["k1", "k3", "kn"]) {
      const a = witnessOf(name);
      expect(a?.shape.k, name).toBe("arr");
      expect(a?.conf, name).toBe("partial");
      expect(elemShapeOf(a), name).toMatchObject({ k: "prim", type: "string" });
    }
  });

  it("BUG-205 values / entries 与 keys 同口径：见证 Abs 是 arr 形态，不再按声明槽折单元素元组", () => {
    const v = witnessOf("kv");
    expect(v?.shape.k).toBe("arr");
    expect(elemShapeOf(v)?.k).toBe("unknown");
    const e = witnessOf("ke");
    expect(e?.shape.k).toBe("arr");
    expect(elemShapeOf(e)?.k).toBe("tuple");
  });

  it("BUG-205 dts 产物面同步：返回位是 string[] / unknown[]，不是 [\"a\"] / [number] / [[\"a\", number]]", () => {
    const dts = dtsText();
    expect(dts).not.toContain('@returns ["a"]');
    expect(dts).not.toContain("@returns [number]");
    expect(dts).toMatch(/function k1\(x: \{ a: number \}\): string\[\];/);
    expect(dts).toMatch(/function k3\(x: \{ a: number; b\?: string \}\): string\[\];/);
    expect(dts).toMatch(/function kv\(x: \{ a: number \}\): unknown\[\];/);
  });

  it("BUG-205 zod 产物面同步：keys 输出投影成 z.array(z.string())，不是 z.tuple([z.literal(\"a\")])", () => {
    const k1 = witnessOf("k1");
    expect(k1).toBeDefined();
    const { source } = absToZodSchemaModule({ k1Output: k1! });
    expect(source).toContain("export const k1Output = z.array(z.string());");
    expect(source).not.toContain('z.tuple([z.literal("a")])');
  });

  it("BUG-205 负控制：`x: any` 与未标注入口的 keys 仍是 string[]（标记只加在开放对象注解上，不改变 any 面）", () => {
    expect(witnessOf("k0")?.shape.k).toBe("arr");
    expect(dtsText()).toMatch(/function k0\(x: any\): string\[\];/);
  });
});
