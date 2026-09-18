/**
 * 结构层：对象槽位、spread、函数重载并。
 * 纪律：积之和默认；optional 塌缩是显式损失；函数并保输入→输出相关性。
 */

import type { Term } from "./term.ts";
import { termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, confJoin, litValue, unknown, never } from "./abs.ts";
import { noteDerivationJoin } from "./derivation.ts";

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
 * 自有槽位读取。slots 是普通对象，直接 `slots[key]` 会让 `__proto__` /
 * `toString` / `valueOf` 等键命中 Object.prototype 原型链，得到既非 slot
 * 又 truthy 的原生值（历史 bug 模式，已两次复发）。所有跨来源 key 的槽位
 * 读取必须走这里。
 */
export function getSlot<S extends { value: Abs }>(
  slots: Record<string, S>,
  key: string,
): S | undefined {
  return Object.prototype.hasOwnProperty.call(slots, key) ? slots[key] : undefined;
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
  // Object.is：NaN 与自身相等（`NaN === NaN` 为 false，不能用 ===）
  if (va !== undefined && Object.is(va, vb)) return a;

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
  // 去重按结构 key，不能按「shape 粗等」——`fn:2`/`sum:2`/`other` 会把
  // 不同重载 / 不同数组元素 / 不同 brand 塌缩成一个（历史 soundness bug）。
  const seen = new Set<string>();
  const deduped: Abs[] = [];
  for (const x of out) {
    const key = absShapeKey(x);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(x);
  }
  return deduped;
}

export function absShapeKey(a: Abs, seen: Set<object> = new Set()): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  try {
    const s = a.shape;
    // prim 按 term/pred 区分：`number=A1>3` 与 `number=A1*2` 是不同路径，不能按 shape 去重
    if (s.k === "prim") {
      const lv = litValue(a);
      if (lv !== undefined) return `prim:${s.type}:${String(lv)}`;
      const t = a.term ? termToString(a.term) : "";
      const p = a.pred && a.pred.op !== "true" ? predToString(a.pred) : "";
      return `prim:${s.type}:${t}:${p}`;
    }
    if (s.k === "never") return "never";
    if (s.k === "any") return "any";
    if (s.k === "unknown") {
      // lit undefined 与真 unknown 不可合并（存在性语义）
      if (a.term?.op === "lit" && a.term.value === undefined) return "unknown:undefined";
      return "unknown";
    }
    if (s.k === "arr") return `arr(${absShapeKey(s.element, seen)})`;
    if (s.k === "tuple") {
      const els = s.elements.map((e) => absShapeKey(e, seen)).join(",");
      const rest = s.rest ? `...${absShapeKey(s.rest, seen)}` : "";
      return `tuple[${els}${rest}]`;
    }
    if (s.k === "brand") return `brand:${s.name}(${absShapeKey(s.shape, seen)})`;
    if (s.k === "eff") return `eff:${s.eff}<${absShapeKey(s.inner, seen)}>`;
    if (s.k === "obj") {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          const flags = (slot.optional ? "?" : "") + (slot.readonly ? "r" : "");
          return `${k}${flags}:${absShapeKey(slot.value, seen)}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absShapeKey(s.index.key, seen)}→${absShapeKey(s.index.value, seen)})`
        : "";
      const open = s.open ? "open" : "";
      return `obj{${slots}}${idx}${open}`;
    }
    if (s.k === "fn") {
      const pts = (s.paramTypes ?? []).map((t) => absShapeKey(t, seen)).join(",");
      const ret = s.returnType ? absShapeKey(s.returnType, seen) : "?";
      const name = s.name ? `#${s.name}` : "";
      return `fn${name}(${s.params.join(",")}|${pts})=>${ret}`;
    }
    if (s.k === "sum") {
      return `sum(${s.members.map((m) => absShapeKey(m, seen)).join("|")})`;
    }
    return "other";
  } finally {
    seen.delete(a);
  }
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

/** 简短 shape 标签（join 路径注释用；不递归展开深层结构） */
function shapeBrief(a: Abs): string {
  const s = a.shape;
  switch (s.k) {
    case "never":
      return "never";
    case "unknown":
    case "any":
      return s.k;
    case "prim":
      return s.type;
    case "arr":
      return `${shapeBrief(s.element)}[]`;
    case "obj":
      return "{…}";
    case "tuple":
      return `[${s.elements.length}]`;
    case "fn":
      return "fn";
    case "brand":
      return s.name;
    case "eff":
      return s.eff;
    case "sum":
      return s.members.map(shapeBrief).join("|");
    default:
      return "·";
  }
}

/**
 * C2.4：给 join 结果挂可解释路径注释。
 * 两支同形 → 不加注；结果仍是一侧原值（never 吸收）→ 不加注。
 */
function annotateJoinPath(a: Abs, b: Abs, result: Abs): Abs {
  if (result === a || result === b) return result;
  const sa = shapeBrief(a);
  const sb = shapeBrief(b);
  if (sa === sb && result.shape.k === a.shape.k) return result;
  const note = `join(${sa} | ${sb})`;
  if (result.pathNote === note) return result;
  return { ...result, pathNote: note };
}

/** 通用 join：分派到对象/函数/值 */
export function joinAbs(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;
  if (isObj(a) && isObj(b)) return joinObjects(a, b);
  if (a.shape.k === "fn" && b.shape.k === "fn") return joinFunctions(a, b);
  const result = joinValues(a, b);
  // 推导图打点：任一侧有标签时结果挂 join 边（工件聚合；check 分轨不依赖）
  noteDerivationJoin([a, b], result);
  return annotateJoinPath(a, b, result);
}
