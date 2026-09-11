/**
 * 结构层：对象槽位、spread、函数重载并。
 * 纪律：积之和默认；optional 塌缩是显式损失；函数并保输入→输出相关性。
 */

import type { Term } from "./term.ts";
import type { Pred } from "./pred.ts";
import { pTrue } from "./pred.ts";
import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, confJoin, litValue, unknown, never } from "./abs.ts";

export type Slot = { value: Abs; optional?: boolean; readonly?: boolean };

export type ObjShape = {
  k: "obj";
  slots: Record<string, Slot>;
  index?: { key: Abs; value: Abs };
  open?: boolean;
};

export function objOf(
  slots: Record<string, Slot>,
  opts?: { index?: { key: Abs; value: Abs }; open?: boolean },
): Abs {
  const shape: ObjShape = { k: "obj", slots };
  if (opts?.index) shape.index = opts.index;
  if (opts?.open) shape.open = true;
  return { shape, conf: "exact" };
}

export function isObj(a: Abs): a is Abs & { shape: ObjShape } {
  return a.shape.k === "obj";
}

/**
 * spread：base ⊕ over（右侧覆盖，不是 join）
 * 未出现在 over 的 key 保留 base；over 的 key 覆盖。
 */
export function spread(base: Abs, over: Abs): Abs {
  if (!isObj(base) && !isObj(over)) {
    // 其中一侧 unknown：结果 open + 保留已知
    if (isObj(over)) return { shape: { ...over.shape, open: true }, conf: confJoin(base.conf, over.conf) };
    if (isObj(base)) return { shape: { ...base.shape, open: true }, conf: confJoin(base.conf, over.conf) };
    return unknown;
  }
  if (!isObj(over)) {
    // over 是 unknown：base 字段都可能被覆盖 → open
    if (!isObj(base)) return unknown;
    return {
      shape: { ...base.shape, open: true },
      conf: confJoin(base.conf, "partial"),
    };
  }
  if (!isObj(base)) {
    return { shape: { ...over.shape, open: true }, conf: confJoin(base.conf, over.conf) };
  }

  const slots: Record<string, Slot> = { ...base.shape.slots };
  for (const [k, s] of Object.entries(over.shape.slots)) {
    slots[k] = s;
  }
  // over 缺席的 key：若 over 是 open/有动态 key，则原 key 可能仍存在也可能被删
  // JS spread 只覆盖 over 上出现的 key，缺席 key 保留 → 直接保留
  const open = base.shape.open || over.shape.open || false;
  const shape: ObjShape = { k: "obj", slots };
  if (open) shape.open = true;
  if (base.shape.index || over.shape.index) {
    shape.index = over.shape.index ?? base.shape.index;
  }
  return { shape, conf: confJoin(base.conf, over.conf) };
}

/**
 * 对象 join：默认积之和（sum），不自动折 optional。
 * 同 key 集：槽位级 join（字面量并）；异 key 集：保持 sum。
 */
export function joinObjects(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;
  if (!isObj(a) || !isObj(b)) {
    // 跨 kind → sum（用 Shape sum）
    return makeSum(a, b);
  }

  const ka = Object.keys(a.shape.slots).sort();
  const kb = Object.keys(b.shape.slots).sort();
  const sameKeys = ka.length === kb.length && ka.every((k, i) => k === kb[i]);

  if (!sameKeys) {
    // 异 key 集：保持 sum，绝不折 optional
    return makeSum(a, b);
  }

  const slots: Record<string, Slot> = {};
  let conf: Confidence = confJoin(a.conf, b.conf);
  for (const k of ka) {
    const sa = a.shape.slots[k]!;
    const sb = b.shape.slots[k]!;
    const optional = sa.optional || sb.optional;
    const jv = joinValues(sa.value, sb.value);
    conf = confJoin(conf, jv.conf);
    slots[k] = { value: jv, optional };
  }
  return { shape: { k: "obj", slots }, conf };
}

