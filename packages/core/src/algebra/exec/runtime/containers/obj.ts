/**
 * 对象构造/展开/rest 与容器快照：$obj/$setProto/$spread/$objRest/$copy。
 *
 * Invariants:
 * - $copy 是 fork/switch/循环 pack 的状态分离机制：所有可挂侧表的形状
 *   （extState/propFlags/accessorTable/nullProto/matchIter）必须随快照
 *   迁移，副本丢失侧表 = 臂内写不再硬抛 / 延迟异常静默丢弃。
 * - $spread 原生语义会**调用**源对象 getter 并把结果拷为数据槽——必须
 *   用 getter 求值后的副本（accessorTable 求值，抛/失败折 unknown）。
 */
import type { Abs } from "../../../abs.ts";
import { abs, confJoin, unknown } from "../../../abs.ts";
import {
  joinAbs,
  objOf,
  isObj,
  spread as spreadObj,
  type ObjShape,
  type Slot,
  migrateNullProto,
  getSlot,
  setSlot,
  setProtoAbs,
} from "../../../objects.ts";
import {
  migrateInvariants,
  enumOwnKeys,
  isEnumerableView,
} from "../../../builtins.ts";
import {
  isNullishAbs,
} from "../../member-diag.ts";
import { TYPED_ARRAY_ELEMENT } from "../../../builtins/shared.ts";
import { typedArrayEnumKeyView } from "../../../builtins/object/enum-entries.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import { getEvalClass, classInstanceInnerOf } from "../../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../../class-mark.ts";
import { markFreshInstance } from "../../../instance-id.ts";
import {
  NudoThrow,
  clearStaleTermPred,
  asAbsVal,
} from "../state.ts";
import { $in, evalClassChain } from "../members.ts";
import { migrateAccessors, accessorTable } from "../../../accessors.ts";
import { copyMatchIterTables } from "../../match-iter.ts";
import { $call } from "../../call.ts";

/**
 * 私有名接收者校验（Bug 78 "#" 混淆键设计）：原生
 * PrivateFieldGet/Set/PrivateCall 要求接收者是**声明该私有名的
 * 类**的实例，否则 TypeError。私有名是类作用域——不经继承链
 * （子类实例不含父类私有名）。
 * - brand：自有槽（私有字段/静态字段）/ 私有访问器 / 私有方法
 *   命中即声明类实例；否则确定 foreign receiver → 硬抛。
 * - prim/eff/fn/tuple/arr：绝非类实例 → 硬抛。
 * - obj/any/sum：抽象对象可能是声明类实例 → may TypeError。
 * 公有名零开销（首字符前缀判定）。
 */
