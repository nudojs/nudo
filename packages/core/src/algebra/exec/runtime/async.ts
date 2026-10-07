/**
 * async / await / generator / ??（$nullishTest / $removeNullish）。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, strLit, unknown, type Confidence } from "../../abs.ts";
import { lit, termEquals } from "../../term.ts";
import type { Phi, Pred } from "../../pred.ts";
import { pTrue, and, implies, predEquals, type PrimName } from "../../pred.ts";
import { joinAbs, objOf, type ObjShape } from "../../objects.ts";
import { leqAbs } from "../../leq.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { isNullishLitAbs, definitelyNotNullishShape, typeofName } from "../../surface.ts";
import {
  NudoThrow, isNudoThrow, undef, litTruth, isDefinitelyTrue, isDefinitelyFalse,
  currentExecPhi, $lit, asAbsVal, $fnVal, noBody, writeInPlace, clearStaleTermPred,
  isNudoReturn, isNudoBreak, isNudoContinue,
} from "./state.ts";
import { pushMayThrowFrame, popMayThrowFrame } from "../may-throw.ts";
import { registerGenElements } from "../match-iter.ts";
import { $unknown, $eq, $ne, $add, $typeof, $not, $lt, $le, $gt, $ge, $join } from "./ops.ts";
import {
  yieldStack, genPathSensitive, genJoinOverride, mergeArmYields,
  withIsolatedYields, runForkArm, type ForkArm,
  setGenJoinOverride, bumpGenPathSensitive,
} from "./control.ts";
import { beginCollectionFork, endCollectionFork, popCollectionArm, pushCollectionArm } from "../../collections.ts";
import { $arr, $yieldStarElems } from "./containers.ts";
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

/** GeneratorFunction 构造器 brand（g().constructor）——原生 name 是 "" */
let generatorCtorCache: Abs | undefined;
function generatorFunctionCtor(): Abs {
  if (!generatorCtorCache) {
    generatorCtorCache = abs(
      {
        k: "brand",
        name: "GeneratorFunction",
        shape: objOf({ name: { value: strLit("") } }),
        ctor: true,
      },
      undefined,
      undefined,
      "exact",
    );
  }
  return generatorCtorCache;
}

/** 生成器 next()/return() 结果：{value, done} 对象（Bug 22） */
function genIterResult(value: Abs, done: boolean): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        value: { value },
        done: { value: boolLit(done) },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * 生成器对象（Bug 22）：带迭代器协议面的对象 Abs——
 * - `next`/`return`/`throw` 方法槽（typeof → "function"），next 按调用序
 *   折 {value, done}（字面量 yield 序列首调用 → {value: y0, done: false}、
 *   耗尽 → {value: undefined, done: true}）；return(x) → {value: x, done:
 *   true}；throw(e) → 抛 e。
 * - `constructor` → GeneratorFunction brand（g().constructor.name → ""）。
 * - 数字下标槽（"0"…"n-1" = yield 值）+ @@iterator 槽 + 元素侧表——
 *   for-of / [...g()] / Array.from / yield* / 数组解构经既有迭代路径
 *   按序精确展开（迭代路径从侧表取出元素域，不回归）。
 */
function makeGenObject(els: Abs[], conf: Confidence): Abs {
  const state = { i: 0, done: false };
  const next = $fnVal([], (): Abs => {
    if (state.done || state.i >= els.length) {
      state.done = true;
      return genIterResult(undef(), true);
    }
    const v = els[state.i]!;
    state.i++;
    return genIterResult(v, false);
  });
  const ret = $fnVal([], (...args: Abs[]): Abs => {
    state.done = true;
    return genIterResult(args.length > 0 ? args[0]! : undef(), true);
  });
  const thr = $fnVal([], (...args: Abs[]): Abs => {
    state.done = true;
    throw new NudoThrow(args.length > 0 ? args[0]! : undef());
  });
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    return: { value: ret },
    throw: { value: thr },
    constructor: { value: generatorFunctionCtor() },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  for (let i = 0; i < els.length; i++) {
    slots[String(i)] = { value: els[i]! };
  }
  const g = abs({ k: "obj", slots }, undefined, undefined, conf);
  registerGenElements(g, els);
  return g;
}

