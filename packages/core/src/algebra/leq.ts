/**
 * 结构可赋值：src ≤ tgt（Abs 上的 leq）。
 *
 * 规则与 TS 结构子类型同构，但作用在推断出的 Abs 上：
 * - 对象宽度 + 深度；optional 可缺
 * - brand 名义；fn 参数逆变、返回协变
 * - pred：src 蕴含 tgt（更严的值可赋给更宽的目标）
 *
 * 不是完备 checker 的替代——是 Abs 之间的兼容判定。
 */

import type { Abs, Shape } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, implies } from "./pred.ts";
import { termEquals } from "./term.ts";
import type { AstEnv } from "./ast-env.ts";
import { getClassChain } from "./language.ts";
import { getSlot } from "./objects.ts";

export type LeqResult = {
  ok: boolean;
  /** Nudo 式原因（actual ⊭ target），不是 TS 文案 */
  reason?: string;
};

function ok(): LeqResult {
  return { ok: true };
}

function fail(reason: string): LeqResult {
  return { ok: false, reason };
}

/**
 * src 可赋给 tgt。
 * phi：路径前提（可选）；env：用于 brand 继承链。
 */
export function leqAbs(
  src: Abs,
  tgt: Abs,
  opts: { phi?: Phi; env?: AstEnv } = {},
): LeqResult {
  const phi = opts.phi ?? pTrue;
  return leqWithPred(src, tgt, phi, opts.env ?? null, 0);
}

function leqWithPred(
  src: Abs,
  tgt: Abs,
  phi: Phi,
  env: AstEnv | null,
  depth: number,
): LeqResult {
  if (depth > 32) return fail("leq depth exceeded");

  // never ≤ 任意
  if (src.shape.k === "never") return ok();
  // 任意 ≤ any / unknown（目标放宽）
  if (tgt.shape.k === "any" || tgt.shape.k === "unknown") return ok();
  // any ≤ 任意（源是任意值，目标收窄时不在此判定失败——由 pred/slot 再卡）
  if (src.shape.k === "any") return ok();

  // 字面量：先按 lit 值裁定，再走 shape
  const sv = litValue(src);
  const tv = litValue(tgt);
  if (sv !== undefined && tv !== undefined) {
    if (sv === tv) return ok();
    // 目标是具体字面量而源不是同一值：不得仅因同 prim 放行（P1-5）
    if (tgt.shape.k === "prim") {
      return fail(`lit ${String(sv)} ⊭ lit ${String(tv)}`);
    }
    // 数值字面量可进带 pred 的 number（走 pred 蕴含）
  } else if (tv !== undefined && sv === undefined) {
    // 目标是具体字面量，源是 prim/无 term：number ⊄ 1
    if (tgt.shape.k === "prim") {
      return fail(`non-lit prim ⊭ lit ${String(tv)}`);
    }
  }

  const shapeR = leqShape(src, tgt, phi, env, depth);
  if (!shapeR.ok) return shapeR;

  // shape 兼容后检查 pred：src.pred ∧ phi ⇒ tgt.pred
  return leqPred(src, tgt, phi, depth);
}

function leqPred(src: Abs, tgt: Abs, phi: Phi, depth: number): LeqResult {
  const sp = src.pred && src.pred.op !== "true" ? src.pred : undefined;
  const tp = tgt.pred && tgt.pred.op !== "true" ? tgt.pred : undefined;
  if (!tp) return ok(); // 目标无约束
  if (!sp) {
    // 源无约束但目标有：数值界用 bounds 粗判；否则不蕴含
    // 保守：仅当目标 pred 在 phi 下已被蕴含才 ok
    if (implies(phi, tp)) return ok();
    return fail(`pred ⊭ ${predBrief(tp)}`);
  }
  const combined: Phi =
    phi.op === "true" ? sp : { op: "and", args: [phi, sp] };
  if (implies(combined, tp)) return ok();
  // 数值界：src 更严可赋给更宽目标（x>5 ≤ x>0）
  if (numericBoundsImply(sp, tp)) return ok();
  return fail(`pred ⊭ ${predBrief(tp)}`);
}

