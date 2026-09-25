/**
 * AstEnv：抽象求值环境类型面（ast-eval 删除后保留）。
 * 类型定义在 hof-types.ts（打破 ast-env ↔ hof ↔ abs-fn 类型环）；
 * 本文件保留空环境 / withVar 的便捷构造并重导出 AstEnv 供稳定路径导入。
 * 仍被 B 路径 check / leq / generalize / builtins 消费。
 */

import type { Abs } from "./abs.ts";
import type { AstEnv } from "./hof-types.ts";

export type { AstEnv } from "./hof-types.ts";

/** 空求值环境（分析宿主用：不带任何绑定） */
export function emptyEnv(): AstEnv {
  return { vars: new Map(), fns: new Map() };
}

export function withVar(env: AstEnv, name: string, value: Abs): AstEnv {
  const vars = new Map(env.vars);
  vars.set(name, value);
  return { vars, fns: env.fns };
}