/** function* 体：收集所有 yield 值；返回带迭代器协议面的生成器对象 Abs；
 *  抽象分支时降 conf（P0-6）
 *
 * Bug 58：调用生成器是原生全操作——体只在首个 next() 执行。此前 body()
 * eager 执行把体内 may-throw（成员读 any）/显式 throw 折进**调用方** throws
 * 域（每生成器入口假 entry-may-throw）。现以丢弃式 may-throw 帧包裹：
 * soft 效果进帧后丢弃、NudoThrow/宿主异常吞掉（迭代期语义，调用期不表面）。
 * yield 收集保持 eager（既有值域建模，注释口径不变）。
 * Bug 22：结果从 yield 元组数组改为生成器对象（next/return/throw 方法面 +
 * constructor 身份）；元素域经侧表保留（$arr 的 ≤cap tuple / >cap arr
 * widen 策略不变），迭代路径（for-of/spread/Array.from）继续工作。 */
export function $gen(body: () => void): Abs {
  const ys: Abs[] = [];
  const marker = genPathSensitive;
  const prevOverride = genJoinOverride;
  setGenJoinOverride(null);
  yieldStack.push(ys);
  pushMayThrowFrame();
  try {
    body();
  } catch (e) {
    // 控制流 token（fork/循环返回）不是迭代期异常——不得吞
    if (isNudoReturn(e) || isNudoBreak(e) || isNudoContinue(e)) throw e;
    // 体内 throw 属首个 next() 迭代期——调用期吞掉（throws 域不泄漏）
  } finally {
    popMayThrowFrame(true);
    yieldStack.pop();
  }
  if (genJoinOverride) {
    const joined: Abs = genJoinOverride;
    setGenJoinOverride(prevOverride);
    const js = joined.shape;
    const els =
      js.k === "tuple" ? [...js.elements] : js.k === "arr" ? [js.element] : [unknown];
    return makeGenObject(
      els,
      joined.conf === "exact" ? ("path" as Confidence) : joined.conf,
    );
  }
  setGenJoinOverride(prevOverride);
  const arr = $arr(ys);
  const as = arr.shape;
  const els = as.k === "tuple" ? [...as.elements] : as.k === "arr" ? [as.element] : [unknown];
  if (genPathSensitive > marker) {
    return makeGenObject(
      els,
      arr.conf === "exact" ? ("path" as Confidence) : arr.conf,
    );
  }
  return makeGenObject(els, arr.conf);
}

/** yield v：压入当前生成器收集器；表达式值用 unknown */
export function $yield(v: Abs): Abs {
  const top = yieldStack[yieldStack.length - 1];
  if (top) top.push(v);
  return unknown;
}

/** yield* v（Bug 82）：委托迭代 ≠ yield v——GetIterator 校验先行（$elems
 *  同分类器：非可迭代接收者 definite/may TypeError，生成器体内按 $gen
 *  迭代期语义由外层帧吸收），**元素**逐个压入收集器（此前把整个可迭代值
 *  压一次）；表达式值 = 内层迭代器的 return 值（生成器 return / 自定义
 *  iterator 的 done 值，不可判）→ 保守 unknown。长度不可判的接收者
 *  （arr/any/…）单代表元素过近似并入 + bumpGenPathSensitive 压 conf
 *  （mergeArmYields 同口径，禁 exact 元组出货）。 */
