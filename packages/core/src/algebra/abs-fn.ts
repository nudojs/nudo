/**
 * Abs 上的一等函数：shape 是 fn，实现在旁路（不污染 Shape）。
 * 与 term-registry 同一纪律：不给共享单例挂 impl。
 */

import type { Node } from "@babel/types";
import type { Abs, Confidence, Shape } from "./abs.ts";
import { abs } from "./abs.ts";
import type { Term } from "./term.ts";
import type { Pred } from "./pred.ts";
import type { AstEnv } from "./ast-eval.ts";

export type AbsFnImpl = {
  params: string[];
  /** 可选：无 body 时走 relation（纯关系 fn） */
  body?: Node;
  async?: boolean;
  /** 声明时捕获的环境（闭包） */
  env?: AstEnv;
  kind?: string;
  /** 调用时直接派发（mock withArgs 等），优先于 body */
  apply?: (args: Abs[]) => Abs;
  /**
   * Optional content key for cache fingerprints. formatAbs cannot see
   * WeakMap-side mock semantics (returns/withArgs/callsFake), so hosts that
   * build mocks should stamp a stable fingerprint here.
   * relation-only 必填（未传时 relationFn 自动生成）。
   */
  fingerprint?: string;
  /** 无 body 时，按 paramTypes 做 α 替换得到返回 */
  relation?: { paramTypes: Abs[]; returnType: Abs };
};

const implByAbs = new WeakMap<object, AbsFnImpl>();

export function attachFnImpl(a: Abs, impl: AbsFnImpl): void {
  if (a && typeof a === "object") implByAbs.set(a as object, impl);
}

export function getFnImpl(a: Abs): AbsFnImpl | undefined {
  if (!a || typeof a !== "object") return undefined;
  return implByAbs.get(a as object);
}

/** 造一个带实现的 Abs 函数值 */
export function absFunction(
  params: string[],
  impl: Omit<AbsFnImpl, "params">,
): Abs {
  const a: Abs = {
    shape: { k: "fn", params },
    conf: "exact",
  };
  attachFnImpl(a, { params, ...impl });
  return a;
}

// --- stable key（relationFn fingerprint）---

function termKey(t: Term): string {
  if (t.op === "lit") return `L:${typeof t.value}:${String(t.value)}`;
  if (t.op === "var") return `V:${t.id}`;
  return `A:${t.fn}(${t.args.map(termKey).join(",")})`;
}

function predKey(p: Pred): string {
  switch (p.op) {
    case "true":
      return "T";
    case "false":
      return "F";
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return `${p.op}(${termKey(p.a)},${termKey(p.b)})`;
    case "and":
    case "or":
      return `${p.op}(${p.args.map(predKey).sort().join(",")})`;
    case "not":
      return `not(${predKey(p.arg)})`;
    case "typeof":
      return `typeof(${termKey(p.t)},${p.type})`;
  }
}

function shapeStableKey(s: Shape, seen: Set<object>): string {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
      return s.k;
    case "prim":
      return `p:${s.type}`;
    case "brand":
      return `b:${s.name}(${absStableKey(s.shape, seen)})`;
    case "eff":
      return `e:${s.eff}<${absStableKey(s.inner, seen)}>`;
    case "arr":
      return `arr(${absStableKey(s.element, seen)})`;
    case "tuple": {
      const els = s.elements.map((e) => absStableKey(e, seen)).join(",");
      const rest = s.rest ? `...${absStableKey(s.rest, seen)}` : "";
      return `tup[${els}${rest}]`;
    }
    case "fn": {
      const pts = (s.paramTypes ?? []).map((t) => absStableKey(t, seen)).join(",");
      const ret = s.returnType ? absStableKey(s.returnType, seen) : "?";
      const name = s.name ? `#${s.name}` : "";
      return `fn${name}(${s.params.join(",")}|${pts})=>${ret}`;
    }
    case "sum":
      return `sum(${s.members.map((m) => absStableKey(m, seen)).join("|")})`;
    case "obj": {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          const flags = (slot.optional ? "?" : "") + (slot.readonly ? "r" : "");
          return `${k}${flags}:${absStableKey(slot.value, seen)}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absStableKey(s.index.key, seen)}→${absStableKey(s.index.value, seen)})`
        : "";
      return `obj{${slots}}${idx}${s.open ? "open" : ""}`;
    }
  }
}

function absStableKey(a: Abs, seen: Set<object> = new Set()): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  const t = a.term ? `=${termKey(a.term)}` : "";
  const p = a.pred ? `@${predKey(a.pred)}` : "";
  return `${shapeStableKey(a.shape, seen)}${t}${p}`;
}

/** relationFn 稳定 fingerprint（同签名共享，见 §3.3 已知限制） */
export function relationFingerprint(
  paramTypes: Abs[],
  returnType: Abs,
): string {
  return `rel(${paramTypes.map((p) => absStableKey(p)).join(",")})=>${absStableKey(returnType)}`;
}

/**
 * 无 body、纯关系的 fn Abs。params 仅记 arity。
 *
 * **双写纪律：** 同一份关系数据必须同时写到——
 *   1. `shape.paramTypes` / `shape.returnType`  —— format / leq / 展示读这里
 *   2. `impl.relation`                         —— D 路径应用读这里
 * 两槽共享同一数组/对象引用（防内容分叉）；构造后请勿原地 mutate。
 *
 * 默认 conf="path"（与提升产物一致）。禁止静默对齐 absFunction 的 "exact"。
 * fingerprint 必填（call-budget）；未传时由 paramTypes+returnType 稳定序列化生成。
 * 同签名 relationFn 共享 fingerprint → 共享 budget 键（见 design §3.3 已知限制）。
 */
export function relationFn(
  paramTypes: Abs[],
  returnType: Abs,
  opts?: { params?: string[]; conf?: Confidence; fingerprint?: string },
): Abs {
  const params = opts?.params ?? paramTypes.map((_, i) => `x${i}`);
  const conf = opts?.conf ?? "path";
  const fingerprint =
    opts?.fingerprint ?? relationFingerprint(paramTypes, returnType);
  const a: Abs = {
    shape: {
      k: "fn",
      params,
      paramTypes,
      returnType,
    },
    conf,
  };
  attachFnImpl(a, {
    params,
    relation: { paramTypes, returnType },
    fingerprint,
  });
  return a;
}

/** 仅写 shape 槽（E 路径 / §5.2 提升产物）；禁止 attachFnImpl */
export function shapeOnlyFn(
  paramTypes: Abs[],
  returnType: Abs,
  opts?: { params?: string[]; conf?: Confidence },
): Abs {
  const params = opts?.params ?? paramTypes.map((_, i) => `x${i}`);
  return abs(
    { k: "fn", params, paramTypes, returnType },
    undefined,
    undefined,
    opts?.conf ?? "path",
  );
}
