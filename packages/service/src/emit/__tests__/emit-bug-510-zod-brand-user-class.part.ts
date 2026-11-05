/**
 * Bug 510 —— 用户自定义类的 brand 被渲染成 `z.instanceof(<类名>)`：
 * 生成的模块根本无法 import（ReferenceError / TS2304）。
 *
 * 根因（族 02 的 Bug 233 已在本文件被 pin 之前修掉，这里是**回归钉**）：
 * `schema-generator.ts` 的 brand 分支曾把 brand **名字**当作用域内的标识符
 * 插进产物（`z.instanceof(Counter)`），而生成模块**只** import zod ⇒
 * 用户类名在模块作用域内不存在 ⇒ 模块求值期即抛 ReferenceError（TS2304）。
 *
 * 现在：brand 名只有落在「运行时全局构造器」表里才允许进 `z.instanceof(...)`；
 * 其余（用户类名 / `X.prototype` / `GeneratorFunction` / 内建泛型别名）降级
 * `z.unknown()`（放行不拒收）并把损失记进 dropped 台账 ⇒ 产物**必可 import**。
 *
 * 负控制：内建全局构造器（Date / Map / RegExp）**不得**过度降级。
 */
import { describe, it, expect } from "vitest";
import { abs, num, type Abs } from "@nudojs/core";
import { absToSchemaSource, absToZodSchemaModule } from "../schema-generator.ts";

/** brand 形态 Abs（内层形状 + 名字） */
const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") }, undefined, undefined, "exact");

describe("Bug 510 — 用户自定义类的 brand 不得原样进 z.instanceof", () => {
  it("用户类名不进产物（模块可 import，无 TS2304）", () => {
    const source = absToSchemaSource(brandOf("Counter"));
    expect(source).not.toContain("z.instanceof(Counter)");
    expect(source).not.toContain("Counter");
    // 降级为放行形态（不是 never ⇒ 不拒收合法值）
    expect(source).toBe("z.unknown()");
  });

  it("降级必须进 dropped 台账（损失可观测，不是静默）", () => {
    const mod = absToZodSchemaModule({ makeCounterOutput: brandOf("Counter") });
    expect(mod.dropped.some((d) => d.includes("Counter"))).toBe(true);
    expect(mod.source).toContain("brand not projected");
    expect(mod.source).not.toContain("z.instanceof(Counter)");
  });

  it("负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）", () => {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
    expect(absToSchemaSource(brandOf("RegExp"))).toBe("z.instanceof(RegExp)");
  });

  it("负控制：非 brand 形态不受影响", () => {
    expect(absToSchemaSource(num())).toContain("z.number()");
  });
});