export function $yieldStar(v: unknown): Abs {
  const a = asAbsVal(v);
  const { els, lengthKnown } = $yieldStarElems(a);
  const top = yieldStack[yieldStack.length - 1];
  if (top) {
    top.push(...els);
    if (!lengthKnown) bumpGenPathSensitive();
  }
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

/** 守卫剪除粒度（Bug 3）：null/undefined 成员各自的字面量判定 */
function isNullLitAbs(a: Abs): boolean {
  return a.term?.op === "lit" && a.term.value === null;
}
function isUndefLitAbs(a: Abs): boolean {
  return a.term?.op === "lit" && a.term.value === undefined;
}

/**
 * 严格 `p === null` 守卫的假值臂剪影：只剥 null 成员（Bug 3 粒度——
 * `null === undefined` 为 false，假值臂的 p **仍可能是 undefined**，
 * 不得连 undefined 一起剪，否则 `p.major` 漏报真实 TypeError）。
 */
export function $removeNull(a: Abs): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (isNullLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/**
 * `typeof u === "undefined"` / 严格 `u === undefined` 守卫的假值臂剪影：
 * 只剥 undefined 成员（`typeof null === "object"`——假值臂的 u 仍可能是
 * null，`u.v` 对 null 仍原生抛 TypeError，不得剪）。
 */
export function $removeUndefined(a: Abs): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (isUndefLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isUndefLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/**
 * 成员真值守卫臂剪影（issue #118）：`if (o.p)` 真值臂 / `if (!o.p)` 假值臂 /
 * `o?.p` 真值守卫里，槽 p 的值必为真值 ⇒ 非 nullish 且槽必在场——重建 obj
 * slots：槽值过与 $removeNullish 同款成员剥离，并摘除 optional 标记
 * （真值 ⇒ 在场；$get 的 join(value, undef) 随之消失）。槽值剥空（纯
 * nullish）→ 保守原样（臂不可达近似，与 $removeNullish 空集口径一致）；
 * 键缺席 / 非 obj / 裸宿主值 → 透传（同 $removeNullish 契约）。真值 ⇒ 非
 * nullish 是 sound 下界：0/''/false 等 falsy-but-not-nullish 成员保留。
 */
export function $removeMemberNullish(a: Abs, key: string): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "obj") return a;
  const slots = (a.shape as { slots: ObjShape["slots"] }).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) return a;
  const slot = slots[key]!;
  let value = slot.value;
  let changed = false;
  if (!definitelyNotNullishShape(value.shape) && value.shape.k === "sum") {
    const members = (value.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullishLitAbs(m));
    if (kept.length > 0 && kept.length < members.length) {
      value = kept.length === 1 ? kept[0]! : { ...value, shape: { k: "sum" as const, members: kept } };
      changed = true;
    }
  }
  if (slot.optional) changed = true;
  if (!changed) return a;
  const next: { value: Abs; optional?: boolean; readonly?: boolean } = { ...slot, value };
  delete next.optional;
  return { ...a, shape: { ...a.shape, slots: { ...slots, [key]: next } } };
}

/** 成员 → JS typeof 名；any/unknown（无 nullish lit term）不可判 → undefined */
function typeofOfMember(m: Abs): string | undefined {
  const t = m.term;
  if (t?.op === "lit") {
    if (t.value === null) return "object";
    if (t.value === undefined) return "undefined";
  }
  const n = typeofName(m.shape);
  return n === "unknown" ? undefined : n;
}

/**
 * typeof 类型守卫臂剪影（Bug 23）：`typeof v === "string"` 真臂把 v 重绑为
 * union 中 typeof 匹配的成员（keep=true）/ 假臂绑补集（keep=false）——臂内
 * `+`/关系/迭代/模板串拿到成员类型而非 union，不再记假 may-throw。
 * 裸 any 在事实臂窄化为对应 prim（issue #105）；sum 内不可判成员
 * （any/unknown）两侧都保留（保守，不引假阴性）；全剪空 →
 * 原样返回（臂不可达的保守近似，与 $removeNullish 空集口径一致）。
 */
export function $narrowTypeOf(a: Abs, typeOf: string, keep: boolean): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "sum") {
    // 单形态：判定的 typeof 与守卫一致（或补集臂判不一致但值本就单一）
    // 无可剪；不一致属臂不可达，原样返回（保守）。
    // issue #105：裸 any（无约束入口参数）在事实臂（keep=true）可健全窄化为
    // 对应 prim——typeof v === "string" 的真臂里 v 必是 string，exec/test
    // 等 ToString 强转面不再记假 may-throw。补集臂（keep=false）不可表示
    // （"非 string" 覆盖其余全域），保留 any；object/function/undefined 无
    // 单一 Abs 可表（null/数组/函数各有形态），同样保留；unknown 是引擎
    // fail-closed 令牌，窄化会凭空捏造信息，原样返回。
    if (keep && a.shape.k === "any") {
      const p = primShapeOfTypeOf(typeOf);
      if (p) return abs(p, a.term, a.pred, a.conf);
    }
    return a;
  }
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter((m) => {
    const t = typeofOfMember(m);
    if (t === undefined) return true;
    return keep ? t === typeOf : t !== typeOf;
  });
  if (kept.length === members.length) return a;
  if (kept.length === 0) return a;
  return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
}

