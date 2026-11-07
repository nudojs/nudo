/**
 * JS Error 家族构造器名——**唯一事实源**（无依赖叶子：本文件不 import 任何模块）。
 *
 * 消费方：
 * - builtins/error/error-family.ts（isErrorCtorName / errorBrandAbs 族判定）
 * - exec/class-registry.ts（BUILTIN_ERROR_SUPER 键集 = 内建错误层级）
 *
 * 不得反向引 exec/builtins：error-family → exec/may-throw → … → exec/class-registry
 * 是既有链，class-registry 若直接引 error-family 即构成环；故集合放本叶子。
 */

/** JS Error 家族构造器名（求值引擎 evalBuiltinNew / $new / 内建错误层级共用） */
export const ERROR_CTOR_NAMES: ReadonlySet<string> = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

export function isErrorCtorName(name: string | undefined): boolean {
  return !!name && ERROR_CTOR_NAMES.has(name);
}
