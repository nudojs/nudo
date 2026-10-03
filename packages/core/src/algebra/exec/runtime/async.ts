/**
 * async / await / generator / ??（$nullishTest / $removeNullish）。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { joinAbs, type ObjShape } from "../../objects.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { isNullishLitAbs, definitelyNotNullishShape } from "../../surface.ts";
import {
  NudoThrow, isNudoThrow, undef, litTruth, isDefinitelyTrue, isDefinitelyFalse,
  currentExecPhi, $lit, asAbsVal, $fnVal, noBody, writeInPlace, clearStaleTermPred,
} from "./state.ts";
import { $unknown, $eq, $ne, $add, $typeof, $not, $lt, $le, $gt, $ge, $join } from "./ops.ts";
import {
  yieldStack, genPathSensitive, genJoinOverride, mergeArmYields,
  withIsolatedYields, runForkArm, type ForkArm,
  setGenJoinOverride, bumpGenPathSensitive,
} from "./control.ts";
import { beginCollectionFork, endCollectionFork, popCollectionArm, pushCollectionArm } from "../../collections.ts";
import { $arr } from "./containers.ts";
import { loopExitsAls } from "./state.ts";

export function wrapPromiseAbs(inner: Abs): Abs {
  inner = asAbsVal(inner);
  return abs(
    { k: "eff", eff: "promise", inner },
    undefined,
    undefined,
    confJoin(inner.conf, "path"),
  );
}

export function awaitAbsVal(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") return v.shape.inner;
  return v;
}

/**
 * async 函数体包进 thunk，返回值经 wrapPromise。
 */
export function $async(thunk: () => Abs): Abs {
  return wrapPromiseAbs(thunk());
}

/** await → 解包 eff("promise") */
export function $await(v: Abs): Abs {
  return awaitAbsVal(v);
}

/** async 直接 return 的 coerce */
export function $asyncReturn(v: Abs): Abs {
  if (v.shape.k === "eff") return v;
  return wrapPromiseAbs(v);
}

// --- 生成器 ---
// yieldStack / genPathSensitive / genJoinOverride 在文件前部（fork 隔离用）

/** function* 体：收集所有 yield 值为 tuple Abs；抽象分支时降 conf（P0-6） */
export function $gen(body: () => void): Abs {
  const ys: Abs[] = [];
  const marker = genPathSensitive;
  const prevOverride = genJoinOverride;
  setGenJoinOverride(null);
  yieldStack.push(ys);
  try {
    body();
  } finally {
    yieldStack.pop();
  }
  if (genJoinOverride) {
    const joined: Abs = genJoinOverride;
    setGenJoinOverride(prevOverride);
    return { ...joined, conf: joined.conf === "exact" ? ("path" as Confidence) : joined.conf };
  }
  setGenJoinOverride(prevOverride);
  const arr = $arr(ys);
  if (genPathSensitive > marker) {
    return { ...arr, conf: arr.conf === "exact" ? ("path" as Confidence) : arr.conf };
  }
  return arr;
}

/** yield v：压入当前生成器收集器；表达式值用 unknown */
export function $yield(v: Abs): Abs {
  const top = yieldStack[yieldStack.length - 1];
  if (top) top.push(v);
  return unknown;
}

/**
 * `??` 非 nullish 臂：从左值 Abs 剥离 nullish 部分（$nullishTest 判 true
 * 的成员）。索引访问 `M[k]` 对抽象键产出 joinAbs(element, undef())，
 * 左值 sum 保留 undefined 臂；`l ?? fallback` 的 alt（非 nullish 路径）
 * 必须只取左值的非 nullish 部分——否则 false-positive `nullish return arm`
 * （issue #90）、`for (const x of o.items ?? [])` 假 may-throw。
 */
export function $removeNullish(a: Abs): Abs {
  // 裸宿主值（非 Abs）：原样透传——调用边界（$fork 臂）经 asAbsVal 收拢，
  // 提前折 unknown 是无谓退化（与 $fork 对缺参/宿主裸值的口径一致）
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (definitelyNotNullishShape(a.shape)) return a;
  if (isNullishLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullishLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
