/**
 * 循环携带绑定宽化器（Bug 47/48 同一「迭代 join/widen」机制的两个形态）：
 * - for-of 单代表迭代（containers.$forOf unbounded 分支）；
 * - while / for / do-while 抽象条件预算耗尽（control.$while/$for/$whileSeq）。
 * 两处都把循环携带绑定折叠成**有界快照的 join**（`{0,1}` / `{0..8}`）并
 * 继承 exact conf——对任意迭代次数（原生 `xs.length` / `n=100`）是欠近似
 * （`2 ∉ {0,1}`），且引擎自身的具体求值（`count([1,2,3]) => 3 #exact`）
 * 直接证伪该抽象签名。
 *
 * 机制：每次出口快照 observe 进累计 join，同时做「新值 ⊄ 旧 join」的
 * 逐槽增长检测（leq）；预算耗尽时对增长槽位宽化到值域所在 **prim 域**
 * （无上界，native 可能域的 sound 超集）。join-幂等绑定（leq 命中，
 * 体对绑定的效应不再产生新值）不宽化——宽化结果与现状一致，行为不变。
 * break/continue 打断代表体（fork 的 break 臂冒泡，后续语句丢失，完整
 * 迭代效应不可观测）→ markInterrupted：出口按「全体打包位增长」宽化。
 */
import type { Abs } from "../../abs.ts";
import { abs, confJoin, num, str, bool, unknown, litValue } from "../../abs.ts";
import { joinAbs } from "../../objects.ts";
import { leqAbs } from "../../leq.ts";
import { numericBounds } from "../../arithmetic.ts";

/** 增长标记树：true=整值增长；slots/els/el=结构内增长路径；null=稳定 */
type GrowthTree =
  | true
  | { slots: Record<string, GrowthTree> }
  | { els: GrowthTree[] }
  | { el: GrowthTree }
  | null;

function mergeGrowth(a: GrowthTree, b: GrowthTree): GrowthTree {
  if (a === true || b === true) return true;
  if (a === null) return b;
  if (b === null) return a;
  if ("slots" in a && "slots" in b) {
    const slots: Record<string, GrowthTree> = { ...a.slots };
    for (const [k, g] of Object.entries(b.slots)) slots[k] = mergeGrowth(slots[k] ?? null, g);
    return { slots };
  }
  if ("els" in a && "els" in b) {
    if (a.els.length !== b.els.length) return true;
    return { els: a.els.map((g, i) => mergeGrowth(g, b.els[i]!)) };
  }
  if ("el" in a && "el" in b) return { el: mergeGrowth(a.el, b.el) };
  // 异构结构（如 slots vs els）：粗化到整值增长（sound）
  return true;
}

/** 累计 join acc 之上出现新值的逐槽增长检测。
 *  值级口径（leqAbs 是 shape 级 assignability——`{n:1} ⊑ {n:0}` 成立，
 *  检测不到单代表迭代的常步长计数器；acc 成为 sum 后才碰巧失败）：
 *  - 叶子字面量未被 acc 值域覆盖（sum 逐成员 / number 数值界）→ 增长；
 *  - acc 字面量、next 抽象 → 域扩张 → 增长；
 *  - 双方抽象 → shape 级不 assignable 才算。 */
function sameLitValue(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b); // NaN 配对（=== 对 NaN 恒假）
}

function valueCovered(a: Abs, v: unknown): boolean {
  if (a.shape.k === "sum") return a.shape.members.some((m) => valueCovered(m, v));
  const r = litValue(a);
  if (r.ok) return sameLitValue(r.value, v);
  const t = typeof v;
  if (a.shape.k === "prim") {
    if (a.shape.type !== t) return false;
    if (t === "number") {
      const b = numericBounds(a);
      const nv = v as number;
      if (b) {
        if (b.lo !== undefined && (nv < b.lo.value || (nv === b.lo.value && b.lo.strict))) {
          return false;
        }
        if (b.hi !== undefined && (nv > b.hi.value || (nv === b.hi.value && b.hi.strict))) {
          return false;
        }
      }
    }
    // 同型 prim 域（string/bool/bigint/symbol，或无数值界的 number）覆盖该值
    return true;
  }
  // 域形状与值类型不符（obj/tuple/unknown/any/…对字面量）→ 未覆盖
  return false;
}

function leafGrew(acc: Abs, next: Abs): boolean {
  const nR = litValue(next);
  if (nR.ok) return !valueCovered(acc, nR.value);
  const aR = litValue(acc);
  if (aR.ok) return true;
  return !leqAbs(next, acc).ok;
}

function diffGrowth(acc: Abs, next: Abs): GrowthTree {
  const as = acc.shape;
  const ns = next.shape;
  if (as.k === "obj" && ns.k === "obj") {
    let any = false;
    const slots: Record<string, GrowthTree> = {};
    for (const [k, slot] of Object.entries(ns.slots)) {
      const prev = as.slots[k];
      // 新键 = 增长；既有键递归
      const g = prev ? diffGrowth(prev.value, slot.value) : true;
      if (g !== null) {
        slots[k] = g;
        any = true;
      }
    }
    return any ? { slots } : null;
  }
  if (as.k === "tuple" && ns.k === "tuple") {
    if (as.elements.length !== ns.elements.length) return true;
    let any = false;
    const els: GrowthTree[] = [];
    for (let i = 0; i < ns.elements.length; i++) {
      const g = diffGrowth(as.elements[i]!, ns.elements[i]!);
      els.push(g);
      if (g !== null) any = true;
    }
    return any ? { els } : null;
  }
  if (as.k === "arr" && ns.k === "arr") {
    const g = diffGrowth(as.element, ns.element);
    return g === null ? null : { el: g };
  }
  // 叶子/形状漂移：值级增长检测
  return leafGrew(acc, next) ? true : null;
}

