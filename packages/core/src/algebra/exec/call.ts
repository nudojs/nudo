/**
 * 调用 Abs 一等函数（absFunction impl）或 mock apply。
 * 供 B 路径 import 绑定包装：`(...args) => $call(absFn, args)`。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown } from "../abs.ts";
import { getFnImpl } from "../abs-fn.ts";
import { evalNode, emptyEnv, type AstEnv } from "../ast-eval.ts";
import { defaultLeakBudget } from "../leak.ts";
import { pTrue } from "../pred.ts";

export function $call(fn: Abs, args: Abs[]): Abs {
  const impl = getFnImpl(fn);
  if (!impl) {
    if (fn?.shape?.k === "fn") return unknown;
    return unknown;
  }
  if (impl.apply) return impl.apply(args);
  const base = impl.env ?? emptyEnv();
  let local: AstEnv = { vars: new Map(base.vars), fns: base.fns };
  if (base.classes) local = { ...local, classes: base.classes };
  impl.params.forEach((p, i) => {
    local.vars.set(p, args[i] ?? unknown);
  });
  const r = evalNode(impl.body, local, pTrue, defaultLeakBudget);
  if (r.threw) return abs({ k: "never" }, undefined, undefined, "exact");
  return r.value;
}
