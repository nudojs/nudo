/**
 * DESIGN-003 — sidecar 生成段的「身份 / 绑定」分离：
 * 契约身份恒为**导出名**（generatedExportNames 键 / interface 行 / 诊断），
 * 绑定名不安全（保留字 / 非 ident / 与既有绑定撞名）时发射别名形态
 * `const _nudo_<n> = <expr>; export { _nudo_<n> as <name> };`。
 *
 * 与 9029d094 的 toJsBindingIdent（单向投影模块的绑定名消毒）互补：
 * sidecar 是会回读身份的往返产物，绑定可换名、身份不可。
 */
import { isJsBindingIdent } from "@nudojs/core/internal";

/** IdentifierName 形状（保留字导出名在 export 子句槽位合法；含 Unicode）。 */
const JS_EXPORT_NAME = /^(?:[$_\p{ID_Start}])(?:[$\u200C\u200D\p{ID_Continue}])*$/u;

/**
 * export 子句里的导出名表示：IdentifierName 裸写（`as class` 合法），
 * 否则 JSON 引号串（`as "a-b"`）。
 */
export function exportNameRepr(name: string): string {
  return JS_EXPORT_NAME.test(name) ? name : JSON.stringify(name);
}

/**
 * 段落可否直接以 `export const <name>` 发射：合法绑定名且未被占用。
 * 占用含手写绑定 / 既有段落绑定（同文件撞名走别名）。
 */
export function directBindingOk(name: string, taken: (name: string) => boolean): boolean {
  return isJsBindingIdent(name) && !taken(name);
}

/**
 * 别名绑定分配：最小可用 `_nudo_<n>`（n 从 1 起）。编号按分配序确定性递增，
 * update 剥离生成段后重排会得到同一批别名（幂等）；`_nudo_` 前缀与用户绑定
 * 天然错开，撞名只来自上一段别名（顺序递增即互异）。
 */
export function allocNudoBinding(taken: (name: string) => boolean): string {
  let n = 1;
  while (taken(`_nudo_${n}`)) n++;
  return `_nudo_${n}`;
}
