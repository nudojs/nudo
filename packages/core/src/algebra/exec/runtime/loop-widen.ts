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
 *
 * issue #156（数组绑定变异面）：push 累积的 tuple 快照按**长度维**增长
 * （arr 形状抹除）——元素域增长单独检测（diffGrowth 长度失配 → {el}），
 * 宽化走 arrify：元素域 = 全部观测元素域 join，不整值 domainTop、不
 * 烘焙 OOB undefined（越界是读位事实，$idx 抽象下标读已并入）、不凭空
 * 注入 unknown 元素臂（空 tuple 只在零观测元素时诚实取 unknown 顶）。
 */
import type { Abs } from "../../abs.ts";
import { abs, confJoin, num, str, bool, unknown, never, litValue } from "../../abs.ts";
import { joinAbs, joinObjects } from "../../objects.ts";
import { leqAbs } from "../../leq.ts";
import { numericBounds } from "../../arithmetic.ts";
import { oobUndef } from "./state.ts";

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

/** tuple 元素域 join；无元素 → undefined（调用方决定空时语义：宽化顶
 *  unknown（诚实：未观测的 push 仍可能发生）/ 增长检测底 never。hole
 *  下标读值 undefined 是真实元素值域（spread/迭代产出 undefined），并入。 */
function joinElems(t: { elements: Abs[]; holes?: number[] }): Abs | undefined {
  const parts = t.holes?.length ? [...t.elements, oobUndef()] : t.elements;
  return parts.length > 0 ? parts.reduce((x, y) => joinAbs(x, y)) : undefined;
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
    if (as.elements.length !== ns.elements.length) {
      // #156 长度增长（push/unshift 累积）：值级增长在**长度维**（arr
      // 形状抹除）——元素域增长单独检测（空 → never 底：首个观测元素即
      // 增长），宽化走 arrify + 元素路径，不整值 domainTop
      const g = diffGrowth(joinElems(as) ?? never, joinElems(ns) ?? never);
      return { el: g };
    }
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

/** 数组族 sum 的元素域聚合：每个成员贡献其元素域（tuple = 元素 join，
 *  空 tuple 贡献空；arr = element），聚合 join。任一非数组成员 →
 *  ok=false（不可收敛，调用方走原路径）。collapse=true 表示值得收敛
 *  （含 arr 臂或 tuple 长度失配——与 widenLoopJoin 的守卫同口径：等长
 *  tuple-only join 不收敛，保长度精度）。 */
function sumArrParts(s: { members: Abs[] }): {
  ok: boolean;
  collapse: boolean;
  element?: Abs;
} {
  const elems: Abs[] = [];
  const lengths = new Set<number>();
  let hasArr = false;
  for (const m of s.members) {
    const ms = m.shape;
    if (ms.k === "tuple") {
      lengths.add(ms.elements.length);
      const e = joinElems(ms);
      if (e) elems.push(e);
    } else if (ms.k === "arr") {
      hasArr = true;
      elems.push(ms.element);
    } else {
      return { ok: false, collapse: false };
    }
  }
  return {
    ok: true,
    collapse: hasArr || lengths.size > 1,
    element: elems.length > 0 ? elems.reduce((x, y) => joinAbs(x, y)) : undefined,
  };
}

/** 数组化（#156）：tuple / tuple·arr 同族 sum → 单一 arr，元素域 = 全部
 *  已知元素域 join（空 tuple 成员贡献空，不注入 unknown 顶——与
 *  $arrMutContainer 的 splice/sort 降 arr、control 的 widenLoopJoin 同
 *  口径）。不烘焙 OOB undefined——越界是**读位**事实（$idx 抽象下标读已
 *  并入），不是元素值域；全体空（零观测元素）→ unknown 诚实顶。非数组
 *  族 → undefined（调用方走原路径）。 */
function arrify(v: Abs): Abs | undefined {
  const s = v.shape;
  if (s.k === "tuple") {
    return abs(
      { k: "arr", element: joinElems(s) ?? unknown },
      undefined,
      undefined,
      confJoin(v.conf, "widened"),
    );
  }
  if (s.k === "sum") {
    const p = sumArrParts(s);
    if (!p.ok) return undefined;
    return abs(
      { k: "arr", element: p.element ?? unknown },
      undefined,
      undefined,
      confJoin(v.conf, "widened"),
    );
  }
  return undefined;
}

/** 值域顶（sound 超集）：lit-sum / prim → 所在 prim 域；tuple·arr 同族
 *  sum / tuple → 单一 arr（元素域顶 join，#156——不再逐成员 map 出多臂
 *  sum、不烘焙 OOB undefined、不凭空注入 unknown 元素臂）；obj → 槽位
 *  值域顶 + open（可能新增键）；其余形状已抽象，原样。 */
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
    // 数组族 sum（长度失配 / 混 arr 臂）：整体数组化，元素域取顶——整值
    // 增长（interrupted / 形状漂移）到达这里时的 sound 超集
    const collapsed = arrify(v);
    if (collapsed) {
      return confJoin2(
        abs(
          { k: "arr", element: domainTop((collapsed.shape as { k: "arr"; element: Abs }).element) },
          undefined,
          undefined,
          collapsed.conf,
        ),
      );
    }
    let acc: Abs | undefined;
    for (const m of s.members) {
      const t = domainTop(m);
      acc = acc === undefined ? t : joinAbs(acc, t);
    }
    top = acc ?? v;
  } else if (s.k === "prim") {
    top = primTop(s.type);
  } else if (s.k === "tuple") {
    // #156：元素域 = 已知元素域顶 join（空 → unknown 诚实顶：整值宽化下
    // 未观测的 push 仍可能发生）；OOB undefined 不烘焙（读位事实，$idx
    // 抽象下标读已并入）
    const parts = s.holes?.length ? [...s.elements, oobUndef()] : s.elements;
    const known = parts.length > 0
      ? parts.map((e) => domainTop(e)).reduce((x, y) => joinAbs(x, y))
      : unknown;
    return abs({ k: "arr", element: known }, undefined, undefined, "widened");
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

/** 增长树下行前的结构归一（#156）：打包容器的槽位 join 走 joinValues——
 *  obj 值槽不结构合并，sum-of-objs 里的「同一绑定的顺序状态」若逐成员
 *  独立宽化，零元素成员会独自放大成 arr(unknown)（元素域联合被丢）。
 *  对同 key 集成员先 joinObjects 折成槽位级并（元素/槽位域取联合，是各
 *  成员独自取顶的 sound 超集），再随树递归；异 key 集 / 非全 obj 成员
 *  保持 sum（widenWithPath 走 domainTop 整值兜底，行为不变）。 */
function normalizeForWiden(v: Abs, g: GrowthTree): Abs {
  if (g === null) return v;
  const s = v.shape;
  let target = v;
  if (s.k === "sum" && s.members.length > 0 && s.members.every((m) => m.shape.k === "obj")) {
    target = s.members.reduce((x, y) => joinObjects(x, y));
  }
  if (g === true || !("slots" in g)) return target;
  const ts = target.shape;
  if (ts.k !== "obj") return target;
  const slots: typeof ts.slots = {};
  for (const [k, slot] of Object.entries(ts.slots)) {
    const gi = g.slots[k];
    slots[k] = gi === undefined ? slot : { ...slot, value: normalizeForWiden(slot.value, gi) };
  }
  return abs({ ...ts, slots }, undefined, undefined, target.conf);
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
  if ("el" in g) {
    // #156：长度增长路径的 base 可能是 tuple / tuple·arr 同族 sum（不同
    // 长度快照的 join）——先数组化再走元素宽化；已是 arr 原样
    const a = s.k === "arr" ? v : arrify(v);
    if (a && a.shape.k === "arr") {
      return abs(
        { k: "arr", element: widenWithPath(a.shape.element, g.el) },
        undefined,
        undefined,
        a.conf,
      );
    }
  }
  // 增长树与现形状不匹配（join 后形状漂移）：整值宽化
  return domainTop(v);
}

/** 无增长退出的数组族 sum 收敛（#156 残留）：顶层与 obj 槽位递归，把
 *  「同一绑定顺序状态」的 arr/tuple 多臂 sum 收成单 arr（元素域并，
 *  conf 沿用该 sum 自身——表示收敛非宽化）。等长 tuple-only join、
 *  非数组族、非收敛形态原样。 */
function collapseArrSums(v: Abs): Abs {
  const s = v.shape;
  if (s.k === "sum") {
    const p = sumArrParts(s);
    if (p.ok && p.collapse && p.element) {
      return abs({ k: "arr", element: p.element }, undefined, undefined, v.conf);
    }
    return v;
  }
  if (s.k === "obj") {
    let changed = false;
    const slots: typeof s.slots = {};
    for (const [k, slot] of Object.entries(s.slots)) {
      const w = collapseArrSums(slot.value);
      if (w !== slot.value) changed = true;
      slots[k] = { ...slot, value: w };
    }
    return changed ? abs({ ...s, slots }, undefined, undefined, v.conf) : v;
  }
  return v;
}

export interface LoopCarriedWidener {
  /** 记录一次出口快照（累计 join + 逐槽增长检测） */
  observe(p: Abs): void;
  /** 代表体被 break/continue 打断（完整迭代效应不可观测）→ 出口整体宽化 */
  markInterrupted(): void;
  /** 预算耗尽出口：并入最终态后按增长宽化；无增长时返回累计 join（数组
   *  族 sum 收敛为单 arr——同一绑定顺序状态的表示收敛，非宽化） */
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
      if (g === null) {
        // #156 残留：无增长但快照 join 是数组族 sum（参数位 arr 绑定的顺序
        // 状态：unknown 吸收 push 值 → 元素域增长检测不到，joinAbs 把
        // arr×arr 摊成多臂 sum）。同一绑定的顺序状态按元素域并收敛成单
        // arr（与 {el} 增长路径的 arrify、control 的 widenLoopJoin 同口
        // 径）；conf 沿用该值自身的累计 join——这是表示收敛不是宽化，
        // 不标 widened。等长 tuple-only join 不收敛（保长度精度）。打包
        // 绑定包是 obj（每绑定一槽），sum 藏在槽位里——递归下钻。
        return collapseArrSums(base);
      }
      return widenWithPath(normalizeForWiden(base, g), g);
    },
  };
}
