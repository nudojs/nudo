/**
 * 语言覆盖：class / new / instanceof / this / async await。
 * brand 表示名义类；eff("promise") 表示异步效应。
 *
 * 方法体：ClassDef.methods 存 AST body，调用时在 this=receiver 下求值。
 */

import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import { abs, confJoin, litValue, unknown } from "./abs.ts";
import { isNullishLitAbs } from "./surface.ts";
import { getSlot } from "./objects.ts";
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

function classesOf(env: AstEnv): Map<string, ClassDef> {
  const e = env as EnvWithClasses;
  if (!e.classes) e.classes = new Map();
  return e.classes;
}

export function defineClass(env: AstEnv, def: ClassDef): void {
  classesOf(env).set(def.name, def);
}

export function getClass(env: AstEnv, name: string): ClassDef | undefined {
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

  // constructor：自身优先；没有则沿继承链找父类构造
  const chain = getClassChain(env, className);
  let ctor: MethodDef | undefined;
  let ctorClass: ClassDef | undefined;
  for (const cls of chain) {
    const m = cls.methods.get("constructor");
    if (m) {
      ctor = m;
      ctorClass = cls;
      break;
    }
  }
  if (ctor && evalBody) {
    // 绑定 super → 父类（ctor 所在类的 superClass）
    const parentName = ctorClass?.superClass;
    const localEnv = parentName
      ? withSuperBinding(env, className, parentName)
      : env;
    const fields = evalBody(ctor, args, instance, localEnv);
    instance = mergeInstanceFields(instance, fields, className);
  }

  return instance;
}

/** 在 env 上绑定 super 类名，供 super.method() 派发 */
function withSuperBinding(env: AstEnv, className: string, superName: string): AstEnv {
  return { ...env, currentOwner: className };
}

/** 读取当前 this 所属类的父类名 */
export function superNameOf(env: AstEnv, className: string): string | undefined {
  return getClass(env, className)?.superClass;
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
 * instanceof：沿继承链匹配 brand 名；数组/对象/函数/Promise/prim 按
 * JS 真实语义判定（arr instanceof Array → true、5 instanceof Number → false）。
 * 左侧为 null/undefined 字面量时原生抛 TypeError → 不可判定。
 */
const BUILTIN_ERROR_SUPER: Record<string, string> = {
  Error: "",
  RangeError: "Error",
  TypeError: "Error",
  ReferenceError: "Error",
  SyntaxError: "Error",
  URIError: "Error",
  EvalError: "Error",
  AggregateError: "Error",
};

/** 品牌沿注册/内建层级上溯的父名序列（含自身；限深防环） */
export function classChainNames(name: string, env?: AstEnv): string[] {
  const out = [name];
  let cur: string | undefined = name;
  let depth = 0;
  while (cur && depth++ < 32) {
    // env 注册类优先；内建错误层级始终回退（ast-eval 总是传 env，不能丢掉 RangeError→Error）
    const parent: string | undefined =
      (env ? getClass(env, cur)?.superClass : undefined) ?? BUILTIN_ERROR_SUPER[cur];
    if (!parent || out.includes(parent)) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

/** 内建构造器名：对其 exact false / true 可判定；未知用户构造器名 → boolean */
const BUILTIN_CTOR_NAMES = new Set([
  "Array", "Object", "Function", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "String", "Number", "Boolean",
  "Symbol", "ArrayBuffer", "DataView",
]);

export function instanceOf(
  left: Abs,
  rightClassName: string,
  env?: AstEnv,
): Abs {
  // null/undefined instanceof X：原生抛 TypeError（litValue 无 lit 的抽象值不得误判）
  if (litValue(left) === null || isNullishLitAbs(left)) {
    return { shape: { k: "prim", type: "boolean" }, conf: "partial" };
  }
  const t = (v: boolean): Abs => ({
    shape: { k: "prim", type: "boolean" },
    term: { op: "lit", value: v },
    conf: "exact",
  });
  const partial = (): Abs => ({ shape: { k: "prim", type: "boolean" }, conf: "partial" });
  switch (left.shape.k) {
    case "brand": {
      if (rightClassName === "Object") return t(true);
      return t(classChainNames(left.shape.name, env).includes(rightClassName));
    }
    case "arr":
    case "tuple":
      if (rightClassName === "Array" || rightClassName === "Object") return t(true);
      if (BUILTIN_CTOR_NAMES.has(rightClassName)) return t(false);
      return partial(); // 可能是 Array 子类
    case "obj":
      if (rightClassName === "Object") return t(true);
      if (BUILTIN_CTOR_NAMES.has(rightClassName)) return t(false);
      return partial();
    case "fn":
      if (rightClassName === "Function" || rightClassName === "Object") return t(true);
      if (BUILTIN_CTOR_NAMES.has(rightClassName)) return t(false);
      return partial();
    case "eff":
      if (left.shape.eff === "promise") {
        if (rightClassName === "Promise" || rightClassName === "Object") return t(true);
        if (BUILTIN_CTOR_NAMES.has(rightClassName)) return t(false);
        return partial();
      }
      if (left.shape.eff === "generator") {
        if (rightClassName === "Generator" || rightClassName === "Object") return t(true);
        if (BUILTIN_CTOR_NAMES.has(rightClassName)) return t(false);
        return partial();
      }
      return partial();
    case "prim":
      return t(false); // 原始值无装箱
    case "sum": {
      const parts = left.shape.members.map((m) => instanceOf(m, rightClassName, env));
      let decided: boolean | undefined;
      let undecided = false;
      for (const p of parts) {
        const pv = p.term?.op === "lit" ? p.term.value : undefined;
        if (typeof pv !== "boolean") {
          undecided = true;
          continue;
        }
        if (decided === undefined) decided = pv;
        else if (decided !== pv) {
          // 成员结论冲突 → 不可判定
          return { shape: { k: "prim", type: "boolean" }, conf: "partial" };
        }
      }
      if (decided === undefined) {
        return { shape: { k: "prim", type: "boolean" }, conf: "partial" };
      }
      return {
        shape: { k: "prim", type: "boolean" },
        term: { op: "lit", value: decided },
        conf: undecided ? "path" : "exact",
      };
    }
    default:
      return { shape: { k: "prim", type: "boolean" }, conf: "partial" };
  }
}

export function projectBrand(self: Abs, key: string): Abs {
  if (self.shape.k !== "brand") return unknown;
  const inner = self.shape.shape;
  if (inner && inner.shape.k === "obj") {
    const slot = getSlot(inner.shape.slots, key);
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

/** 沿继承链查找方法，返回定义与所在类名 */
export function lookupMethodWithOwner(
  env: AstEnv,
  receiver: Abs,
  methodName: string,
): { def: MethodDef; owner: string } | undefined {
  if (receiver.shape.k !== "brand") return undefined;
  const chain = getClassChain(env, receiver.shape.name);
  for (const cls of chain) {
    const m = cls.methods.get(methodName);
    if (m) return { def: m, owner: cls.name };
  }
  return undefined;
}

/** super.method()：从父类开始找（跳过当前类） */
export function lookupSuperMethod(
  env: AstEnv,
  receiver: Abs,
  fromClass: string,
  methodName: string,
): { def: MethodDef; owner: string } | undefined {
  if (receiver.shape.k !== "brand") return undefined;
  const parent = superNameOf(env, fromClass) ?? getClass(env, fromClass)?.superClass;
  if (!parent) return undefined;
  const chain = getClassChain(env, parent);
  for (const cls of chain) {
    const m = cls.methods.get(methodName);
    if (m) return { def: m, owner: cls.name };
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
