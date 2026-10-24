/**
 * `@nudo:pure` 纯度标记（Bug 462 · 分片 J 之后的 fresh 语义）。
 *
 * memo 以**对象身份**为键（core 的 pureCallMemo / pureMemo：
 * WeakMap<fnObj, argsKey, …>）——标记必须落在**调用点真正解析到的那个函数
 * 值**上，否则恒不命中。
 *
 * 分片 J 之后求值面有了「fresh 实例」概念（`tryRunEval` 的 `fresh` 开关：
 * 调用面每次新建独立模块实例，fresh 结果不入 memo 的 value）——标记若只
 * 落在 memo 里那份旧实例上，调用面用的 fresh 实例就没有标记 ⇒ memo 恒空转。
 *
 * 因此标记统一在**实例诞生地**（`eval-run.ts` 的 `tryRunEval`：每次
 * `runTranspiled` 之后）落下：memo 实例与 fresh 实例都带标记 ⇒ 标记与
 * 调用点解析到同一对象身份。
 */
import { bindingsOf, markPureFn } from "@nudojs/core";
import { extractDirectivesQuiet } from "@nudojs/parser";

/**
 * 纯度标记：Abs fn 值走 core 的 `markPureFn`；**宿主 JS 函数对象** core 的
 * markPureFn 拒收（abs-fn.ts 的 guard 只收 object），而求值引擎读的正是
 * `fn._memoize`（pureFnNameOf）——这里直接落同一标记，使「顶层函数声明」
 * 形态（转译面把顶层函数声明提升为 export → 调用点解析到宿主函数对象）
 * 的 memo 真正生效。core 侧 markPureFn 应放行 function（越界项，见报告）。
 */
export function markPureTarget(target: unknown, name: string): void {
  if (!target || (typeof target !== "object" && typeof target !== "function")) return;
  if (typeof target === "object") {
    markPureFn(target as object, name);
    return;
  }
  (target as { _memoize?: string })._memoize = name;
}

/**
 * 源码里的纯函数名（`@nudo:pure` 的函数作用域）——与 analyzer 的
 * `functions` 口径同源（`extractDirectives` 的 pure 指令、skip 除外）。
 */
export function pureFnNamesOfAst(ast: unknown): string[] {
  const fns = extractDirectivesQuiet(ast as never);
  const out: string[] = [];
  for (const fn of fns) {
    if (typeof fn.name !== "string" || fn.name.length === 0) continue;
    if (!fn.directives.some((d) => d.kind === "pure")) continue;
    if (fn.directives.some((d) => d.kind === "skip")) continue;
    out.push(fn.name);
  }
  return out;
}

/**
 * 把纯度标记落到**刚诞生的实例**上（导出表 + 绑定表两种形态）：
 * - 顶层函数声明：转译面提升为 export → 宿主 JS 函数对象；
 * - 函数表达式（const/let 绑定）：Abs fn 值（recordBinding 记录）。
 */
export function applyPureMarkers(
  exports: Record<string, unknown> | undefined,
  names: string[],
): void {
  if (!exports || names.length === 0) return;
  const binds = bindingsOf(exports);
  for (const name of names) {
    if (Object.hasOwn(exports, name)) markPureTarget(exports[name], name);
    markPureTarget(binds?.get(name), name);
  }
}
