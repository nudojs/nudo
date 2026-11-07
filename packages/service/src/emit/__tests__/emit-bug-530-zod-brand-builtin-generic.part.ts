/**
 * Bug 530 —— `nudo export --format schema` 把**内建类型 brand** 渲染成
 * `z.instanceof(Record<string, string>)` ⇒ 产物是 **TS2693 编译不过**的模块
 * （`process.env` 即触发）。
 *
 * 根因（族 02 的 Bug 233 已在本文件被 pin 之前修掉，这里是**回归钉**）：
 * brand 分支曾无条件把 brand **名字**当作用域内的**运行时值**插进产物
 * （`z.instanceof(Record<string, string | undefined>)`）——`Record<…>` /
 * `Map<…>` 这类**纯类型**根本没有运行时类 ⇒ 产物用「类型当值」⇒ TS2693。
 *
 * 现在：brand 名只有落在「运行时全局构造器」表里才允许进 `z.instanceof(...)`；
 * 纯类型 brand（内建泛型别名 / 开放字典）降级 `z.unknown()` + dropped 注释
 * ⇒ 产物**必可编译**（无 TS2693）且**必可 import**。
 *
 * 负控制：真有运行时类的内建（Date / Map / RegExp）**不得**过度降级。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "@nudojs/core";
import { absToSchemaSource, absToZodSchemaModule } from "../schema-generator.ts";

/** brand 形态 Abs（内层形状 + 名字） */
const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") }, undefined, undefined, "exact");

describe("Bug 530 — 内建类型 brand（纯类型）不得进 z.instanceof", () => {
  it("Record<string, string | undefined>（process.env 的 brand）不进产物", () => {
    const source = absToSchemaSource(brandOf("Record<string, string | undefined>"));
    // 「类型当值」⇒ TS2693：`Record` only refers to a type
    expect(source).not.toContain("z.instanceof(Record");
    expect(source).not.toContain("<");
    expect(source).toBe("z.unknown()");
  });

  it("Record<string, string>（process.versions 的 brand）不进产物", () => {
    const source = absToSchemaSource(brandOf("Record<string, string>"));
    expect(source).not.toContain("z.instanceof(Record");
    expect(source).toBe("z.unknown()");
  });

  it("降级进 dropped 台账（brand 不可表达必须可观测）", () => {
    const mod = absToZodSchemaModule({ getEnvOutput: brandOf("Record<string, string | undefined>") });
    expect(mod.dropped.some((d) => d.includes("brand not projected"))).toBe(true);
    expect(mod.source).toContain("// dropped preds (not projected into zod):");
    expect(mod.source).not.toContain("z.instanceof(Record");
  });

  it("负控制：有运行时类的内建仍走 z.instanceof", () => {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
  });
});
