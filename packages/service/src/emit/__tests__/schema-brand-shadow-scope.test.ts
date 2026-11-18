/**
 * 用户类遮蔽内建构造器名时，运行时产物面（zod / standard）不得把 brand 当成
 * **全局内建**投影。
 *
 * 症状：`class Date { constructor(){ this.v = 1 } }` + `return new Date()` ⇒
 * zod 产物 `z.instanceof(Date)`（模块里 `Date` 恒解析为**全局**）⇒ 校验器拒收
 * 函数自己唯一的返回形态，文案 `expected Date, received Date`；standard 面
 * 同源（`__nudoGlobalScope["Date"]`）⇒ 同样 REJECT。dts 面（`declare class
 * Date`）与 guard 面（结构性子句）却放行 ⇒ **四面相反裁决**。
 *
 * 根因：brand 的 Abs 只有 `{name}`，**不含值身份** ⇒ 用户类实例与真内建实例
 * 在 Abs 上同形；`isRuntimeGlobalCtorName(name)` 只看名字，不看这个名字在本
 * 模块里绑定的是什么。两个运行时产物面都是**独立模块**（只 import zod），
 * 无从在产物里解析源文件的本地类。
 *
 * 修法：投影期带上模块作用域（`SchemaProjectionScope.shadowedGlobals`）——
 * 名字被用户绑定遮蔽 ⇒ 无法证明是内建实例 ⇒ 降级 `unknown` 并记 dropped
 * （放行不拒收，损失可观测）。
 *
 * 钉：
 * - 遮蔽 ⇒ `z.unknown()` + 台账点名；same-name 的 standard 节点不再产 brand 子句；
 * - 不遮蔽 ⇒ 仍是 `z.instanceof(Date)`（不得过度降级）；
 * - 遮蔽**别的**名字（`Map`）不影响 `Date`（判据是逐个名字，不是布尔开关）。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "@nudojs/core";
import {
  absToSchemaNode,
  absToSchemaSource,
  absToZodSchemaModule,
} from "../schema-generator.ts";
import { absToStandardSchemaFunction, validateSchemaNode } from "../standard-schema.ts";

/** brand 形态 Abs（内层形状 + 名字） */
const brandOf = (name: string): Abs =>
  abs(
    { k: "brand", name, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "exact",
  );

const scopeOf = (...names: string[]) => ({ shadowedGlobals: new Set(names) });

describe("用户类遮蔽内建名 ⇒ zod 面不得按全局构造器投影", () => {
  it("遮蔽 Date ⇒ z.unknown()，且损失进 dropped 台账", () => {
    const source = absToSchemaSource(brandOf("Date"), { scope: scopeOf("Date") });
    expect(source).toBe("z.unknown()");
    expect(source).not.toContain("z.instanceof");

    const mod = absToZodSchemaModule({ makeTopDateOutput: brandOf("Date") }, { scope: scopeOf("Date") });
    expect(mod.source).not.toContain("z.instanceof(Date)");
    expect(mod.dropped).toEqual([
      "makeTopDateOutput: brand shadowed by a local binding (not the global constructor): Date",
    ]);
  });

  it("对照：未遮蔽 ⇒ 仍走 z.instanceof（不得过度降级）", () => {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Date"), { scope: scopeOf() })).toBe("z.instanceof(Date)");
    // 遮蔽的是同族**别的**名字 ⇒ 不影响 Date（判据按名字，不是「有遮蔽就全降级」）
    expect(absToSchemaSource(brandOf("Date"), { scope: scopeOf("Map", "Set") })).toBe(
      "z.instanceof(Date)",
    );
    // 被遮蔽的那个名字自己照降
    expect(absToSchemaSource(brandOf("Map"), { scope: scopeOf("Map", "Set") })).toBe("z.unknown()");
  });

  it("standard 面同口径：遮蔽 ⇒ 校验器接受本地类实例（不再 instanceof 全局 Date）", () => {
    const mod = absToStandardSchemaFunction(
      { fn: "makeTopDate", inputs: [], returns: brandOf("Date") },
      { scope: scopeOf("Date") },
    );
    // 产物里的 brand 节点带名字 ⇒ 反向断言：序列化是紧凑 JSON（`"k":"brand"`），
    // 带空格的 `/"k": "brand"/` 永远匹配不上（旧断言对未遮蔽模块也恒绿）。
    expect(mod.source).not.toContain('"k":"brand"');
    // 对照：未遮蔽的同一序列化**确实**带 brand 节点 ⇒ 上面的反向断言不是恒真。
    expect(
      absToStandardSchemaFunction({ fn: "makeTopDate", inputs: [], returns: brandOf("Date") })
        .source,
    ).toContain('"k":"brand"');
    expect(mod.dropped.join("\n")).toContain("brand shadowed by a local binding");
  });

  it("validateSchemaNode：节点层就已放行本地类实例（Accept，不拒收唯一返回形态）", () => {
    const shadowed = absToSchemaNode(brandOf("Date"), { scope: scopeOf("Date") }).node;
    expect(validateSchemaNode(shadowed, { v: 1 }).issues).toBeUndefined();
    // 对照：未遮蔽时节点是 brand ⇒ 本地类实例被 `instanceof 全局 Date` 拒收
    const global = absToSchemaNode(brandOf("Date")).node;
    expect(validateSchemaNode(global, { v: 1 }).issues?.length).toBe(1);
    expect(validateSchemaNode(global, new Date()).issues).toBeUndefined();
  });

  it("嵌套位置同口径（对象槽 / 数组元素里的 brand 也要剥）", () => {
    const inner = brandOf("Date");
    const shape = abs(
      { k: "obj", slots: { when: { value: inner }, all: { value: abs({ k: "arr", element: inner }, undefined, undefined, "exact") } } },
      undefined,
      undefined,
      "exact",
    );
    const source = absToSchemaSource(shape, { scope: scopeOf("Date") });
    expect(source).not.toContain("z.instanceof(Date)");
    expect(source).toContain("z.unknown()");
  });
});
