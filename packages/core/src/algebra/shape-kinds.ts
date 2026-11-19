/**
 * Abs 形状变体的**唯一清单**（穷尽性护栏）。
 *
 * 背景：`Shape` 是 11 个变体的判别联合，全仓有 1300+ 处 `shape.k === "…"`
 * 的开码分派，且没有统一的 `assertNever` 兜底 ⇒ 新增/罕见变体（brand / sum /
 * eff）在多数判据里落进 else，于是「我不认识」被静默当成「它合法」
 * （值的缺席读折成 exact undefined、契约门直接放行）。C1 那 10 条缺陷的共同
 * 机制就是这个。
 *
 * 本文件提供两件事：
 *
 * 1. `SHAPE_KINDS` + 类型级断言：`Shape["k"]` 新增变体而清单没跟上 ⇒ **编译
 *    错误**（不是等某个判据跑出假绿才发现）。
 * 2. `assertNeverShape`：`switch (shape.k)` 的 default 兜底。写漏一臂 ⇒ 编译
 *    错误；真跑到了 ⇒ 立刻抛（而不是静默返回 false / undefined）。
 *
 * 用法（判据函数）：
 *
 * ```ts
 * switch (shape.k) {
 *   case "prim": return …
 *   case "obj":  return …
 *   // …每一臂都显式表态…
 *   default: return assertNeverShape(shape);
 * }
 * ```
 *
 * 注意：**不要**给 `default` 写「保守放行」的分支。`default` 只允许是
 * `assertNeverShape`；需要「未知形态按 may / 违例处理」时，那属于 `unknown` /
 * `any` 变体自己的臂，不是兜底。
 */
import type { Shape } from "./abs.ts";

/** 全部形状变体（顺序与 `Shape` 联合的声明序一致，便于逐条对照）。 */
export const SHAPE_KINDS = [
  "never",
  "any",
  "unknown",
  "prim",
  "obj",
  "arr",
  "tuple",
  "fn",
  "eff",
  "brand",
  "sum",
] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** 类型级断言：`T` 必须是 `never`（多一个 / 少一个变体都编译失败）。 */
type AssertNever<T extends never> = T;

/** 清单漏了 `Shape` 里的变体 ⇒ 这里的类型不是 never ⇒ 编译错误。 */
export type ShapeKindsAreExhaustive = AssertNever<Exclude<Shape["k"], ShapeKind>>;

/** 清单里写了 `Shape` 不存在的变体（拼错 / 已删除）⇒ 编译错误。 */
export type ShapeKindsAreKnown = AssertNever<Exclude<ShapeKind, Shape["k"]>>;

/**
 * `switch (shape.k)` 的 default 兜底：编译期要求此处 `shape` 已被收窄成
 * `never`，运行期抛（防御：AST/数据来自外部时类型断言可能撒谎）。
 */
export function assertNeverShape(shape: never): never {
  const k = (shape as { k?: unknown } | undefined)?.k;
  throw new Error(`unhandled Abs shape: ${String(k)}`);
}
