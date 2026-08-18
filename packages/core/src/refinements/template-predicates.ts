import type { TypeValue } from "../type-value.ts";

/**
 * 模板字面量谓词，独立于 template.ts 以断开运行时循环引用：
 * type-value.ts（联合吸收律）与 template.ts 都依赖本模块，而本模块对
 * type-value.ts 只有 `import type` 边（编译后消失），运行时依赖保持单向
 * type-value.ts / template.ts -> template-predicates.ts。
 */
export function isTemplate(tv: TypeValue): boolean {
  return tv.kind === "refined" && Array.isArray(tv.refinement.meta.parts);
}