/** 值级 join：字面量保留为… Phase A 对 prim 做 term 保留策略 */
export function joinValues(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;

  const va = litValue(a);
  const vb = litValue(b);
  if (va !== undefined && va === vb) return a;

  if (
    a.shape.k === "prim" &&
    b.shape.k === "prim" &&
    a.shape.type === b.shape.type
  ) {
    // 双字面量：保留 term 为「丢失」，shape 仍 prim；置信度 path
    // （完整 sum-of-literals 需要 Abs.sum members — Phase B 可扩）
    if (va !== undefined && vb !== undefined) {
      return abs(
        a.shape,
        undefined,
        undefined,
        confJoin(a.conf, "path"),
      );
    }
    return abs(a.shape, undefined, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
  }

  return makeSum(a, b);
}

export function makeSum(a: Abs, b: Abs): Abs {
  const members = flattenSum([a, b]);
  if (members.length === 1) return members[0]!;
  return {
    shape: { k: "sum", members },
    conf: confJoin(a.conf, b.conf),
  };
}

function flattenSum(xs: Abs[]): Abs[] {
  const out: Abs[] = [];
  for (const x of xs) {
    if (x.shape.k === "sum") out.push(...x.shape.members);
    else out.push(x);
  }
  // 简单去重（按 shape 粗等）
  const seen = new Set<string>();
  const deduped: Abs[] = [];
  for (const x of out) {
    const key = shapeKey(x);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(x);
  }
  return deduped;
}

function shapeKey(a: Abs): string {
  const s = a.shape;
  if (s.k === "prim") return `prim:${s.type}`;
  if (s.k === "never") return "never";
  if (s.k === "any") return "any";
  if (s.k === "unknown") return "unknown";
  if (s.k === "obj") return `obj:${Object.keys(s.slots).sort().join(",")}`;
  if (s.k === "fn") return `fn:${s.params.length}`;
  if (s.k === "sum") return `sum:${s.members.length}`;
  return "other";
}

/**
 * 显式损失：sum-of-products → optional 槽（仅 emit/阈值）。
 * 强制 #widened。
 */
export function collapseToOptional(sum: Abs): Abs {
  if (sum.shape.k !== "sum") {
    if (isObj(sum)) return { ...sum, conf: confJoin(sum.conf, "widened") };
    return sum;
  }
  const objs = sum.shape.members.filter(isObj);
  if (objs.length === 0) {
    return abs({ k: "unknown" }, undefined, undefined, "widened");
  }
  const allKeys = new Set<string>();
  for (const o of objs) {
    for (const k of Object.keys(o.shape.slots)) allKeys.add(k);
  }
  const slots: Record<string, Slot> = {};
  for (const k of allKeys) {
    const present = objs.filter((o) => k in o.shape.slots);
    const values = present.map((o) => o.shape.slots[k]!.value);
    const joined = values.reduce((acc, v) => joinValues(acc, v));
    const optional = present.length < objs.length;
    slots[k] = { value: joined, optional };
  }
  return { shape: { k: "obj", slots }, conf: "widened" };
}

// --- 函数重载并 ---

export type FnAbs = Abs & {
  shape: {
    k: "fn";
    params: string[];
    name?: string;
    /** 外延参数类型（若已知） */
    paramTypes?: Abs[];
    /** 外延返回类型 */
    returnType?: Abs;
  };
};

export function fnOf(params: string[], name?: string): Abs {
  const shape: Shape = { k: "fn", params };
  if (name) (shape as { name?: string }).name = name;
  return { shape, conf: "exact" };
}

/**
 * 函数 join：签名并（重载），禁止 (A|C)→(B|D)。
 */
export function joinFunctions(a: Abs, b: Abs): Abs {
  const sa = a.shape;
  const sb = b.shape;
  if (sa.k !== "fn" || sb.k !== "fn") return makeSum(a, b);
  const an = sa.name;
  const bn = sb.name;
  if (an && an === bn) {
    if (
      sa.params.length === sb.params.length &&
      sa.params.every((p, i) => p === sb.params[i])
    ) {
      return a;
    }
  }
  return makeSum(a, b);
}

/** 通用 join：分派到对象/函数/值 */
export function joinAbs(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;
  if (isObj(a) && isObj(b)) return joinObjects(a, b);
  if (a.shape.k === "fn" && b.shape.k === "fn") return joinFunctions(a, b);
  return joinValues(a, b);
}

/**
 * 重载分派：对 sum-of-fns 按参数 leq 匹配。
 * Phase A：仅按 name 与参数个数粗匹配；精确 leq 留给 service 层。
 */
export type OverloadDef = {
  params: Abs[];
  returns: Abs;
};

export function applyOverloads(
  overloads: OverloadDef[],
  args: Abs[],
): { matched: OverloadDef[] } {
  const matched = overloads.filter((o) => {
    if (o.params.length !== args.length) return false;
    // 粗匹配：参数 shape kind 相容即算命中；精确 leq 后续
    return o.params.every((p, i) => argCompatible(args[i]!, p));
  });
  return { matched };
}

function argCompatible(arg: Abs, param: Abs): boolean {
  if (param.shape.k === "unknown") return true;
  if (arg.shape.k === "unknown") return true;
  if (arg.shape.k === "never") return false;
  if (param.shape.k === "prim" && arg.shape.k === "prim") {
    return param.shape.type === arg.shape.type;
  }
  if (param.shape.k === "obj" && arg.shape.k === "obj") return true;
  if (param.shape.k === "sum") {
    return param.shape.members.some((m) => argCompatible(arg, m));
  }
  return arg.shape.k === param.shape.k;
}
