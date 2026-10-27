/**
 * 对象构造/展开/rest 与容器快照：$obj/$setProto/$spread/$objRest/$copy。
 *
 * Invariants:
 * - $copy 是 fork/switch/循环 pack 的状态分离机制：所有可挂侧表的形状
 *   （extState/propFlags/accessorTable/nullProto/matchIter）必须随快照
 *   迁移，副本丢失侧表 = 臂内写不再硬抛 / 延迟异常静默丢弃。
 * - fn 形状同样是可扩展对象：expando 槽面（含 optionalParams/ctor/类型
 *   侧信息）逐臂独立复制（共享槽面会让兄弟臂写互相覆盖）；impl 身份、
 *   槽面写权限侧表（objects.ts 的 userFnSlotOwners）、null-proto 标记与
 *   新鲜实例 id 随副本迁移（侧表丢失 ⇒ `__proto__` 读翻转 / `===` 退化）。
 * - $spread 原生语义会**调用**源对象 getter 并把结果拷为数据槽——必须
 *   用 getter 求值后的副本（accessorTable 求值，抛/失败折 unknown）。
 * - $objRest 同理：原生 CopyDataProperties 对保留键发 Get ⇒ getter 必须
 *   被调用（副作用发生），rest 槽落 getter 的**返回值**（非占位 undefined）。
 */
import type { Abs, Shape } from "../../../abs.ts";
import { abs, confJoin, litValue, unknown } from "../../../abs.ts";
import {
  joinAbs,
  objOf,
  isObj,
  spread as spreadObj,
  type ObjShape,
  type Slot,
  migrateNullProto,
  migrateUserFnSlots,
  getSlot,
  setSlot,
  setProtoAbs,
} from "../../../objects.ts";
import { getFnImpl, attachFnImpl } from "../../../abs-fn.ts";
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
import { getEvalClass, classInstanceInnerOf, carryClassSpec } from "../../class-registry.ts";
import { classNameOfValue, markClassValue } from "../../../class-mark.ts";
import { markFreshInstance, migrateFreshInstance } from "../../../instance-id.ts";
import {
  NudoThrow,
  clearStaleTermPred,
  asAbsVal,
} from "../state.ts";
import { evalClassChain } from "../members.ts";
import { migrateAccessors, accessorTable } from "../../../accessors.ts";
import { copyMatchIterTables } from "../../match-iter.ts";
import { slotKeyOfSymbolAbs } from "../symbol-key.ts";
import "../../call.ts";

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
      // 声明的静态字段——$class 求值期槽尚未存在）
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
 *
 * `memo` 是**身份图**：同一原始 Abs 在同一次快照里必须映射到同一个副本。
 * - 循环引用（`o.self = o`）靠「先占位、后填空」终止递归；
 * - 共享子图（DAG）不再指数复制；
 * - 同一次快照/调用边界里的多个绑定保持别名关系（memo 必须由调用方共享；
 *   `$copy(a)` 单参调用只为兼容旧行为，等价于每次新建 memo）。
 *
 * 注意：这只能保证**被复制集合内部**的身份关系。若 `b` 是 `a` 的别名但
 * 不在同一次快照的绑定集合里，fork/pack 仍会断开 `a`/`b`；调用方必须把
 * 别名伙伴一起纳入复制集合（见 transpile 的 aliasGroups）。
 */
export function $copy(a: Abs, memo?: WeakMap<object, Abs>): Abs {
  // DEC-006 B/C 同口径（$get / $set 已各自实施）：free identifier 可能把
  // **宿主值**漏进转译产物（fork 快照对 `globalThis` / `process` / `Math`… 
  // 这类未遮蔽的宿主全局发射 `$copy(<宿主对象>)`）——非 Abs 目标
  // fail-closed **返回原值**（调用点 `x = $copy(x)` 重绑为自赋值 no-op），
  // 禁止裸读 `.shape` 抛宿主 TypeError（那会被 run.ts 的 evalFallbackOf
  // 归为 nudo:internal ⇒ 合法代码门禁假红 + 引擎内部异常原文泄漏）。
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  return copyWithMemo(a, memo ?? new WeakMap());
}