/** prim 域顶（无 term/pred 约束）：number/string/boolean/bigint/symbol */
function primTop(type: string): Abs {
  switch (type) {
    case "number":
      return num();
    case "string":
      return str();
    case "boolean":
      return bool();
    default:
      return abs({ k: "prim", type: type as never }, undefined, undefined, "exact");
  }
}

/** 值域顶（sound 超集）：lit-sum / prim → 所在 prim 域；tuple → arr
 *  （长度未知 ⇒ 下标可能 miss → OOB undefined 并入，与 widenLoopJoin 同
 *  口径）；obj → 槽位值域顶 + open（可能新增键）；其余形状已抽象，原样。 */
function domainTop(v: Abs): Abs {
  const s = v.shape;
  // 有限域完备（bool 的 {true,false}）：已是全域，原样保留（conf/join 注解
  // 不降级——正则 test 循环布尔并集 `true | false` 不折裸 boolean）
  if (s.k === "sum" && s.members.length === 2) {
    const aR = litValue(s.members[0]!);
    const bR = litValue(s.members[1]!);
    if (
      aR.ok && bR.ok && typeof aR.value === "boolean" && typeof bR.value === "boolean" &&
      aR.value !== bR.value
    ) {
      return v;
    }
  }
  let top: Abs;
  if (s.k === "sum") {
    let acc: Abs | undefined;
    for (const m of s.members) {
      const t = domainTop(m);
      acc = acc === undefined ? t : joinAbs(acc, t);
    }
    top = acc ?? v;
  } else if (s.k === "prim") {
    top = primTop(s.type);
  } else if (s.k === "tuple") {
    const els = s.elements.map((e) => domainTop(e));
    const known = els.length ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
    top = abs(
      { k: "arr", element: joinAbs(known, abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "partial")) },
      undefined,
      undefined,
      "widened",
    );
    return top;
  } else if (s.k === "arr") {
    top = abs({ k: "arr", element: domainTop(s.element) }, undefined, undefined, v.conf);
  } else if (s.k === "obj") {
    const slots: typeof s.slots = {};
    for (const [k, slot] of Object.entries(s.slots)) slots[k] = { ...slot, value: domainTop(slot.value) };
    top = abs({ ...s, slots, open: true }, undefined, undefined, v.conf);
  } else {
    // any/unknown/fn/brand/eff/never：已抽象或不可数值增长，原样
    return v;
  }
  return top === v ? v : confJoin2(top);
}

function confJoin2(top: Abs): Abs {
  const c = confJoin(top.conf, "widened");
  return c === top.conf ? top : { ...top, conf: c };
}

/** 按增长树宽化：稳定路径原样保留（精度不变），增长路径取值域顶 */
function widenWithPath(v: Abs, g: GrowthTree): Abs {
  if (g === null) return v;
  if (g === true) return domainTop(v);
  const s = v.shape;
  if ("slots" in g && s.k === "obj") {
    const slots: typeof s.slots = {};
    for (const [k, slot] of Object.entries(s.slots)) {
      const gi = g.slots[k];
      slots[k] = gi === undefined ? slot : { ...slot, value: widenWithPath(slot.value, gi) };
    }
    return abs({ ...s, slots }, undefined, undefined, v.conf);
  }
  if ("els" in g && s.k === "tuple") {
    // 长度稳定、元素增长：保长度，元素域取顶
    const elements = s.elements.map((e, i) => widenWithPath(e, g.els[i] ?? null));
    return abs({ ...s, elements }, undefined, undefined, v.conf);
  }
  if ("el" in g && s.k === "arr") {
    return abs({ k: "arr", element: widenWithPath(s.element, g.el) }, undefined, undefined, v.conf);
  }
  // 增长树与现形状不匹配（join 后形状漂移）：整值宽化
  return domainTop(v);
}

export interface LoopCarriedWidener {
  /** 记录一次出口快照（累计 join + 逐槽增长检测） */
  observe(p: Abs): void;
  /** 代表体被 break/continue 打断（完整迭代效应不可观测）→ 出口整体宽化 */
  markInterrupted(): void;
  /** 预算耗尽出口：并入最终态后按增长宽化；无增长时原样返回累计 join */
  widenFinal(final: Abs): Abs;
}

export function makeLoopWidener(): LoopCarriedWidener {
  let acc: Abs | undefined;
  let growth: GrowthTree = null;
  let interrupted = false;
  const observe = (p: Abs): void => {
    if (acc === undefined) {
      acc = p;
      return;
    }
    growth = mergeGrowth(growth, diffGrowth(acc, p));
    acc = joinAbs(acc, p);
  };
  return {
    observe,
    markInterrupted(): void {
      interrupted = true;
    },
    widenFinal(final: Abs): Abs {
      observe(final);
      const base = acc ?? final;
      const g: GrowthTree = interrupted ? true : growth;
      return g === null ? base : widenWithPath(base, g === true ? true : g);
    },
  };
}
