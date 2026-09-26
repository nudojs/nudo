/**
 * `@nudo:skip [returnsExpr]` 采集（host 侧）。
 *
 * core 的 `checkSource` 不依赖 parser，所以 skip 指令由 host（CLI / LSP /
 * vite-plugin）解析后经 `CheckOptions.skips` 下传——保证 check 面与 test 面
 * 对 skip 的口径一致：不评估 body、退出 L1/L2 门禁。
 */
import type { Abs } from "@nudojs/core";
import { extractDirectives, parse } from "@nudojs/parser";

/**
 * 每个带 `@nudo:skip` 的顶层函数 → 声明的返回 Abs；`null` = 未声明返回类型。
 * 解析失败（语法错误等）→ 空表（check 退回默认路径，不静默吞函数）。
 */
export function collectSkipReturns(source: string): Map<string, Abs | null> {
  const out = new Map<string, Abs | null>();
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch {
    return out;
  }
  for (const fn of extractDirectives(ast)) {
    const skip = fn.directives.find((d) => d.kind === "skip");
    if (skip && skip.kind === "skip") out.set(fn.name, skip.returns ?? null);
  }
  return out;
}