/**
 * 判别联合成员分类（issue #126）：成员 m 在「m.key === lit」事实下可判定的
 * 匹配性。三态：
 * - "only"：槽值域恰为该字面量（pred ⊢ eq(t, lit)）——事实假臂可剪；
 * - "never"：槽值域排除该字面量（pred ⊢ ne(t, lit) / eq(t, litV≠lit) /
 *   形态不容 / 槽缺席（宽容读 undefined ≠ lit））——事实臂可剪；
 * - "may"：不可判（any/unknown 令牌、typeof-only 域、or 域…）——双侧保守保留。
 * 非对象成员：lit term（含 nullish 字面量）上自定义键读出 undefined（nullish
 * 读抛——测试自身记账）→ "never"；其余（prim/tuple/arr/fn/brand/eff 与无
 * lit term 的 unknown）保守 "may"。
 */
type MemberEqClass = "only" | "may" | "never";

/** 同 prim 字面量互斥判定：eq(t, V) 事实下 t === L 为假 ⟺ V ≢ L（NaN ≠ NaN 恒假，同为 never） */
function litRefutesEq(other: unknown, v: string | number | boolean): boolean {
  return other !== v;
}

function memberEqClass(m: Abs, key: string, litAbs: Abs, value: string | number | boolean): MemberEqClass {
  const sh = m.shape;
  if (sh.k === "obj") {
    const slots = (sh as ObjShape).slots;
    if (!Object.prototype.hasOwnProperty.call(slots, key)) {
      // 缺席槽宽容读出 undefined ≠ lit；open 形态缺席键读 unknown → 不可判
      return (sh as ObjShape).open ? "may" : "never";
    }
    const slotValue = slots[key]!.value;
    if (slotValue.shape.k === "any" || slotValue.shape.k === "unknown") return "may";
    // 形态相容（剥 term/pred 的纯 shape 赋值检查）：lit 形态不在槽值域 → never
    const shapeOnly = (s: Abs["shape"]): Abs => abs(s, undefined, undefined, "exact");
    if (!leqAbs(shapeOnly(litAbs.shape), shapeOnly(slotValue.shape)).ok) return "never";
    const t = slotValue.term;
    const p = slotValue.pred;
    if (!t || !p || p.op === "true") return "may";
    const litTerm = lit(value);
    if (implies(p, { op: "eq", a: t, b: litTerm })) return "only";
    if (implies(p, { op: "ne", a: t, b: litTerm })) return "never";
    // implies 的字符串/布尔 diseq 盲区：eq(t, litV) 合取事实逐字面量排除
    //（eq(t,'Identifier') ⊢ ne(t,'TemplateLiteral')——跨 prim 亦排除）
    const conjuncts: Pred[] = [];
    const visit = (c: Pred): void => {
      if (c.op === "and") {
        c.args.forEach(visit);
        return;
      }
      conjuncts.push(c);
    };
    visit(p);
    for (const c of conjuncts) {
      if (c.op !== "eq") continue;
      const other =
        termEquals(c.a, t) && c.b.op === "lit" ? c.b.value :
        termEquals(c.b, t) && c.a.op === "lit" ? c.a.value :
        undefined;
      if (other !== undefined && litRefutesEq(other, value)) return "never";
    }
    return "may";
  }
  if (m.term?.op === "lit") return "never";
  return "may";
}

/**
 * 判别等值守卫臂剪影（issue #126）：`x.key === lit` 事实臂（keep=true）内把
 * x 重绑为「key 值域可能等于 lit」的成员子集（剪 "never" 成员）；对偶补集臂
 * （keep=false）剪 "only" 成员。单形态无可剪原样返回；全剪空 → 原样返回
 * （臂不可达的保守近似，与 $removeNullish / $narrowTypeOf 同口径）；
 * 单成员剪余直接返回该成员。
 */
export function $narrowMemberEq(
  a: Abs,
  key: string,
  value: string | number | boolean,
  keep: boolean,
): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "sum") return a;
  const litAbs =
    typeof value === "string" ? strLit(value) :
    typeof value === "number" ? numLit(value) :
    boolLit(value);
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter((m) => {
    const c = memberEqClass(m, key, litAbs, value);
    return keep ? c !== "never" : c !== "only";
  });
  if (kept.length === members.length) return a;
  if (kept.length === 0) return a;
  return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
}

/** typeof 结果 → 可健全表示的 prim shape（string/number/boolean/bigint/symbol） */
function primShapeOfTypeOf(typeOf: string): { k: "prim"; type: PrimName } | undefined {
  switch (typeOf) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return { k: "prim", type: typeOf };
    default:
      return undefined;
  }
}

/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