export function privateNameGuard(o: unknown, key: string): void {
  if (key.charCodeAt(0) !== 35 /* # */) return;
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    // 宿主值作私有名接收者：原生 TypeError（私有名语法只可达
    // 类实例；泄漏宿主值时 fail-closed 硬抛）
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const s = (o as Abs).shape;
  if (s.k === "brand") {
    const inner = s.shape;
    if (inner?.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return; // 声明的私有字段
    }
    const spec = getEvalClass(s.name);
    if (!spec) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (classNameOfValue(o as object) === s.name) {
      // 类值接收者：私有静态成员（静态槽/静态访问器/静态方法；
      // 声明的静态字段——$staticInit 初始化期槽尚未存在）
      if (
        spec.staticAccessors?.[key] ||
        spec.staticMethods?.[key] ||
        (spec.statics !== undefined && key in spec.statics)
      ) {
        return;
      }
    } else {
      // 实例接收者：私有实例成员。私有名沿构造链安装到子类
      // 实例（InitializeInstanceElements 逐类执行——父类私有
      // 字段/方法会物化到子类实例）——声明检查沿类链；槽上
      // 已物化字段在上方命中，此处补覆盖初始化期尚未物化的
      // 声明字段/访问器/方法（applyInstanceFields 写父类字段
      // 时接收者品牌是子类名）
      for (const n of evalClassChain(s.name)) {
        const sup = getEvalClass(n);
        if (
          sup?.accessors?.[key] ||
          sup?.methods?.[key] ||
          sup?.instanceFields?.some((f) => f.name === key)
        ) {
          return;
        }
      }
    }
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (
    s.k === "prim" ||
    s.k === "eff" ||
    s.k === "fn" ||
    s.k === "tuple" ||
    s.k === "arr"
  ) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (s.k === "obj" || s.k === "any" || s.k === "sum") {
    // Bug 115：闭 obj（对象字面量 / spread 产物 / Object.create(null) 靶）
    // 必无私有名——私有名只安装于类实例（brand 内槽 / class spec 声明面）
    // → 定抛 TypeError。open obj（动态键/未知槽/代理靶）与 any/sum 保留
    // may 档。携带同名槽的克隆/代理靶（非 optional）放行——与 brand 臂
    // 槽探测同口径。
    if (s.k === "obj") {
      const os = s as { slots: Record<string, { value: Abs; optional?: boolean }>; open?: boolean };
      const slot = getSlot(os.slots, key);
      if (slot && !slot.optional) return;
      if (os.open !== true && !("index" in os)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
    }
    recordMayThrow({
      kind: "TypeError",
      cause: `private member ${key} on receiver that may not declare it`,
    });
  }
  // unknown：fail-closed 令牌，不记（与 $call/$in 口径一致）
}

/**
 * 深拷贝可变容器（fork/switch 快照与循环 pack 用）。
 * 容器写就地进行后（引用语义），分析分支/迭代的状态分离必须靠拷贝——
 * 浅引用快照会让臂间/迭代间互相污染。
 */
export function $copy(a: Abs): Abs {
  const s = a.shape;
  // 所有可能挂 extState/propFlags 的形状都必须迁移不变性侧表：
  // fork/switch 用 $copy 做快照，副本丢失 frozen/sealed 会让臂内写不再硬抛
  if (s.k === "tuple") {
    const next = abs(
      {
        k: "tuple",
        elements: s.elements.map($copy),
        // rest 槽必须随快照迁移（与 hof snapshotAbs 同口径），否则副本丢尾段
        ...(s.rest ? { rest: $copy(s.rest) } : {}),
        holes: s.holes ? [...s.holes] : undefined,
      },
      a.term,
      a.pred,
      a.conf,
    );
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "arr") {
    const next = abs({ k: "arr", element: $copy(s.element) }, a.term, a.pred, a.conf);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "obj") {
    const slots: Record<string, Slot> = {};
    for (const [k, v] of Object.entries(s.slots)) {
      setSlot(slots, k, { ...v, value: $copy(v.value) });
    }
    const next = objOf(slots, {
      index: s.index ? { key: $copy(s.index.key), value: $copy(s.index.value) } : undefined,
      open: s.open,
    });
    next.conf = a.conf;
    // term/pred 随快照迁移（与 tuple/arr/sum/eff 分支及 snapshotAbs 同口径；
    // objOf 不带项位——此前 obj 副本丢项，导出桥 $copy 实参后递归各层的
    // callBudgetKey 指纹全坍缩成同键，父帧/子帧误判 cycle 截断 → unknown
    // 污染（issue #120 的 lazy 递归模板实测暴露）。
    next.term = a.term;
    next.pred = a.pred;
    migrateAccessors(a, next);
    migrateInvariants(a, next);
    migrateNullProto(a, next);
    // 生成器 / 模板标签 / matchAll 迭代器对象（obj 形 +
    // @@iterator 槽）：侧表随副本迁移，否则臂内消费点
    // 重放查不到副本（延迟异常静默丢弃，L2 假阴）
    copyMatchIterTables(a, next);
    return next;
  }
  if (s.k === "brand") {
    const inner = $copy(s.shape);
    const next = abs({ k: "brand", name: s.name, shape: inner }, a.term, a.pred, a.conf);
    const clsName = classNameOfValue(a as object);
    if (clsName) markClassValue(next as object, clsName);
    migrateInvariants(a, next);
    // RegExpMatchIterator brand：匹配项侧表随副本迁移
    copyMatchIterTables(a, next);
    return next;
  }
  if (s.k === "eff") {
    const next = abs({ k: "eff", eff: s.eff, inner: $copy(s.inner) }, a.term, a.pred, a.conf);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "sum") {
    return abs({ k: "sum", members: s.members.map($copy) }, a.term, a.pred, a.conf);
  }
  return a;
}

/** 对象字面量 → Abs obj（槽位写走 setSlot，`__proto__` 不踩宿主 setter） */
export function $obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = Object.create(null);
  for (const k of Object.keys(slots)) {
    setSlot(s, k, { value: asAbsVal(slots[k]!) });
  }
  // R2b：每次字面量求值产出新对象——打新鲜实例标（=== 折 false）
  return markFreshInstance(objOf(s));
}

/**
 * 对象字面量非计算 `__proto__: v` 的特殊原型设定（ES PropertyDefinition）。
 * - v 为 null → null-proto（无 Object.prototype 回退）
 * - v 为 object → 保守 open（继承读不折 exact undefined；细节不建模）
 * - v 为 primitive → 原生忽略（无自有键、不改原型）
 */
export function $setProto(o: Abs, proto: Abs): Abs {
  const next = setProtoAbs(o, proto);
  if (next !== o) clearStaleTermPred(o);
  return next;
}

/** 对象展开 { ...a, b } */
export function $spread(a: Abs, b: Abs): Abs {
  let bb = asAbsVal(b);
  // 原生展开会**调用**源对象 getter 并把结果作为数据槽拷入。Bug 109：
  // CopyDataProperties 只拷枚举自有键——枚举视图（defineProperty 记的
  // enumerable:false 键 / internal 私有槽剔除）与 getter 物化同趟重组
  //（flag 侧表键控**原始** Abs 身份：先物化后过滤会丢 flag 表、先过滤后
  // 物化会丢 accessorTable——单趟按枚举键集物化访问器再建副本）。
  // 非枚举访问器的 getter 原生不调用。重组副本丢侧表（结果槽是纯数据面）。
  const acc = bb && typeof bb === "object" ? accessorTable.get(bb as object) : undefined;
  if (bb && bb.shape.k === "obj") {
    const os = bb.shape as ObjShape;
    const enumKeys = new Set(enumOwnKeys(bb, os.slots));
    // 纯访问器键可能无同名数据槽（不在 slots）——枚举访问器键并入
    //（isEnumerableView 只查 flag，internal 槽不挂访问器）
    if (acc) {
      for (const k of acc.keys()) {
        if (isEnumerableView(bb, k)) enumKeys.add(k);
      }
    }
    if (enumKeys.size !== Object.keys(os.slots).length || acc) {
      const slots: Record<string, Slot> = {};
      for (const k of enumKeys) {
        const g = acc?.get(k)?.get;
        if (g) {
          // 纯 getter（无同名数据槽）也要求值拷入——{ get x(){return 5} } 展开后 .x===5
          setSlot(slots, k, { value: g(bb) });
        } else {
          setSlot(slots, k, getSlot(os.slots, k)!);
        }
      }
      const rebuilt: ObjShape = { k: "obj", slots };
      if (os.open) rebuilt.open = true;
      if (os.index) rebuilt.index = os.index;
      bb = abs(rebuilt, undefined, undefined, bb.conf);
    }
  }
  // any 展开：无约束键 → open obj（不是空 {} / unknown）
  const aa = asAbsVal(a);
  // 必须用 getter 求值后的 bb（不是原始 b0）——否则展开丢掉访问器结果
  let b0 = bb;
  // Bug 84：类实例 brand 源（{...new A()}）——展开公有可枚举自有槽（私有
  // Slot.internal 与 enumerable:false 剔除；此前 brand 源键集不可判 → 保守
  // open 空 obj，公有字段全丢）
  {
    const ciInner = classInstanceInnerOf(b0);
    if (ciInner) {
      const ciSlots = (ciInner.shape as ObjShape).slots;
      const pub: Record<string, Slot> = {};
      for (const k of enumOwnKeys(ciInner, ciSlots)) {
        setSlot(pub, k, getSlot(ciSlots, k)!);
      }
      b0 = abs({ k: "obj", slots: pub }, undefined, undefined, b0.conf);
    }
  }
  // Bug 125 残余：TypedArray 源（{...ta}）——CopyDataProperties 展开自有
  // 可枚举索引键，按长度槽投影 "0".."n-1"（值 = 元素域；与
  // assignSourceSlots 的 TA 臂同口径）；长度不可判 → 保持 brand 走
  // spreadObj 的 elemsOf 域（sound 抽象，不折 wrong-exact 空）。
  {
    const bs = b0?.shape;
    if (bs?.k === "brand" && TYPED_ARRAY_ELEMENT[bs.name] !== undefined) {
      const view = typedArrayEnumKeyView(b0);
      if (view?.k === "exact") {
        const pub: Record<string, Slot> = {};
        for (let i = 0; i < view.count; i++) {
          setSlot(pub, String(i), {
            value: abs({ k: "prim", type: TYPED_ARRAY_ELEMENT[bs.name]! }, undefined, undefined, "exact"),
          });
        }
        b0 = abs({ k: "obj", slots: pub }, undefined, undefined, b0.conf);
      }
    }
  }
  if (aa?.shape?.k === "any" || b0?.shape?.k === "any") {
    const base = spreadObj(
      aa?.shape?.k === "any" ? abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial") : aa,
      b0?.shape?.k === "any" ? abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial") : b0,
    );
    return base;
  }
  return spreadObj(aa, b0);
}

/** 对象解构接收者守卫（Bug 32）：原生对象解构 = ToObject(receiver) +
 *  CopyDataProperties——null/undefined 接收者在任何键读/排除之前就抛
 *  TypeError（"Cannot destructure 'null' as it is null"）。rest-only 模式
 *  （`const {...r} = X`）此前只发 $objRest 不发 $get，接收者从不校验。
 *  - nullish 字面量 → hard NudoThrow（tier 1；键路径经 $get 同口径）
 *  - any / sum 含 nullish 或 any 臂 → may TypeError（tier 2；值域投影不变）
 *  - 非 nullish prim（含字符串/number/symbol/bigint）→ 原生 ToObject 装箱，
 *    CopyDataProperties 全量（node 实测 `const {...r} = "ab"` → {"0":"a","1":"b"}）
 *  unknown 是引擎 fail-closed 令牌，不记（与 $call 同口径，避免 L2 假报）。 */
function objRestGuard(o: Abs): void {
  const arm = (x: Abs): "nullish" | "may" | "total" => {
    if (isNullishAbs(x)) return "nullish";
    const k = x.shape.k;
    if (k === "any") return "may";
    return "total";
  };
  if (o.shape.k === "sum") {
    let may = false;
    for (const m of o.shape.members) {
      const a = arm(m);
      if (a === "nullish" || a === "may") may = true;
    }
    if (may) {
      recordMayThrow({
        kind: "TypeError",
        cause: "object rest destructuring of possibly nullish receiver",
      });
    }
    return;
  }
  const a = arm(o);
  if (a === "nullish") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (a === "may") {
    recordMayThrow({
      kind: "TypeError",
      cause: "object rest destructuring of possibly nullish receiver",
    });
  }
}

/**
 * 解构 rest：`const { a, ...rest } = o` → rest = o 去掉 named keys。
 * closed obj：剩余槽 closed；open / optional 键：rest 仍 open（可能有未知键）。
 */
export function $objRest(o: Abs, keys: string[]): Abs {
  o = asAbsVal(o);
  objRestGuard(o);
  if (o.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = o.shape.members.map((m) => $objRest(m, keys));
    return parts.length ? parts.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  if (!isObj(o)) {
    // any 解构 rest：无约束对象面（open），不是 unknown
    if (o.shape.k === "any") {
      const shape: Abs["shape"] = { k: "obj", slots: {}, open: true };
      return { shape, conf: "partial" };
    }
    return unknown;
  }
  const drop = new Set(keys);
  const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
  let openRest = o.shape.open === true;
  // Bug 109：rest 只收枚举自有键（CopyDataProperties 同口径——
  // defineProperty 记的 enumerable:false 键 / internal 私有槽不进 rest；
  // enumOwnKeys 视图，obj 源 flag 侧表键控本 Abs 身份）
  for (const k of enumOwnKeys(o, o.shape.slots)) {
    if (drop.has(k)) continue;
    setSlot(slots, k, o.shape.slots[k]!);
    // optional 源键可能仍以 undefined 出现在 rest 的动态面；闭槽无需 open
  }
  // 提取的 optional 键：JS rest 会排除该键，但 open 对象上未知键仍可能进 rest
  if (o.shape.open) openRest = true;
  const shape: Abs["shape"] = { k: "obj", slots };
  if (openRest) (shape as { open?: boolean }).open = true;
  return { shape, conf: o.conf === "exact" ? "exact" : confJoin(o.conf, "partial") };
}