function predBrief(p: Pred): string {
  switch (p.op) {
    case "gt":
    case "ge":
    case "lt":
    case "le":
    case "eq":
    case "ne":
      return p.op;
    default:
      return p.op;
  }
}

/** 数值界蕴含：src 的界更紧则可赋给更宽 tgt */
function numericBoundsImply(src: Pred, tgt: Pred): boolean {
  // 单比较：x > n_src ⇒ x > n_tgt 当 n_src ≥ n_tgt（gt）；对称处理 ge
  const one = (p: Pred): p is Extract<Pred, { op: "gt" | "ge" | "lt" | "le" }> =>
    p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le";
  if (!one(src) || !one(tgt)) return false;
  if (src.op !== tgt.op) {
    // gt ⇒ ge；lt ⇒ le
    if (src.op === "gt" && tgt.op === "ge") {
      return sameTermSide(src, tgt) && litGE(src.b, tgt.b);
    }
    if (src.op === "lt" && tgt.op === "le") {
      return sameTermSide(src, tgt) && litLE(src.b, tgt.b);
    }
    return false;
  }
  if (!sameTermSide(src, tgt)) return false;
  const sb = src.b.op === "lit" ? src.b.value : undefined;
  const tb = tgt.b.op === "lit" ? tgt.b.value : undefined;
  if (typeof sb !== "number" || typeof tb !== "number") return false;
  if (src.op === "gt" || src.op === "ge") {
    return sb >= tb; // 更大的下界 ⇒ 更小的下界
  }
  return sb <= tb; // 更小的上界 ⇒ 更大的上界
}

function sameTermSide(
  a: { a: { op: string }; b: { op: string } },
  b: { a: { op: string }; b: { op: string } },
): boolean {
  // termEquals 走结构比较，避免 sum×sum 场景 JSON.stringify 爆炸
  return a.a.op === b.a.op && termEquals(a.a as never, b.a as never);
}

function litGE(
  a: { op: string; value?: unknown },
  b: { op: string; value?: unknown },
): boolean {
  if (a.op !== "lit" || b.op !== "lit") return false;
  return typeof a.value === "number" && typeof b.value === "number" && a.value >= b.value;
}

function litLE(
  a: { op: string; value?: unknown },
  b: { op: string; value?: unknown },
): boolean {
  if (a.op !== "lit" || b.op !== "lit") return false;
  return typeof a.value === "number" && typeof b.value === "number" && a.value <= b.value;
}

