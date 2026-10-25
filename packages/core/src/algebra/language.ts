/**
 * 语言覆盖（保留面）：class 继承链查询 + Promise 效应包装。
 *
 * class / new / instanceof / async 的求值语义已由 exec 内核（class-registry /
 * `$call`）承载；本文件只保留两个仍有跨包消费者的叶子：
 * - `getClassChain`：leq 的 brand 继承链判定（`leq.ts`）
 * - `wrapPromise`：契约面把同步返回值包成 promise 效应（nudojs 导出面）
 */

import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import { abs, confJoin } from "./abs.ts";
import type { AstEnv } from "./ast-env.ts";

export type MethodDef = {
  name: string;
  params: string[];
  body: Node;
  kind?: string; // "constructor" | "method" | "get" | ...
  async?: boolean;
};

export type ClassDef = {
  name: string;
  instanceShape: Abs;
  ctorParams: string[];
  methods: Map<string, MethodDef>;
  superClass?: string;
};

type EnvWithClasses = AstEnv & { classes?: Map<string, ClassDef> };

function getClass(env: AstEnv, name: string): ClassDef | undefined {
  return (env as EnvWithClasses).classes?.get(name) as ClassDef | undefined;
}

/** 沿继承链找类 */
export function getClassChain(env: AstEnv, name: string): ClassDef[] {
  const chain: ClassDef[] = [];
  let cur: string | undefined = name;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const def = getClass(env, cur);
    if (!def) break;
    chain.push(def);
    cur = def.superClass;
  }
  return chain;
}

export function wrapPromise(inner: Abs): Abs {
  return abs(
    { k: "eff", eff: "promise", inner },
    undefined,
    undefined,
    confJoin(inner.conf, "path"),
  );
}
