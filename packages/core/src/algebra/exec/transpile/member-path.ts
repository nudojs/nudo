/**
 * 成员/下标链 → 可重绑路径（$get/$set/$idx/$idxSet）。
 * computed key 经 transpile-dispatch 调 transpileExpression（避免与 expr.ts 成环）。
 */
import type { Node, Expression } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";
import { isExpression } from "./helpers.ts";

export type MemberLayer = { get: (base: string) => string; set: (base: string, v: string) => string };
export type MemberPath = { rootSrc: string; layers: MemberLayer[] };

/**
 * 成员/下标链 → 可重绑路径。根必须是标识符（或 transpile this 参数），
 * 其余（调用结果、new 表达式等）不可重绑 → null。
 */
export function memberPathOf(m: { object: Node; property: Node; computed: boolean }, opts: TranspileOptions): MemberPath | null {
  const layers: MemberLayer[] = [];
  let cur: Node = m as unknown as Node;
  let rootSrc: string | null = null;
  while (cur.type === "MemberExpression") {
    const mm = cur as unknown as { object: Node; property: Node; computed: boolean };
    const k = mm.property;
    if (mm.computed) {
      if (k.type === "NumericLiteral") {
        const key = `$lit(${k.value})`;
        layers.unshift({
          get: (b) => `$idx(${b}, ${key})`,
          set: (b, v) => `$idxSet(${b}, ${key}, ${v})`,
        });
      } else if (k.type === "StringLiteral") {
        const key = JSON.stringify(k.value);
        layers.unshift({
          get: (b) => `$get(${b}, ${key})`,
          set: (b, v) => `$set(${b}, ${key}, ${v})`,
        });
      } else if (isExpression(k)) {
        const key = emitTranspileExpression(k, opts);
        layers.unshift({
          get: (b) => `$idx(${b}, ${key})`,
          set: (b, v) => `$idxSet(${b}, ${key}, ${v})`,
        });
      } else {
        return null;
      }
    } else if (k.type === "Identifier") {
      const key = JSON.stringify(k.name);
      layers.unshift({
        get: (b) => `$get(${b}, ${key})`,
        set: (b, v) => `$set(${b}, ${key}, ${v})`,
      });
    } else {
      return null;
    }
    cur = mm.object;
  }
  if (cur.type === "Identifier") {
    // `arguments` 写回根必须是 $arguments 槽（strict 独立映射）；无绑定不可重绑
    if (cur.name === "arguments") {
      if (!opts.argsBinding) return null;
      rootSrc = opts.argsBinding;
    } else {
      rootSrc = cur.name;
    }
  } else if (cur.type === "ThisExpression" && opts.thisParam) {
    rootSrc = opts.thisParam;
  } else {
    return null;
  }
  return { rootSrc, layers };
}

/** 路径读取源：d[i][0] → $idx($idx(d, i), 0) */
export function readPathSrc(p: MemberPath): string {
  return p.layers.reduce((acc, l) => l.get(acc), p.rootSrc);
}

/** 路径写入源（返回新根）：d[i][0]=v → $idxSet(d, i, $idxSet($idx(d,i), 0, v)) */
export function setPathSrc(p: MemberPath, valSrc: string): string {
  let acc = valSrc;
  for (let i = p.layers.length - 1; i >= 0; i--) {
    const l = p.layers[i]!;
    const base = i === 0 ? p.rootSrc : readPrefix(p, i - 1);
    acc = l.set(base, acc);
  }
  return acc;
}

/** 前 j 层的读取源 */
export function readPrefix(p: MemberPath, j: number): string {
  return p.layers.slice(0, j + 1).reduce((acc, l) => l.get(acc), p.rootSrc);
}

/** 路径「去掉最后一层」的写回源：delete o.a.b ⇒ o = $set(o, "a", $del($get(o,"a"), "b")) */
export function setParentPathSrc(p: MemberPath, valSrc: string): string {
  let acc = valSrc;
  for (let i = p.layers.length - 2; i >= 0; i--) {
    const l = p.layers[i]!;
    const base = i === 0 ? p.rootSrc : readPrefix(p, i - 1);
    acc = l.set(base, acc);
  }
  return acc;
}
