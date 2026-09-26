/**
 * async / await / generator / $switch / $nullishTest。
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
 * switch：具体 disc 选中匹配 case；抽象 disc 并所有分支。
 * 抽象路径与 $fork 同构：集合 side-table 按臂 overlay，共享 body 只跑一次；
 * 臂内 NudoReturn/NudoThrow 不冒泡污染兄弟臂。
 * **无 default 时必须隐式 fall-through 臂（undef）**，否则无匹配路径被丢掉（P0-2）。
 */
/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
