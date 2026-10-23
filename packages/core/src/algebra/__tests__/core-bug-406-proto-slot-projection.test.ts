/**
 * Bug 406 —— 对象槽名 `__proto__` 在 core 契约投影层被吞掉。
 *
 * 报告称两处 Nudo 侧缺陷（core 投影层吞键 + 渲染层第二道防线失效）⇒ **与 Bug 606 同族不同层**。
 *
 * ⚠ **勘误（按实测走）**：报告这句**不成立** —— 两处 Nudo 侧缺陷**均已在族 17 / Bug 606 修掉**，
 * 且**是同一层**（不是不同层）：
 * - `packages/core/src/algebra/projection.ts` 的 `projectObj` 字段表已是 `Object.create(null)`
 *   （注释明写「族 17 Bug 606」）⇒ 键 `__proto__` 的赋值不命中 `Object.prototype.__proto__`
 *   的**原型 setter** ⇒ 该键成自有属性；
 * - `packages/core/src/algebra/codegen-escape.ts` 的 `formatObjectKey` 已特判 `__proto__`
 *   ⇒ 一律写成计算键 `["__proto__"]`（计算键是普通自有属性，不是原型 setter）。
 *
 * ⇒ **本条判假阳性** ⇒ **零实现改动**，只补一条**反向守护钉**把「已修的行为」钉住，防回归。
 *
 * ⚠ **反向闸口径与其他片相反**：本钉钉的是「**已成立的行为**」⇒
 * **本钉在 HEAD（族 17 之后）上必须通过**（不是大面积失败）。
 *
 * 残留现象（**不修**，见族 09 台账的「越界发现」）：zod v4 运行时把 `["__proto__"]` 赋回结果对象时
 * 走 `[[Set]]` ⇒ 触发原型 setter ⇒ **解析结果**里丢掉该键（实测 `zod parse success: true {"a":2}`）。
 * 那是 **zod 自身的运行时行为**，**不在 Nudo 的投影 / 生成职责内** ⇒ 建议另开「zod 方言 `__proto__` 键」条目。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, absToConstraint } from "../index.ts";
import { formatObjectKey } from "../codegen-escape.ts";
import type { Abs } from "../abs.ts";

/**
 * 造一个只含 `__proto__` 槽的 obj Abs。
 *
 * ⚠ 槽表**必须**用 `Object.create(null)`：对象字面量里的 `"__proto__"` 键是**原型 setter**
 * （不是自有属性）⇒ 用字面量会把槽表原型改成 `num()` 的包装对象，键直接丢失。
 */
function protoSlotObjAbs(): Abs {
  const slots: Record<string, { value: Abs }> = Object.create(null);
  slots["__proto__"] = { value: num() };
  return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
}

describe("Bug 406: `__proto__` 槽在契约投影层不被吞掉（族 17 / Bug 606 已修，本钉防回归）", () => {
  it("渲染层第二道防线：formatObjectKey 把 `__proto__` 写成计算键（不是裸键）", () => {
    expect(formatObjectKey("__proto__")).toBe('["__proto__"]');
    // 对照：普通标识符仍是裸键（特判只针对 `__proto__`）
    expect(formatObjectKey("proto")).toBe("proto");
  });

  it("core 投影层：字段表原型为 null（原型 setter 不会吞掉赋值）", () => {
    const c = absToConstraint(protoSlotObjAbs());
    expect(c).toBeDefined();
    const fields = c!.fields;
    expect(fields).toBeDefined();
    expect(Object.getPrototypeOf(fields)).toBe(null);
  });

  it("core 投影层：`__proto__` 是自有键（`Object.hasOwn` 为真，键没被吞）", () => {
    const c = absToConstraint(protoSlotObjAbs());
    expect(c).toBeDefined();
    const fields = c!.fields!;
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    // 键确实在表里（不是靠原型链「看起来有」）
    expect(Object.keys(fields)).toContain("__proto__");
  });

  it("对照：普通键同样投影成自有键（口径一致）", () => {
    const slots: Record<string, { value: Abs }> = Object.create(null);
    slots["a"] = { value: num() };
    const c = absToConstraint(makeAbs({ k: "obj", slots }, undefined, undefined, "exact"));
    expect(c).toBeDefined();
    expect(Object.hasOwn(c!.fields!, "a")).toBe(true);
    expect(Object.getPrototypeOf(c!.fields!)).toBe(null);
  });
});
