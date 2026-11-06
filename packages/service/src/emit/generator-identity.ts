/**
 * 生成器对象身份在**运行时产物面**的单一判据（Bug fix，2026-11-05）。
 *
 * 背景：`Abs.facets.brand` 随值携带 `"Generator"` / `"AsyncGenerator"`（core
 * `exec/runtime/async.ts::makeGenObject`），dts 面已经消费它输出
 * `Generator<T, …>`；但 zod / standard / guard 三个运行时校验器面此前只做
 * **结构投影**（internal 槽被摘空 ⇒ `z.object({  })` / `typeof v === "object"`）
 * ⇒ 导出的校验器接受任意普通对象，与 dts 面的声明域相反。按产品裁决，这是
 * **校验器没有执行已声明类型的 bug**（不是产品语义变更），故三面统一收紧。
 *
 * 判据只认 `facets.brand` 的两个 tag：
 * - 不用 `next` / `@@iterator` 槽启发式（普通迭代器对象也有 `next`，按它收紧
 *   会把合法的手工迭代器判成违规；且 BUG-130 的负控制夹具无 brand ⇒ 旧 Abs
 *   保持结构面，逐字不变）；
 * - 不用 `z.instanceof`：运行时没有全局 `GeneratorFunction` 构造器，生成器
 *   对象的原型构造器名是 `""`（见 `emit-generator-identity-poc.test.ts` 的
 *   方案 (b) 实证），把名字塞进白名单会让产物模块求值期抛 ReferenceError。
 *
 * 已知边界：`Object.prototype.toString` 读的是 `Symbol.toStringTag` ⇒ 可以
 * 伪造（与 `z.instanceof(Date)` 可通过改原型伪造同类）；换取的是**跨 realm
 * 可判**。2026-11-06 用 `node:vm` 实测过原型链判据
 * （`%GeneratorPrototype%.isPrototypeOf`）：它确实不可伪造，但会把另一个
 * realm 的真生成器**误拒** ⇒ 结论是保留本判据，把可伪造记为边界
 * （回归见 `emit-generator-identity-poc.test.ts`「判别谓词取舍实测」）。
 * 产物只依赖 `Object.prototype.toString`，无外部标识符、无新增 import。
 *
 * 递归口径：`denoteGuardB`（core）与 `syncGeneratorTags`（service 约束投影
 * 通道）在**任意层级**消费 `facets.brand`；本模块只负责 service 侧判据。
 */
import type { Abs } from "@nudojs/core";

/** 随值携带的生成器身份 tag（与 core `makeGenObject` 的 `facets.brand` 同值）。 */
export type GeneratorTag = "Generator" | "AsyncGenerator";

/**
 * Abs → 生成器身份 tag。**唯一触发判据**：缺省（手工构造 / 旧 Abs / 快照丢槽）
 * ⇒ 不投影身份，保持既有结构投影，零回归。
 */
export function generatorTagOf(a: Abs): GeneratorTag | undefined {
  const brand = a.facets?.brand;
  return brand === "Generator" || brand === "AsyncGenerator" ? brand : undefined;
}

/** 运行时判别（库函数版；与产物内联的 `__nudoCheck` 同口径）。 */
export function generatorTagFromValue(value: unknown): GeneratorTag | undefined {
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Generator]") return "Generator";
  if (tag === "[object AsyncGenerator]") return "AsyncGenerator";
  return undefined;
}

/**
 * 产物里的身份子句源码（zod / guard 共用）。`v` 是产物里承接被检查值的
 * 表达式（`v` / `data`），tag 只可能是两个固定字面量 ⇒ 拼接安全。
 */
export function generatorTagCheckSource(v: string, tag: GeneratorTag): string {
  return `Object.prototype.toString.call(${v}) === "[object ${tag}]"`;
}
