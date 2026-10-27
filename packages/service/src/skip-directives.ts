/**
 * `@nudo:skip [returnsExpr]` 采集（host 侧）。
 *
 * core 的 `checkSource` 不依赖 parser，所以 skip 指令由 host（CLI / LSP /
 * vite-plugin）解析后经 `CheckOptions.skips` 下传——保证 check 面与 test 面
 * 对 skip 的口径一致：不评估 body、退出 L1/L2 门禁。
 */
import type { Abs } from "@nudojs/core";
import { extractDirectivesQuiet, listFnDirectiveScopes, parse } from "@nudojs/parser";

/**
 * 每个带 `@nudo:skip` 的顶层函数 → 声明的返回 Abs；`null` = 未声明返回类型。
 * 解析失败（语法错误等）→ 空表（check 退回默认路径，不静默吞函数）。
 *
 * BUG-283：scope 名**不唯一**（同名嵌套函数）⇒ 返回表按**名字**建，因此
 * 绑定必须按「同名取**词法最浅**」裁决（与 core `findFnDirectiveScope`
 * 同口径，`docs/design/directive-scope.md` 的「AST 最近 Function」）。
 * 此前直接 `out.set(fn.name, …)` ⇒ 文档序后写者（内层）胜：
 * - **偷取**：内层同名函数的 `@nudo:skip => string()` 顶掉外层的 `=> number()`；
 * - **越界**：外层**没有** skip 时，内层同名函数的 skip 仍作用到导出函数上
 *   （外层 body 不再评估 ⇒ throws 标注被抹掉 ⇒ 门禁少报 may-throw）。
 * 最浅深度按**全部** scope 统计（不只是带指令的那些）——外层没有 skip 时
 * 它仍然占据该名的绑定位置。
 */
export function collectSkipReturns(source: string): Map<string, Abs | null> {
  const out = new Map<string, Abs | null>();
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch {
    return out;
  }
  const shallowest = new Map<string, number>();
  for (const scope of listFnDirectiveScopes(ast)) {
    const depth = scope.depth ?? 0;
    const prev = shallowest.get(scope.name);
    if (prev === undefined || depth < prev) shallowest.set(scope.name, depth);
  }
  // Quiet extract：纯查询不得把指令文法诊断留在全局 buffer（在途 validate 会误窃）
  for (const fn of extractDirectivesQuiet(ast)) {
    const skip = fn.directives.find((d) => d.kind === "skip");
    if (!skip || skip.kind !== "skip") continue;
    if ((fn.depth ?? 0) !== (shallowest.get(fn.name) ?? 0)) continue;
    out.set(fn.name, skip.returns ?? null);
  }
  return out;
}
