/**
 * export — zod 产物面：`<fn>Input`（参数对象）+ `<fn>Output`（返回面）。
 *
 * 一个可 import 的 zod 模块：入参面口径与 standard / dts 面对齐（同一个
 * `paramExps`），缺省即必填（契约是用户申报的调用域，权威）。
 */
import { obj, type Abs } from "@nudojs/core";
import { absToZodSchemaModule, type ZodModuleProjection } from "@nudojs/service/emit";
import type { ParamFace } from "./contract-face.ts";

/** zod 入参槽：参数面 → zod 对象槽（契约级可选性 ⇒ `.optional()`）。 */
export type ZodInputSlots = Record<string, { value: Abs; optional?: boolean }>;

/**
 * zod 入参槽表：参数面 → `<fn>Input` 的对象槽。
 *
 * 契约级**顶层形参可选性**（Bug 536）：可选位在 zod 面是 `.optional()`，
 * 缺省即必填（契约是用户申报的调用域，权威）。
 *
 * **Bug 606**：槽表用**无原型对象**（`Object.create(null)`）装配——普通对象带
 * `Object.prototype.__proto__` 的 **setter** ⇒ 形参名 `__proto__` 的赋值被
 * 原型 setter 吞掉（该键永不成自有属性）⇒ `Object.entries()` 看不到它 ⇒
 * `obj(slots)` 拿不到该槽 ⇒ **zod 面丢形参**（dts 面走另一条路径，是对的）
 * ⇒ 跨产物面自相矛盾。无原型对象没有该 setter ⇒ `__proto__` 落为普通自有键
 * （`constructor` / `toString` 等继承键同理）。
 */
export function zodInputSlots(paramExps: readonly ParamFace[]): ZodInputSlots {
  const slots = Object.create(null) as ZodInputSlots;
  for (const p of paramExps) {
    slots[p.name] = {
      value: p.abs,
      ...(p.optional === true ? { optional: true } : {}),
    };
  }
  return slots;
}

/**
 * zod 面的导出条目（**有序**）：`<fn>Input` 恒在，`<fn>Output` 仅在有返回面时。
 *
 * 有序返回是为了让调用方按序并入导出表 ⇒ 生成的 zod 模块导出顺序与函数顺序
 * 一致（可钉住）。
 */
export function zodFaceEntries(
  baseName: string,
  paramExps: readonly ParamFace[],
  outputAbs: Abs | undefined,
): Array<[string, Abs]> {
  const entries: Array<[string, Abs]> = [[`${baseName}Input`, obj(zodInputSlots(paramExps))]];
  if (outputAbs) entries.push([`${baseName}Output`, outputAbs]);
  return entries;
}

/**
 * zod 模块渲染：导出表 → 可 import 的 zod 模块源码（空表 = 无模块）。
 */
export function renderZodModule(
  schemaExports: Readonly<Record<string, Abs>>,
): ZodModuleProjection | undefined {
  if (Object.keys(schemaExports).length === 0) return undefined;
  return absToZodSchemaModule(schemaExports);
}
