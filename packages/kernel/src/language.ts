/**
 * 语言覆盖：class / new / instanceof / this / async await。
 * brand 表示名义类；eff("promise") 表示异步效应。
 */

import type { Abs, Shape } from "./abs.ts";
import { abs, confJoin, unknown, never } from "./abs.ts";
import type { AstEnv } from "./ast-eval.ts";

export type ClassDef = {
  name: string;
  /** 实例 shape（方法 + 字段） */
  instanceShape: Abs;
  /** 构造函数参数名 */
  ctorParams: string[];
  ctorBody?: unknown;
  /** 基类名（简单继承：brand 名 + meet shape） */
  superClass?: string;
};

/** env 中登记 class */
export function defineClass(
  env: AstEnv,
  name: string,
  def: Omit<ClassDef, "name"> & { name?: string },
): void {
  const classes = (env as AstEnv & { classes?: Map<string, ClassDef> }).classes
    ?? ((env as AstEnv & { classes?: Map<string, ClassDef> }).classes = new Map());
  classes.set(name, { ...def, name });
}

export function getClass(env: AstEnv, name: string): ClassDef | undefined {
  return (env as AstEnv & { classes?: Map<string, ClassDef> }).classes?.get(name);
}

/** new C(...) → brand 实例 */
export function instantiateClass(
  env: AstEnv,
  className: string,
  _args: Abs[],
): Abs {
  const def = getClass(env, className);
  if (!def) {
    // 未知类：brand + empty obj
    return abs(
      { k: "brand", name: className, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "partial",
    );
  }
  return abs(
    { k: "brand", name: className, shape: def.instanceShape },
    undefined,
    undefined,
    "path",
  );
}

/**
 * instanceof：brand 名匹配 → true；已知 brand 不匹配 → false；否则 boolean。
 */
export function instanceOf(left: Abs, rightClassName: string): Abs {
  if (left.shape.k === "brand") {
    if (left.shape.name === rightClassName) {
      return { shape: { k: "prim", type: "boolean" }, term: litTrue(), conf: "exact" };
    }
    // 简单继承链：沿 brand.shape 若也是 brand 可扩展；Phase 先只比名字
    return { shape: { k: "prim", type: "boolean" }, term: litFalse(), conf: "exact" };
  }
  if (left.shape.k === "unknown") {
    return { shape: { k: "prim", type: "boolean" }, conf: "partial" };
  }
  // 非 brand 结构（literal/object）→ false（除 Function 等特例留给旧路径）
  return { shape: { k: "prim", type: "boolean" }, term: litFalse(), conf: "path" };
}

function litTrue() {
  return { op: "lit" as const, value: true };
}
function litFalse() {
  return { op: "lit" as const, value: false };
}

/** brand 上投影属性 */
export function projectBrand(self: Abs, key: string): Abs {
  if (self.shape.k !== "brand") return unknown;
  const inner = self.shape.shape;
  if (inner.shape.k === "obj") {
    const slot = inner.shape.slots[key];
    if (slot) return slot.value;
  }
  return unknown;
}

/** 包一层 promise */
export function wrapPromise(inner: Abs): Abs {
  return abs({ k: "eff", eff: "promise", inner }, undefined, undefined, confJoin(inner.conf, "path"));
}

/** await：解 eff；非 eff 原样 */
export function awaitAbs(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") {
    return v.shape.inner;
  }
  if (v.shape.k === "sum") {
    // 不能直接 map；保守 unknown
    return unknown;
  }
  return v;
}

/** async 函数返回值自动包 promise（若尚未是） */
export function coerceAsyncReturn(value: Abs): Abs {
  if (value.shape.k === "eff") return value;
  return wrapPromise(value);
}

/** 从 ClassMethod 节点列表构造 instance shape */
export function shapeFromMethods(
  methods: Array<{ name: string; params: string[]; body: unknown; kind?: string }>,
  superClassShape?: Abs,
): Abs {
  const slots: Record<string, { value: Abs }> = {};
  if (superClassShape?.shape.k === "obj") {
    for (const [k, s] of Object.entries(superClassShape.shape.slots)) {
      slots[k] = s;
    }
  }
  for (const m of methods) {
    if (m.kind && m.kind !== "method") continue;
    slots[m.name] = {
      value: abs({ k: "fn", params: m.params, name: m.name }, undefined, undefined, "exact"),
    };
  }
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}
