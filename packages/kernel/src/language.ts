/**
 * 语言覆盖：class / new / instanceof / this / async await。
 * brand 表示名义类；eff("promise") 表示异步效应。
 *
 * 方法体：ClassDef.methods 存 AST body，调用时在 this=receiver 下求值。
 */

import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import { abs, confJoin, unknown } from "./abs.ts";
import type { AstEnv } from "./ast-eval.ts";

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

function classesOf(env: AstEnv): Map<string, ClassDef> {
  const e = env as EnvWithClasses;
  if (!e.classes) e.classes = new Map();
  return e.classes;
}

export function defineClass(env: AstEnv, def: ClassDef): void {
  classesOf(env).set(def.name, def);
}

export function getClass(env: AstEnv, name: string): ClassDef | undefined {
  return (env as EnvWithClasses).classes?.get(name);
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

/** new C(...) → brand 实例；并跑 constructor 以写入字段 */
export function instantiateClass(
  env: AstEnv,
  className: string,
  args: Abs[],
  evalBody?: (fn: { params: string[]; body: Node }, args: Abs[], thisVal: Abs, env: AstEnv) => Abs,
): Abs {
  const def = getClass(env, className);
  if (!def) {
    return abs(
      {
        k: "brand",
        name: className,
        shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact"),
      },
      undefined,
      undefined,
      "partial",
    );
  }

  // 先用声明 shape 建实例（含方法）
  let instance = abs(
    { k: "brand", name: className, shape: def.instanceShape },
    undefined,
    undefined,
    "path",
  );

  // 跑 constructor：this 上赋值会更新 instance 字段
  const ctor = def.methods.get("constructor");
  if (ctor && evalBody) {
    const fields = evalBody(ctor, args, instance, env);
    instance = mergeInstanceFields(instance, fields, className);
  }

  return instance;
}

/** constructor 副作用后的字段并入 brand.shape */
function mergeInstanceFields(instance: Abs, fields: Abs, className: string): Abs {
  if (instance.shape.k !== "brand") return instance;
  const base = instance.shape.shape;
  const slots: Record<string, { value: Abs }> =
    base.shape.k === "obj" ? { ...base.shape.slots } : {};

  // fields 可能是更新后的 this（brand）或裸 obj
  const fieldObj =
    fields.shape.k === "brand" ? fields.shape.shape : fields;
  if (fieldObj.shape.k === "obj") {
    for (const [k, s] of Object.entries(fieldObj.shape.slots)) {
      slots[k] = s;
    }
  }
  return abs(
    {
      k: "brand",
      name: className,
      shape: abs({ k: "obj", slots }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    instance.conf,
  );
}

/**
 * instanceof：沿继承链匹配 brand 名。
 */
export function instanceOf(
  left: Abs,
  rightClassName: string,
  env?: AstEnv,
): Abs {
  if (left.shape.k === "brand") {
    const chainNames = env
      ? getClassChain(env, left.shape.name).map((c) => c.name)
      : [left.shape.name];
    if (chainNames.includes(rightClassName) || left.shape.name === rightClassName) {
      return { shape: { k: "prim", type: "boolean" }, term: litTrue(), conf: "exact" };
    }
    return { shape: { k: "prim", type: "boolean" }, term: litFalse(), conf: "exact" };
  }
  if (left.shape.k === "unknown") {
    return { shape: { k: "prim", type: "boolean" }, conf: "partial" };
  }
  return { shape: { k: "prim", type: "boolean" }, term: litFalse(), conf: "path" };
}

function litTrue() {
  return { op: "lit" as const, value: true };
}
function litFalse() {
  return { op: "lit" as const, value: false };
}

export function projectBrand(self: Abs, key: string): Abs {
  if (self.shape.k !== "brand") return unknown;
  const inner = self.shape.shape;
  if (inner.shape.k === "obj") {
    const slot = inner.shape.slots[key];
    if (slot) return slot.value;
  }
  return unknown;
}

/** 在 brand 上查找方法定义（含继承） */
export function lookupMethod(
  env: AstEnv,
  receiver: Abs,
  methodName: string,
): MethodDef | undefined {
  if (receiver.shape.k !== "brand") return undefined;
  const chain = getClassChain(env, receiver.shape.name);
  for (const cls of chain) {
    const m = cls.methods.get(methodName);
    if (m) return m;
  }
  return undefined;
}

export function wrapPromise(inner: Abs): Abs {
  return abs(
    { k: "eff", eff: "promise", inner },
    undefined,
    undefined,
    confJoin(inner.conf, "path"),
  );
}

export function awaitAbs(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") {
    return v.shape.inner;
  }
  return v;
}

export function coerceAsyncReturn(value: Abs): Abs {
  if (value.shape.k === "eff") return value;
  return wrapPromise(value);
}

/** 从 ClassMethod 列表构造 methods map + instance shape */
export function classFromMethods(
  name: string,
  methods: MethodDef[],
  superClass?: string,
  superShape?: Abs,
): ClassDef {
  const methodMap = new Map<string, MethodDef>();
  const slots: Record<string, { value: Abs }> = {};
  if (superShape?.shape.k === "obj") {
    for (const [k, s] of Object.entries(superShape.shape.slots)) {
      slots[k] = s;
    }
  }
  for (const m of methods) {
    methodMap.set(m.name, m);
    if (m.kind !== "constructor") {
      slots[m.name] = {
        value: abs({ k: "fn", params: m.params, name: m.name }, undefined, undefined, "exact"),
      };
    }
  }
  return {
    name,
    instanceShape: abs({ k: "obj", slots }, undefined, undefined, "exact"),
    ctorParams: methodMap.get("constructor")?.params ?? [],
    methods: methodMap,
    superClass,
  };
}