function leqShape(
  src: Abs,
  tgt: Abs,
  phi: Phi,
  env: AstEnv | null,
  depth: number,
): LeqResult {
  const s = src.shape;
  const t = tgt.shape;

  // sum 源：每个成员 ≤ tgt
  if (s.k === "sum") {
    for (const m of s.members) {
      const r = leqWithPred(m, tgt, phi, env, depth + 1);
      if (!r.ok) return fail(`sum member: ${r.reason}`);
    }
    return ok();
  }
  // sum 目标：src ≤ 某个成员
  if (t.k === "sum") {
    for (const m of t.members) {
      if (leqWithPred(src, m, phi, env, depth + 1).ok) return ok();
    }
    return fail("src ⊭ sum");
  }

  // prim：同型；lit 归入对应 prim
  if (t.k === "prim") {
    const sp = primOf(src);
    if (!sp) return fail(`shape ${s.k} ⊭ prim ${t.type}`);
    if (sp !== t.type) return fail(`prim ${sp} ⊭ prim ${t.type}`);
    return ok();
  }

  // 对象：宽度 + 深度
  if (t.k === "obj") {
    if (s.k !== "obj" && s.k !== "brand") {
      return fail(`shape ${s.k} ⊭ obj`);
    }
    const srcObj =
      s.k === "obj"
        ? s
        : s.k === "brand"
          ? (s.shape.shape.k === "obj" ? s.shape.shape : null)
          : null;
    if (!srcObj || srcObj.k !== "obj") return fail(`shape ${s.k} ⊭ obj`);
    for (const [key, slot] of Object.entries(t.slots)) {
      const srcSlot = getSlot(srcObj.slots, key);
      if (!srcSlot) {
        if (slot.optional) continue;
        return fail(`missing slot ${key}`);
      }
      if (srcSlot.optional && !slot.optional) {
        return fail(`slot ${key}: optional ⊭ required`);
      }
      // 结构槽位：同 prim 字面量视为可赋（mutable let 拓宽；契约走 pred）
      const ssv = litValue(srcSlot.value);
      const stv = litValue(slot.value);
      if (
        ssv !== undefined &&
        stv !== undefined &&
        primOf(srcSlot.value) !== undefined &&
        primOf(srcSlot.value) === primOf(slot.value)
      ) {
        continue;
      }
      const r = leqWithPred(srcSlot.value, slot.value, phi, env, depth + 1);
      if (!r.ok) return fail(`slot ${key}: ${r.reason}`);
    }
    return ok();
  }

  // 数组
  if (t.k === "arr") {
    if (s.k === "arr") {
      return leqWithPred(s.element, t.element, phi, env, depth + 1);
    }
    if (s.k === "tuple") {
      return s.elements.every((el) => leqWithPred(el, t.element, phi, env, depth + 1).ok)
        ? ok()
        : fail("tuple ⊭ arr");
    }
    return fail(`shape ${s.k} ⊭ arr`);
  }

  // 元组
  if (t.k === "tuple") {
    if (s.k !== "tuple") return fail(`shape ${s.k} ⊭ tuple`);
    if (s.elements.length !== t.elements.length) {
      return fail(`tuple arity ${s.elements.length} ⊭ ${t.elements.length}`);
    }
    for (let i = 0; i < t.elements.length; i++) {
      const r = leqWithPred(s.elements[i]!, t.elements[i]!, phi, env, depth + 1);
      if (!r.ok) return fail(`tuple[${i}]: ${r.reason}`);
    }
    return ok();
  }

  // 函数：参数逆变、返回协变
  if (t.k === "fn") {
    if (s.k !== "fn") return fail(`shape ${s.k} ⊭ fn`);
    if (s.params.length !== t.params.length) {
      return fail(`fn arity ${s.params.length} ⊭ ${t.params.length}`);
    }
    if (t.returnType !== undefined) {
      const sr = s.returnType;
      if (!sr) return fail("fn return unknown ⊭ target return");
      const r = leqWithPred(sr, t.returnType, phi, env, depth + 1);
      if (!r.ok) return fail(`fn return: ${r.reason}`);
    }
    // 参数：tgt 参数 ≤ src 参数（逆变）—— 有 paramTypes 时检查
    if (s.paramTypes && t.paramTypes) {
      for (let i = 0; i < t.paramTypes.length; i++) {
        const sp = s.paramTypes[i];
        const tp = t.paramTypes[i];
        if (!sp || !tp) continue;
        const r = leqWithPred(tp, sp, phi, env, depth + 1);
        if (!r.ok) return fail(`fn param[${i}]: ${r.reason}`);
      }
    }
    return ok();
  }

  // brand：名义（同名或继承链）
  if (t.k === "brand") {
    if (s.k !== "brand") return fail(`shape ${s.k} ⊭ brand ${t.name}`);
    if (s.name === t.name) return ok();
    if (env) {
      const chain = getClassChain(env, s.name).map((c) => c.name);
      if (chain.includes(t.name)) return ok();
    }
    return fail(`brand ${s.name} ⊭ brand ${t.name}`);
  }

  // eff
  if (t.k === "eff") {
    if (s.k !== "eff" || s.eff !== t.eff) return fail(`shape ${s.k} ⊭ eff ${t.eff}`);
    return leqWithPred(s.inner, t.inner, phi, env, depth + 1);
  }

  if (s.k === t.k) return ok();
  return fail(`shape ${s.k} ⊭ ${t.k}`);
}

function primOf(a: Abs): "number" | "string" | "boolean" | "bigint" | "symbol" | undefined {
  if (a.shape.k === "prim") return a.shape.type;
  const lv = litValue(a);
  if (typeof lv === "number") return "number";
  if (typeof lv === "string") return "string";
  if (typeof lv === "boolean") return "boolean";
  if (typeof lv === "bigint") return "bigint";
  return undefined;
}