function copyWithMemo(a: Abs, memo: WeakMap<object, Abs>): Abs {
  const hit = memo.get(a as object);
  if (hit) return hit;
  const s = a.shape;
  // 所有可能挂 extState/propFlags 的形状都必须迁移不变性侧表：
  // fork/switch 用 $copy 做快照，副本丢失 frozen/sealed 会让臂内写不再硬抛
  if (s.k === "tuple") {
    const elements: Abs[] = [];
    const next = abs(
      {
        k: "tuple",
        elements,
        holes: s.holes ? [...s.holes] : undefined,
      },
      a.term,
      a.pred,
      a.conf,
    );
    memo.set(a, next);
    for (const el of s.elements) elements.push(copyWithMemo(el, memo));
    // rest 槽必须随快照迁移（与 hof snapshotAbs 同口径），否则副本丢尾段
    if (s.rest) (next.shape as Extract<Shape, { k: "tuple" }>).rest = copyWithMemo(s.rest, memo);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "arr") {
    const next = abs({ k: "arr", element: unknown }, a.term, a.pred, a.conf);
    memo.set(a, next);
    (next.shape as Extract<Shape, { k: "arr" }>).element = copyWithMemo(s.element, memo);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "obj") {
    const slots: Record<string, Slot> = {};
    const next = objOf(slots, { open: s.open });
    memo.set(a, next);
    for (const [k, v] of Object.entries(s.slots)) {
      setSlot(slots, k, { ...v, value: copyWithMemo(v.value, memo) });
    }
    if (s.index) {
      (next.shape as Extract<Shape, { k: "obj" }>).index = {
        key: copyWithMemo(s.index.key, memo),
        value: copyWithMemo(s.index.value, memo),
      };
    }
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
  if (s.k === "fn") {
    /**
     * 函数对象亦是**可扩展对象**：expando 槽 / optionalParams / ctor 随
     * 快照独立复制——fork 臂共享同一槽面会让兄弟臂的写互相覆盖
     *（`if (cond) { g.x = 1 } else { g.x = 2 }` 折成 `2 #exact`）。
     * impl / 槽面所有权是身份侧表，副本必须继承：否则臂内调用退化
     * unknown、臂内再写 expando 静默丢弃。term/pred/conf 同其它分支。
     */
    const shape: Extract<Shape, { k: "fn" }> = { ...s, params: [...s.params] };
    const next = abs(shape, a.term, a.pred, a.conf);
    memo.set(a, next);
    if (s.paramTypes) shape.paramTypes = s.paramTypes.map((t) => copyWithMemo(t, memo));
    if (s.returnType) shape.returnType = copyWithMemo(s.returnType, memo);
    if (s.optionalParams) shape.optionalParams = [...s.optionalParams];
    if (s.slots) {
      const slots: NonNullable<Extract<Shape, { k: "fn" }>["slots"]> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        setSlot(slots, k, { ...slot, value: copyWithMemo(slot.value, memo) });
      }
      shape.slots = slots;
    }
    const impl = getFnImpl(a);
    if (impl) attachFnImpl(next, impl);
    migrateUserFnSlots(a, next);
    migrateInvariants(a, next);
    // 侧表身份不得随副本丢失：null-proto 标记（`f.__proto__` 读 undefined）
    // 与新鲜实例 id（strictEq 对不创建事件折 false）。
    migrateNullProto(a, next);
    migrateFreshInstance(a, next);
    return next;
  }
  if (s.k === "brand") {
    // 先占位（inner 暂 unknown），再解引用 inner：brand 自引用（类实例字段
    // 指回自身）也由 memo 终止。
    const next = abs({ ...s, shape: unknown }, a.term, a.pred, a.conf);
    memo.set(a, next);
    (next.shape as Extract<Shape, { k: "brand" }>).shape = copyWithMemo(s.shape, memo);
    const clsName = classNameOfValue(a as object);
    if (clsName) markClassValue(next as object, clsName);
    // BUG-172：类规格随值携带——快照副本必须继承（否则 fork 臂里的实例
    // 退回裸名回表，跨模块同名类再次串味）。
    carryClassSpec(a, next);
    migrateInvariants(a, next);
    // 新鲜实例 id 随快照迁移（fork 副本 = 同一次创建事件）：否则
    // `a === new C()` 从 false 退化成 unknown（同 fn 分支的缺口）。
    migrateFreshInstance(a, next);
    // RegExpMatchIterator brand：匹配项侧表随副本迁移
    copyMatchIterTables(a, next);
    return next;
  }
  if (s.k === "eff") {
    // rejected/unsettled 是 promise 的可观测态——副本必须保留（旧实现只
    // 复制 inner，fork 后拒绝臂/悬挂面静默丢失）。
    const next = abs({ ...s, inner: unknown }, a.term, a.pred, a.conf);
    memo.set(a, next);
    (next.shape as Extract<Shape, { k: "eff" }>).inner = copyWithMemo(s.inner, memo);
    if (s.rejected) (next.shape as Extract<Shape, { k: "eff" }>).rejected = copyWithMemo(s.rejected, memo);
    migrateInvariants(a, next);
    return next;
  }
  if (s.k === "sum") {
    const next = abs({ k: "sum", members: [] }, a.term, a.pred, a.conf);
    memo.set(a, next);
    (next.shape as Extract<Shape, { k: "sum" }>).members = s.members.map((m) => copyWithMemo(m, memo));
    return next;
  }
  // prim / never / any / unknown：不可变，无需复制（也不可能有环）
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
 * 排除集可含**动态计算键**（Abs）——原生按求值后的键排除（Bug 160）。
 * closed obj：剩余槽 closed；open / optional 键：rest 仍 open（可能有未知键）。
 */
export function $objRest(o: Abs, keys: Array<string | Abs>): Abs {
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
  const drop = new Set<string>();
  // Bug 160：动态计算键（Abs）——原生按**求值后的键**排除；键值不可判时
  // 无法排除 ⇒ rest 降 open（诚实过近似：键可能仍在 rest 里）。
  let keyUndecidable = false;
  for (const k of keys) {
    if (typeof k === "string") {
      drop.add(k);
      continue;
    }
    const kv = litValue(asAbsVal(k));
    if (kv.ok && (typeof kv.value === "string" || typeof kv.value === "number")) {
      drop.add(String(kv.value));
    } else if (kv.ok && typeof kv.value === "symbol") {
      // 符号键：内部槽键表示 "@@name"（与读写面同口径）
      const sk = slotKeyOfSymbolAbs(asAbsVal(k));
      if (sk !== undefined) drop.add(sk);
      else keyUndecidable = true;
    } else {
      keyUndecidable = true;
    }
  }
  const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
  let openRest = o.shape.open === true || keyUndecidable;
  // Bug 109：rest 只收枚举自有键（CopyDataProperties 同口径——
  // defineProperty 记的 enumerable:false 键 / internal 私有槽不进 rest；
  // enumOwnKeys 视图，obj 源 flag 侧表键控本 Abs 身份）
  //
  // Bug 226：rest 走**读路径**——原生 CopyDataProperties 对每个保留键发一次
  // Get（访问器被调用、副作用发生；rest 里落的是 getter 的**返回值**，不是
  // 占位槽 undefined）。此前按结构搬槽（直接取 slots[k]）跳过读路径 → 对象
  // 字面量 getter 从不被调用，副作用整体丢失（$spread / Object.assign 同族
  // 路径本就发 Get → 只有 rest 漏）。
  const acc = accessorTable.get(o as object);
  const enumKeys = new Set(enumOwnKeys(o, o.shape.slots));
  if (acc) {
    // 纯 getter（无同名数据槽）也要进 rest（{ get x(){…} } 的 rest 里有 x）
    for (const k of acc.keys()) {
      if (isEnumerableView(o, k)) enumKeys.add(k);
    }
  }
  for (const k of enumKeys) {
    if (drop.has(k)) continue;
    const g = acc?.get(k)?.get;
    if (g) {
      // getter 以接收者为 this 求值（原生 Get 的 receiver = 源对象）
      setSlot(slots, k, { value: asAbsVal(g(o)) });
      continue;
    }
    const slot = getSlot(o.shape.slots, k);
    if (slot) setSlot(slots, k, slot);
    // optional 源键可能仍以 undefined 出现在 rest 的动态面；闭槽无需 open
  }
  // 提取的 optional 键：JS rest 会排除该键，但 open 对象上未知键仍可能进 rest
  if (o.shape.open) openRest = true;
  const shape: Abs["shape"] = { k: "obj", slots };
  if (openRest) (shape as { open?: boolean }).open = true;
  return { shape, conf: o.conf === "exact" ? "exact" : confJoin(o.conf, "partial") };
}
