/**
 * 结构层：对象槽位、spread、函数重载并。
 * 纪律：积之和默认；optional 塌缩是显式损失；函数并保输入→输出相关性。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { absKey } from "./abs-key.ts";
import { abs, confJoin, litValue, unknown, never, strLit } from "./abs.ts";
import { noteDerivationJoin } from "./derivation.ts";
import { enumOwnKeys, setPropFlags, getPropFlags } from "./builtins/invariants.ts";
import { $objAccessor, lookupObjAccessor, migrateAccessors } from "./accessors.ts";
import { getFnImpl, isAbsApplyResult } from "./abs-fn.ts";
import { recordMayThrow, formatThrowsAbs } from "./may-throw.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { enterCall, exitCall, callBudgetKey, stableCallId, truncatedAbs } from "./call-budget.ts";
import { classInstanceInnerOf, getEvalClass } from "./exec/class-registry.ts";

/**
 * Bug 84：internal 标记私有槽（私有字段 "#x" 混淆键落实例内层 obj）。
 * 原生私有字段是内部槽，对所有属性 introspection（for-in / hasOwnProperty
 * / keys / gOPN / spread / assign / stringify）不可见；$get/$set 直连键
 * 访问与 $in 槽存在性查询不受影响（Bug 78 语义）。必须用槽标志而非
 * 名字前缀过滤——合法公共字符串键 {"#x":1} 与私有槽同键空间共存。
 */
export type Slot = {
  value: Abs;
  optional?: boolean;
  readonly?: boolean;
  internal?: boolean;
  /** Bug 66：原型链解析槽（errorBrandAbs 的 name——原生经 X.prototype.name
   * 可见，非实例自有）。$get 直读 / $in 存在性照常；自有面 introspection
   * （hasOwnProperty / propertyIsEnumerable / Object.hasOwn / gOPN）折
   * false；$set 公有覆写落地转自有（e.name = "X" 原生建自有可枚举属性）。 */
  inherited?: boolean;
  /** Bug 73：计算 symbol 键投影槽（[Symbol.X] → "@@X"，transpile 期
   * $set opts.symbolKey 打标）。原生 symbol 键对 JSON.stringify 等
   * 字符串键枚举面不可见；字面量字符串键 {"@@lit":1} 无标记、照常
   * 序列化——不得用 "@@" 前缀语法过滤（会误滤）。$get/$set/$in 直连
   * 键访问不受影响。 */
  symbolKey?: boolean;
};

/** ES 规范数组下标（无前导零、< 2^32-1）；非规范键返回 undefined */
export function canonicalArrayIndex(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 4294967295) {
    return v;
  }
  if (typeof v === "string" && /^(0|[1-9]\d*)$/.test(v)) {
    const n = Number(v);
    if (n < 4294967295) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 函数 expando 槽面所有权（$set fn 臂与 $copy 快照共用）
//
// fn Abs 的 slots 有两种来源：
// - 出生自带（env 的 dual-facet 静态面如 Number.isFinite）——就地突变会
//   跨 run 泄漏，写路径必须维持只读；
// - 求值期 expando（`g.x = 1`）——引用语义可写。
// 登记表放本模块（叶子侧）避免 containers/obj.ts ↔ containers/member.ts
// 互相 import 形成模块环（环会让 run.ts 的 transpile 绑定在求值期为
// undefined）。
// ---------------------------------------------------------------------------
const userFnSlotOwners = new WeakSet<object>();

/** 标记 fn Abs 的槽面归求值引擎所有（可写 expando）。 */
export function markUserFnSlots(a: Abs): void {
  userFnSlotOwners.add(a as object);
}

/** 该 fn Abs 的槽面是否可写（引擎自建 expando）。 */
export function isUserFnSlotOwner(a: Abs): boolean {
  return userFnSlotOwners.has(a as object);
}

/** $copy 快照迁移：源槽面可写 ⇒ 副本同样可写（副本独立、臂内写不丢失）。 */
export function migrateUserFnSlots(from: Abs, to: Abs): void {
  if (userFnSlotOwners.has(from as object)) userFnSlotOwners.add(to as object);
}

// ---------------------------------------------------------------------------
// Bug 381 / 383：用户转换钩子（ToPrimitive / ToPropertyKey / JSON toJSON）
// 的**调用面**（`$invoke` 基建）——单一事实源，381 与 383 共用。
//
// 修前：隐式强转路径只对钩子槽做**存在性判定**（isNullProtoWithoutCoercer
// / template.ts 的「钩子存在 → 不折默认标签」闸门）⇒ 钩子体**从不执行** ⇒
// 钩子体的副作用（计数器 / 捕获变量写）与它的 throw 域一并丢失 ⇒ 引擎把
// 「钩子体确定抛错」折成**确定不抛**（假阴性）。
//
// 修后：钩子体**真调用**——副作用与 throw 域随之而来（钩子体抛错 → NudoThrow
// 传播 → 用户 try/catch 可吸收 ⇒ 原生同款）。值面仍保守（抽象）：钩子返回值
// 不参与值域折叠（除非调用点显式取用），保持 sound。
// ---------------------------------------------------------------------------

/** 用户转换钩子名（@@toPrimitive 的 symbol 键按 Bug 82 投影为 "@@toPrimitive" 槽） */
export type CoercionHookName = "valueOf" | "toString" | "@@toPrimitive" | "toJSON";

/**
 * ToPrimitive 的 hint——决定 OrdinaryToPrimitive 的钩子顺序：
 * - "default" / "number"：valueOf 先、toString 后（`+` 运算符 / Number()）
 * - "string"：toString 先、valueOf 后（模板 / String() / ToPropertyKey）
 */
export type CoercionHint = "default" | "string" | "number";

/** 钩子调用面（拿到即可调用：副作用 + throw 域随之而来） */
export type CoercionHook = {
  /** 钩子名（诊断用） */
  name: CoercionHookName;
  /** 调用钩子体（this = 接收者；args = 钩子实参） */
  call: (args: Abs[]) => Abs;
};

/** 钩子槽探测深度上限（原型链兜底——防病态链） */
const HOOK_LOOKUP_MAX_DEPTH = 16;

/**
 * obj 接收者上的钩子槽探测（自有槽 → 原型链 protoTable）。
 * 返回 undefined = 该名上没有钩子槽。
 */
function hookSlotAbs(recv: Abs, name: string, depth: number): Abs | undefined {
  if (depth > HOOK_LOOKUP_MAX_DEPTH) return undefined;
  const s = recv.shape;
  if (s.k !== "obj") return undefined;
  const slots = s.slots;
  if (slots && Object.prototype.hasOwnProperty.call(slots, name)) {
    const v = slots[name]!.value;
    if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
    return undefined;
  }
  const proto = getProtoAbs(recv);
  if (proto && proto !== recv) return hookSlotAbs(proto, name, depth + 1);
  return undefined;
}

/** 钩子值是否为可调用 fn（对象字面量方法 / 方法型函数表达式 → $fnVal Abs） */
function isCallableHookAbs(v: Abs | undefined): boolean {
  return !!v && v.shape.k === "fn" && getFnImpl(v)?.apply !== undefined;
}

/**
 * 用户转换钩子的调用面探测（obj 自有槽 → 原型链 → 类实例内层 → 类原型方法）。
 * 返回 undefined = 接收者没有该钩子（走默认 ToPrimitive）。
 */
export function coercionHookOf(recv: Abs, name: CoercionHookName): CoercionHook | undefined {
  if (recv.shape.k === "obj") {
    const v = hookSlotAbs(recv, name, 0);
    if (v && isCallableHookAbs(v)) {
      return { name, call: (args) => callHookFn(v, args, recv, name) };
    }
    return undefined;
  }
  if (recv.shape.k === "brand") {
    // 类实例：内层闭 obj 的自有槽 → 类原型方法（spec.methods）
    const inner = classInstanceInnerOf(recv);
    if (inner) {
      const v = hookSlotAbs(inner, name, 0);
      if (v && isCallableHookAbs(v)) {
        return { name, call: (args) => callHookFn(v, args, recv, name) };
      }
    }
    const spec = getEvalClass(recv.shape.name);
    const m = spec?.methods?.[name];
    if (m) return { name, call: (args) => m(recv, ...args) };
  }
  return undefined;
}

/**
 * 钩子体调用（fn Abs → apply 派发）。
 * - bindThis（对象方法 / 类方法）：receiver 经首参注入（与 $call 同口径）
 * - throws 通道：apply 返回 AbsApplyResult 时按 $call 的 routeApplyThrows
 *   口径路由（always-throw → NudoThrow；may-throw → 记 may-throw）
 * - 调用预算：enterCall/exitCall（递归自调用按 cycle/depth 截断，不炸栈）
 */
function callHookFn(fnAbs: Abs, args: Abs[], thisVal: Abs, name: string): Abs {
  const impl = getFnImpl(fnAbs);
  if (!impl || !impl.apply) return unknown;
  let a = args;
  let t: Abs | undefined = thisVal;
  if (impl.bindThis) {
    a = [thisVal, ...args];
    t = undefined;
  }
  const key = callBudgetKey("coerce-hook", stableCallId(fnAbs as object), a);
  if (!enterCall(key, `coercion hook ${name}`)) return truncatedAbs();
  try {
    const r = impl.apply(a, t);
    if (isAbsApplyResult(r)) {
      if (r.throws.shape.k !== "never") {
        if (r.abs.shape.k === "never") throw new NudoThrow(r.throws);
        recordMayThrow({
          kind: formatThrowsAbs(r.throws) ?? "Error",
          cause: `user coercion hook ${name} may throw`,
        });
      }
      return r.abs;
    }
    return r;
  } finally {
    exitCall();
  }
}

/** 钩子返回值是否为原语（ToPrimitive 的「是原语」判定） */
function isPrimitiveResult(r: Abs): boolean {
  const t = r.term;
  if (t?.op === "lit") {
    const v = t.value;
    return v === null || v === undefined || (typeof v !== "object" && typeof v !== "function");
  }
  return r.shape.k === "prim";
}

/**
 * ToPrimitive 的**钩子调用面**（Bug 381）：按 hint 顺序调用用户的
 * @@toPrimitive / valueOf / toString 钩子。
 * - 返回 undefined = 没有用户钩子（走默认 ToPrimitive：Object.prototype 的
 *   valueOf/toString 恒 total 且无副作用 ⇒ 不调用）
 * - 返回值非原语（钩子返回对象）→ 继续试下一个钩子（原生同款）；全部非原语
 *   → undefined（调用方按「不可判」保守）
 */
export function invokeToPrimitiveHook(recv: Abs, hint: CoercionHint): Abs | undefined {
  // 原生 ToPrimitive 步骤 1：@@toPrimitive 优先（实参 = hint 字符串）
  const exotic = coercionHookOf(recv, "@@toPrimitive");
  if (exotic) {
    const r = exotic.call([strLit(hint)]);
    return isPrimitiveResult(r) ? r : undefined;
  }
  if (hint === "string") {
    // OrdinaryToPrimitive(string)：toString 先。**缺省** toString
    // （Object.prototype.toString）恒返回原语 ⇒ 原生**不再**回退 valueOf
    // （`String({valueOf(){n++}})` 原生不调 valueOf）。
    const h = coercionHookOf(recv, "toString");
    if (!h) return undefined;
    const r = h.call([]);
    if (isPrimitiveResult(r)) return r;
    // 用户 toString 返回非原语 → 原生回退 valueOf
    const hv = coercionHookOf(recv, "valueOf");
    if (!hv) return undefined;
    const rv = hv.call([]);
    return isPrimitiveResult(rv) ? rv : undefined;
  }
  // OrdinaryToPrimitive(number/default)：valueOf 先。缺省 valueOf 返回**对象**
  // （非原语）⇒ 继续试 toString（原生同款次序）。
  const hv = coercionHookOf(recv, "valueOf");
  if (hv) {
    const rv = hv.call([]);
    if (isPrimitiveResult(rv)) return rv;
  }
  const h = coercionHookOf(recv, "toString");
  if (!h) return undefined;
  const r = h.call([]);
  return isPrimitiveResult(r) ? r : undefined;
}

/**
 * 钩子调用（Bug 381 的 `$invoke` 面）：返回 undefined = 无该钩子。
 * 钩子体抛错 → NudoThrow 传播（调用点的 try/catch 可吸收 ⇒ 原生同款）。
 */
export function invokeCoercionHook(
  recv: Abs,
  name: CoercionHookName,
  args: Abs[] = [],
): Abs | undefined {
  const hook = coercionHookOf(recv, name);
  if (!hook) return undefined;
  return hook.call(args);
}

/**
 * 默认 Object.prototype.toString 标签（ToString 缺省面）：
 * "[object Object]"（@@toStringTag 覆写优先——与 template.ts 同口径）。
 * 仅闭 obj 走此面（open/index 形不可判 → undefined）。
 */
function defaultObjectTagOf(a: Abs): string | undefined {
  if (a.shape.k !== "obj") return undefined;
  const s = a.shape as { slots?: Record<string, Slot>; open?: boolean; index?: unknown };
  if (s.open || s.index) return undefined;
  const acc = lookupObjAccessor(a, "@@toStringTag");
  if (acc?.get) {
    const lr = litValue(acc.get(a));
    return lr.ok && typeof lr.value === "string" ? lr.value : undefined;
  }
  const slots = s.slots;
  if (slots && Object.prototype.hasOwnProperty.call(slots, "@@toStringTag")) {
    const lr = litValue(slots["@@toStringTag"]!.value);
    return lr.ok && typeof lr.value === "string" ? lr.value : undefined;
  }
  return "Object";
}

/**
 * ES ToPropertyKey 的折叠：null→"null"、undefined→"undefined"、
 * true/false→"true"/"false"、number/bigint/string → String(v)（ToString）。
 * 必须看 term——litValue 把 lit(undefined) 吞成哨兵 undefined。
 * 抽象 / symbol 返回 undefined（调用方保守处理）。
 *
 * Bug 383：**对象键**也走 ToPropertyKey（ToPrimitive(string) → ToString）——
 * 钩子**真调用**（与 Bug 381 的钩子调用面同口径：副作用与 throw 域随之而来）。
 * 修前只认字面量 term ⇒ 对象键落「抽象键」臂 ⇒ 写被静默丢弃、键的强制
 * 转换副作用全丢。
 */
export function propertyKeyOf(a: Abs | undefined): string | undefined {
  if (a === undefined) return undefined;
  // 非 Abs 实参（部分调用点传裸 JS 值——如 $del 的键）→ 不可判，保守返回
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return undefined;
  if (a.term?.op !== "lit") {
    // 对象键（obj / brand 接收者）→ ToPropertyKey；其余（抽象 var/app 等）
    // 不可判 → undefined（调用方按抽象键处理）
    if (a.shape.k !== "obj" && a.shape.k !== "brand") return undefined;
    // 抽象 term（var / app）不是具体对象 → 不得调钩子（不可判）
    if (a.term?.op === "var" || a.term?.op === "app") return undefined;
    // ToPrimitive(string) → ToString（钩子真调用）
    const prim = invokeToPrimitiveHook(a, "string");
    if (prim !== undefined) {
      const lv = litValue(prim);
      if (!lv.ok) return undefined;
      const v = lv.value;
      if (typeof v === "symbol") return undefined;
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      if (typeof v === "object" || typeof v === "function") return undefined;
      return String(v);
    }
    // 无用户钩子 → 默认 Object.prototype.toString（"[object Object]"）
    const tag = defaultObjectTagOf(a);
    if (tag === undefined) return undefined;
    return `[object ${tag}]`;
  }
  const v = a.term.value;
  if (typeof v === "symbol") return undefined;
  return String(v);
}

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
 * 自有槽位写入。必须走 defineProperty：`slots[k] =` 在 k==="__proto__" 时
 * 触发宿主 [[SetPrototypeOf]]，键静默丢失（与 getSlot 同族历史 bug）。
 */
export function setSlot<S extends { value: Abs }>(
  slots: Record<string, S>,
  key: string,
  slot: S,
): void {
  Object.defineProperty(slots, key, {
    value: slot,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * 原型侧表：setProtoAbs 记录对象原型 Abs（对象原型细节此前不建模——
 * 对象字面量方法 super 派发（Bug 19）需沿 home object 原型链查找）。
 * 键为 Abs 对象身份（与 accessorTable 同口径；不可变更新产生新 Abs 时
 * 不迁移——super 派发只发生在构造后直接调用的接收者上）。
 */
const protoTable = new WeakMap<object, Abs>();

/** 读取对象原型 Abs（未设定/非对象原型 → undefined） */
export function getProtoAbs(o: Abs): Abs | undefined {
  return protoTable.get(o);
}

/**
 * Bug 205：实例（brand 接收者）的真实 [[Prototype]] 记录。
 *
 * brand 实例此前**不记录** [[Prototype]]——原型被替换（`F.prototype = {}`）/
 * `setPrototypeOf` 之后，instanceof 只能按构造器**名**匹配（unsound 的肯定
 * 判断：类型守卫会走错分支）。本表按 Abs 对象身份记实例的原型对象：
 * - 构造期捕获（exec/class/declare.ts 的 `$new`）——换原型前造的实例记旧
 *   原型，换后造的新实例记新原型（原生 "false|true" 的区分依据）；
 * - `setPrototypeOf` 更新（下方 setProtoAbs）。
 *
 * 与 protoTable（obj 接收者）分表：protoTable 参与 super 派发 / 原型链写门，
 * 语义是「对象原型」；本表只服务 instanceof 的 [[Prototype]] 身份比较。
 */
const instanceProtoTable = new WeakMap<object, Abs>();

/** 读实例记录的 [[Prototype]]（未记录 → undefined） */
export function getInstanceProto(o: Abs): Abs | undefined {
  return instanceProtoTable.get(o as object);
}

/** 记实例的 [[Prototype]]（构造期捕获 / setPrototypeOf 更新） */
export function setInstanceProto(o: Abs, proto: Abs): void {
  instanceProtoTable.set(o as object, proto);
}

/**
 * 不可变原型对象（原生 ImmutablePrototypeExoticObject）：[[SetPrototypeOf]]
 * 拒绝**非 null** 原型（抛 TypeError / Reflect 返 false）；**置 null 放行**
 * （ES2024 10.4.1.2 的 Object.prototype.[[SetPrototypeOf]] 只在 V 非 null
 * 时抛——Object.prototype 的 [[Prototype]] 本就是 null ⇒ 空操作；node v26
 * 实测 `Object.setPrototypeOf(Object.prototype, null)` 不抛、
 * `Reflect.setPrototypeOf(Object.prototype, null)` 返 true）。
 *
 * 规范 + V8 实测（node）：**仅 `Object.prototype`** 是不可变原型——
 * `Object.setPrototypeOf(Object.prototype, {})` → TypeError: Immutable
 * prototype object 'Object.prototype' cannot have their prototype set；
 * 其余内建原型（Array/Function/String/… .prototype）**可**改。
 *
 * 判定按 brand 名（与 builtins/ctor.ts 的 isObjectProtoBrand 同口径——
 * Object.prototype 单例的 brand 名恒为 "Object.prototype"）。
 */
export function isImmutableProtoAbs(o: Abs): boolean {
  const s = o.shape;
  return s.k === "brand" && s.name === "Object.prototype";
}

/**
 * 原型链环检测（Bug 385）：沿**新原型**的 [[Prototype]] 链上溯，若已到达
 * `target` ⇒ 设定会建出活原型环 ⇒ 原生拒绝（`Object.setPrototypeOf` 抛
 * TypeError: Cyclic __proto__ value；`Reflect.setPrototypeOf` 返 false）。
 *
 * 走 protoTable（obj 接收者）+ instanceProtoTable（brand 接收者的
 * [[Prototype]]）——两者都是 setPrototypeOf / 构造期记的真实原型边。
 */
export function protoChainContains(proto: Abs, target: Abs): boolean {
  const seen = new Set<object>();
  let cur: Abs | undefined = proto;
  while (cur && !seen.has(cur as object)) {
    if (cur === target) return true;
    seen.add(cur as object);
    cur = getProtoAbs(cur) ?? getInstanceProto(cur);
  }
  return false;
}

/**
 * 对象字面量非计算 `__proto__: v` / `Object.setPrototypeOf(o, v)` / `o.__proto__ = v`
 * 的原型设定（保守建模）：
 * - v 为 null → null-proto（无 Object.prototype 回退）
 * - v 为 object → 保守 open（继承读不折 exact undefined；原型细节不建模）
 * - v 为 primitive → 原生忽略（对象字面量）；setter 路径由调用方决定是否 TypeError
 *
 * Bug 385 / 386：**不可变原型**（Object.prototype）与**原型环**在写入前拒绝
 * （原生 [[SetPrototypeOf]] 返 false / Object.setPrototypeOf 抛 TypeError）——
 * 引擎此前**静默接受**非法写入并建出 native 不存在的活原型环（后续所有原型
 * 链观察都跑在环上，产出与 native 不可比的值）。
 */
export function setProtoAbs(o: Abs, proto: Abs): Abs {
  const pvR = litValue(proto);
  const pv = pvR.ok ? pvR.value : undefined;
  if (pv === null) {
    // Bug 1077：不可变原型（Object.prototype）置 **null** ——原生允许且是空操作
    // （Object.prototype 的 [[Prototype]] 本就是 null；ES2024 10.4.1.2 的
    // Object.prototype.[[SetPrototypeOf]] 只在 V 非 null 时抛；node v26 实测
    // `Object.setPrototypeOf(Object.prototype, null)` 不抛）。**不落 null-proto
    // 标记**——那会把 Object.prototype 的原型链面改成「无 Object.prototype
    // 回落」（原生 "toString" in Object.prototype === true ⇒ 不可改）。
    if (isImmutableProtoAbs(o)) return o;
    return markNullProtoObj(o);
  }
  if (proto.term?.op === "lit" && (pv === undefined || typeof pv !== "object")) {
    return o;
  }
  // Bug 386：不可变原型对象——[[SetPrototypeOf]] 一律拒绝（不写、不改标记）
  if (isImmutableProtoAbs(o)) {
    recordMayThrow({
      kind: "TypeError",
      cause: "Object.setPrototypeOf on immutable prototype object (Object.prototype)",
    });
    return o;
  }
  // Bug 385：原型环——新原型链上溯已含 o ⇒ 拒绝建环
  if (protoChainContains(proto, o)) {
    recordMayThrow({ kind: "TypeError", cause: "Object.setPrototypeOf would create a prototype cycle" });
    return o;
  }
  if (isObj(o)) {
    (o.shape as { open?: boolean }).open = true;
    // 记录原型（对象原型）：super 派发 / 原型链查找用（Bug 19）
    protoTable.set(o, proto);
  } else if (o.shape.k === "brand") {
    // Bug 205：brand 接收者（类 / 函数实例）此前**完全不记**原型——
    // `Object.setPrototypeOf(f, {})` 之后引擎对原型链无知，instanceof 只能
    // 按构造器名匹配（unsound 的肯定判断）。此处记下真实 [[Prototype]]。
    setInstanceProto(o, proto);
  }
  return o;
}

/**
 * Bug 109：obj 源的枚举自有槽视图（enumOwnKeys 同口径——defineProperty
 * 记的 enumerable:false 自有键与 internal 私有槽剔除）。spread/rest 的
 * CopyDataProperties 面。主过滤在 $spread（getter 物化前，Abs 身份带
 * flag 侧表时）；此处兜底（副本 abs 无 flag 表 → enumOwnKeys 幂等全过）。
 */
function enumSlotsOf(over: Abs): Record<string, Slot> {
  if (over.shape.k !== "obj") return {};
  const slots = over.shape.slots;
  const ks = enumOwnKeys(over, slots);
  if (ks.length === Object.keys(slots).length) return slots;
  const out: Record<string, Slot> = {};
  for (const k of ks) out[k] = slots[k]!;
  return out;
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
    // 原生非对象源：{...'ab'} 按 code point 数字键展开、{...[1,2]} 按
    // 下标键展开（hole 跳过）、prim 字面量（number/bool/null/undefined/
    // bigint/symbol）忽略；抽象（未知长 arr/抽象字符串/brand 等）保守 open
    const t = over.term;
    if (t?.op === "lit") {
      const v = t.value;
      if (
        v === null ||
        v === undefined ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        typeof v === "bigint" ||
        typeof v === "symbol"
      ) {
        // 忽略源：base 原样（无 base 的裸 spread 由调用方保证 base 非空）
        if (!isObj(base)) return unknown;
        return { shape: { ...base.shape }, conf: confJoin(base.conf, over.conf) };
      }
    }
    const indexSlots = spreadIndexSlots(over);
    if (indexSlots && isObj(base)) {
      const slots: Record<string, Slot> = { ...base.shape.slots };
      for (const [k, s] of Object.entries(indexSlots)) setSlot(slots, k, s);
      const shape: ObjShape = { k: "obj", slots };
      if (base.shape.open) shape.open = true;
      return { shape, conf: confJoin(base.conf, over.conf) };
    }
    // 既有保守路径：over 不可判定 → open
    if (!isObj(base)) return unknown;
    return {
      shape: { ...base.shape, open: true },
      conf: confJoin(base.conf, "partial"),
    };
  }
  if (!isObj(base)) {
    // Bug 109：over 侧枚举视图（CopyDataProperties）——defineProperty 记的
    // enumerable:false 自有键与 internal 私有槽不拷贝
    const shape: ObjShape = { ...over.shape, slots: enumSlotsOf(over), open: true };
    return { shape, conf: confJoin(base.conf, over.conf) };
  }

  const slots: Record<string, Slot> = { ...base.shape.slots };
  for (const [k, s] of Object.entries(enumSlotsOf(over))) {
    setSlot(slots, k, s);
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

/** {...str} / {...arr} 的数字键投影：可确定 → 槽表；不可 → undefined */
function spreadIndexSlots(over: Abs): Record<string, Slot> | undefined {
  const s = over.shape;
  if (s.k === "tuple") {
    const slots: Record<string, Slot> = {};
    const holes = s.holes ?? [];
    s.elements.forEach((el, i) => {
      if (holes.includes(i)) return; // hole 不展开（原生跳过）
      slots[String(i)] = { value: el };
    });
    return slots;
  }
  const sv =
    over.term?.op === "lit" && typeof over.term.value === "string" ? over.term.value : undefined;
  if (sv !== undefined) {
    // String exotic own keys 是 UTF-16 code unit 下标（不是 for-of 的 code point）
    const slots: Record<string, Slot> = {};
    for (let i = 0; i < sv.length; i++) {
      slots[String(i)] = { value: strLit(sv[i]!) };
    }
    return slots;
  }
  return undefined;
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
  // 同一访问器定义（双臂相同闭包：别名 fork / migrateAccessors 迁移产物，
  // 如循环加宽的前后帧）→ 整组迁移到 join 产物，读写继续走侧表
  const sameDefs: Array<[string, { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs }]> = [];
  for (const k of ka) {
    const sa = a.shape.slots[k]!;
    const sb = b.shape.slots[k]!;
    const optional = sa.optional || sb.optional;
    const accA = lookupObjAccessor(a, k);
    const accB = lookupObjAccessor(b, k);
    let jv: Abs;
    if (accA && accB && accA.get === accB.get && accA.set === accB.set) {
      // 槽位保持占位口径（in/keys 只看键存在性；读域由侧表派发）
      jv = joinValues(sa.value, sb.value);
      sameDefs.push([k, accA]);
    } else {
      // 混合臂（一侧访问器、另一侧数据槽；或两臂不同访问器）：单一访问器
      // 不能代表另一臂——getter 读域按原臂接收者求值后并入数据槽（与
      // $spread 调 getter 拷结果同口径）；setter-only 原生读 undefined，
      // 占位槽即其读域。侧表不迁移：读写折数据槽 = 保守超近似。
      const va = accA?.get ? evalGetterDomain(accA.get, a) : sa.value;
      const vb = accB?.get ? evalGetterDomain(accB.get, b) : sb.value;
      jv = joinValues(va, vb);
    }
    conf = confJoin(conf, jv.conf);
    setSlot(slots, k, { value: jv, optional });
  }
  const joined: Abs = { shape: { k: "obj", slots }, conf };
  for (const [k, def] of sameDefs) $objAccessor(joined, k, def.get ?? null, def.set ?? null);
  return joined;
}

/** join 时求 getter 读域：与 $get 同口径、以原臂为接收者调用闭包。
 *  求值失败或求值中抛（含 NudoThrow）折 unknown——读域不可静态刻画时的
 *  sound 超近似（此前占位槽折 definite undefined 是假精确）。 */
function evalGetterDomain(get: (t: Abs) => Abs, recv: Abs): Abs {
  try {
    return get(recv);
  } catch {
    return unknown;
  }
}

/** 值级 join：同型双字面量保留为枚举 sum；其余 prim 同型收成 path */
export function joinValues(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;

  const vaR = litValue(a);
  const vbR = litValue(b);
  // Object.is：NaN 与自身相等（`NaN === NaN` 为 false，不能用 ===）。
  // tagged：.ok 才是字面量（含 lit(undefined)），禁止用 value!==undefined 哨兵。
  if (vaR.ok && vbR.ok && Object.is(vaR.value, vbR.value)) return a;

  if (
    a.shape.k === "prim" &&
    b.shape.k === "prim" &&
    a.shape.type === b.shape.type
  ) {
    // 双字面量：枚举 sum（1|2）；NaN 不可满足，不得进枚举 → 收成 path
    if (vaR.ok && vbR.ok) {
      const va = vaR.value;
      const vb = vbR.value;
      const nanA = typeof va === "number" && Number.isNaN(va);
      const nanB = typeof vb === "number" && Number.isNaN(vb);
      if (nanA || nanB) {
        return abs(a.shape, undefined, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
      }
      return makeSum(a, b);
    }
    // 同 prim 但带 pred 证据（min/max 界等）：收成 bare path 会丢界，
    // 条件返回 `return 0; return clamp(n)` 证不出后置。保留 sum 逐臂对账。
    const hasPred = (x: Abs): boolean => !!x.pred && x.pred.op !== "true";
    if (hasPred(a) || hasPred(b)) {
      return makeSum(a, b);
    }
    return abs(a.shape, undefined, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
  }

  return makeSum(a, b);
}

export function makeSum(a: Abs, b: Abs): Abs {
  const members = flattenSum([a, b]);
  // 构造器不变量：sum 不得空 members。双空（或 flatten 后为空）折 never
  //——下游分发 helper 对 members.map(...).reduce 无初值会抛宿主 TypeError。
  if (members.length === 0) return never;
  if (members.length === 1) return members[0]!;
  // 过长同 prim 字面量枚举收成 path，避免 sum 成员爆炸（循环 unroll / reduce）
  if (members.length > 16) {
    const first = members[0]!;
    const samePrimLit =
      first.shape.k === "prim" &&
      members.every(
        (m) =>
          m.shape.k === "prim" &&
          (m.shape as { type: string }).type === (first.shape as { type: string }).type &&
          // litValue 哨兵对 lit(undefined) 折成 undefined，须看 term
          m.term?.op === "lit",
      );
    if (samePrimLit) {
      return abs(first.shape, undefined, undefined, "path");
    }
  }
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
  // fn 额外带**实现身份**：同一 shape 的两个不同函数体是不同值
  // （`cond ? (() => 1) : (() => 2)` 调用结果不是 single exact）。
  // 注：absShapeKey 保持纯结构契约（env-loader 的「同一声明」去重依赖
  // 结构相等），实现身份只在 makeSum 去重面生效。
  const seen = new Set<string>();
  const deduped: Abs[] = [];
  for (const x of out) {
    const key = sumDedupeKey(x);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(x);
  }
  return deduped;
}

/** makeSum 去重键：结构键 + 递归的 fn 实现身份与 conf。
 *
 * absShapeKey 是**纯结构**键（env-loader 的「同一 env 声明」去重依赖它；
 * 不含函数体/conf）。makeSum 还必须区分「结构相同但值不同」的情形：
 * - 嵌套 fn（obj 槽 / tuple 元素 / paramTypes / returnType / slots /
 *   brand·eff 内层 / sum 成员）的函数体身份逐层进键——否则
 *   `if (cond) { g.x = () => 1 } else { g.x = () => 2 }` 会被去重成一个；
 * - 每个 Abs 节点的 conf 进键（同结构不同置信度不是同一值）。
 */
function sumDedupeKey(a: Abs): string {
  return `${absShapeKey(a)}${identitySuffix(a)}`;
}

/** per-process fn impl id（同 impl = 同一函数值；$copy 副本共享 impl）。 */
function fnImplIdOf(impl: object): number {
  let id = fnImplIds.get(impl);
  if (id === undefined) {
    id = ++fnImplIdSeq;
    fnImplIds.set(impl, id);
  }
  return id;
}

/** 递归收集每个节点的 conf + fn 实现身份（sumDedupeKey 的附加面）。 */
function identitySuffix(a: Abs, seen: Set<object> = new Set()): string {
  if (seen.has(a)) return "";
  seen.add(a);
  try {
    let out = `|c:${a.conf}`;
    const s = a.shape;
    switch (s.k) {
      case "arr":
        out += identitySuffix(s.element, seen);
        break;
      case "tuple": {
        out += `|t:${s.elements.map((e) => identitySuffix(e, seen)).join(",")}`;
        if (s.rest) out += `|tr:${identitySuffix(s.rest, seen)}`;
        break;
      }
      case "fn": {
        const impl = getFnImpl(a);
        out += impl ? `|impl#${fnImplIdOf(impl as object)}` : "|impl:none";
        if (s.paramTypes) {
          out += `|p:${s.paramTypes.map((t) => identitySuffix(t, seen)).join(",")}`;
        }
        if (s.returnType) out += `|r:${identitySuffix(s.returnType, seen)}`;
        if (s.slots) {
          for (const k of Object.keys(s.slots).sort()) {
            out += `|s:${k}${identitySuffix(s.slots[k]!.value, seen)}`;
          }
        }
        break;
      }
      case "obj": {
        for (const k of Object.keys(s.slots).sort()) {
          out += `|o:${k}${identitySuffix(s.slots[k]!.value, seen)}`;
        }
        if (s.index) {
          out += `|ik:${identitySuffix(s.index.key, seen)}|iv:${identitySuffix(s.index.value, seen)}`;
        }
        break;
      }
      case "brand":
        out += identitySuffix(s.shape, seen);
        break;
      case "eff": {
        out += identitySuffix(s.inner, seen);
        if (s.rejected) out += `|rj:${identitySuffix(s.rejected, seen)}`;
        out += s.unsettled ? "|uns" : "";
        break;
      }
      case "sum":
        out += `|m:${s.members.map((m) => identitySuffix(m, seen)).join(",")}`;
        break;
      default:
        break;
    }
    return out;
  } finally {
    seen.delete(a);
  }
}

/** 稳定 per-process 函数实现身份（去重键用）：同一 impl 对象 = 同一函数值。
 *  `$copy` fork 快照共享 impl ⇒ 副本同键（可安全去重）；不同函数体
 *  （含匿名箭头）各有 impl ⇒ 不同键（不得因同名同形塌缩）。 */
const fnImplIds = new WeakMap<object, number>();
let fnImplIdSeq = 0;

/**
 * 结构键的最小面（join 去重 / 槽相等 / env 声明去重共用）。
 * 实现见 abs-key.ts（shape × term × pred 的单一序列化）；本函数保持
 * **纯结构**契约——fn 实现身份不进键（env-loader 的「同一声明」去重依赖
 * 结构相等）。makeSum/flattenSum 的去重键另有 sumDedupeKey 附加 impl 身份。
 */
export function absShapeKey(a: Abs, seen: Set<object> = new Set()): string {
  return absKey(a, seen);
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
 * 同签名函数 join 的**可观察元数据**是否相同（相同才允许折叠成 `a`）。
 *
 * 为什么不能只看 name+params：函数对象是**可扩展对象**——expando 槽
 * （`g.x = 1`）与 paramTypes/returnType/optionalParams/ctor 都影响后续
 * 读取/调用/构造。任一处不同 ⇒ 两侧是不同值，折叠成 `a` 是假精确
 * （`if (cond) { g.x = 1 } else { g.x = 2 }` 折成 `2 #exact`）。
 * 不同时由 joinFunctions 返 makeSum（成员各自保留 impl/槽面，读/调用
 * 逐成员派发后 join）。
 */
function sameFnObservables(
  a: Extract<Shape, { k: "fn" }>,
  b: Extract<Shape, { k: "fn" }>,
): boolean {
  if (a.ctor !== b.ctor) return false;
  const ao = a.optionalParams;
  const bo = b.optionalParams;
  const arity = Math.max(ao?.length ?? 0, bo?.length ?? 0);
  for (let i = 0; i < arity; i++) {
    if ((ao?.[i] === true) !== (bo?.[i] === true)) return false;
  }
  if (!sameAbsList(a.paramTypes, b.paramTypes)) return false;
  if (!sameOptionalAbs(a.returnType, b.returnType)) return false;
  return sameFnSlots(a.slots, b.slots);
}

/** 值相等（同引用或结构键 + conf 一致——不拿不可判当相同）。
 *  函数值额外比对 impl 身份：两个匿名箭头 shape 完全相同但函数体不同
 *  （`g.h = () => 1` vs `() => 2`）时，结构键无法区分 ⇒ 必须视为不同值。 */
function sameOptionalAbs(a: Abs | undefined, b: Abs | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aFn = a.shape.k === "fn";
  const bFn = b.shape.k === "fn";
  if (aFn || bFn) {
    if (!aFn || !bFn) return false;
    if (getFnImpl(a) !== getFnImpl(b)) return false;
  }
  return a.conf === b.conf && absShapeKey(a) === absShapeKey(b);
}

function sameAbsList(a: Abs[] | undefined, b: Abs[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameOptionalAbs(a[i], b[i])) return false;
  }
  return true;
}

function sameFnSlots(
  a: Extract<Shape, { k: "fn" }>["slots"],
  b: Extract<Shape, { k: "fn" }>["slots"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    const sa = getSlot(a, k);
    const sb = getSlot(b, k);
    if (!sa || !sb) return false;
    if ((sa.optional === true) !== (sb.optional === true)) return false;
    if ((sa.readonly === true) !== (sb.readonly === true)) return false;
    if (!sameOptionalAbs(sa.value, sb.value)) return false;
  }
  return true;
}

/**
 * 函数 join：签名并（重载），禁止 (A|C)→(B|D)。
 * 同名同参且**可观察元数据全同** → 同一值（折叠成 a）；否则 sum。
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
      // 函数实现身份同样必须相同：同名同参不同函数体（不同 impl）不是同一值
      return getFnImpl(a) === getFnImpl(b) && sameFnObservables(sa, sb)
        ? a
        : makeSum(a, b);
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
 * 同形 obj/tuple：用 slot/元素差集生成 note（P1：对象域可解释性）。
 */
function annotateJoinPath(a: Abs, b: Abs, result: Abs): Abs {
  if (result === a || result === b) return result;
  const sa = shapeBrief(a);
  const sb = shapeBrief(b);
  if (sa === sb) {
    // 同形：无 slot/长度差则不注（避免 `[2]|[2]` 噪声）；有差则写进 note
    const extra = sameShapeJoinNote(a, b);
    if (!extra) return result;
    const note = `join(${sa}: ${extra})`;
    if (result.pathNote === note) return result;
    return { ...result, pathNote: note };
  }
  const note = `join(${sa} | ${sb})`;
  if (result.pathNote === note) return result;
  return { ...result, pathNote: note };
}

function sameShapeJoinNote(a: Abs, b: Abs): string | undefined {
  if (a.shape.k === "obj" && b.shape.k === "obj") {
    const ak = Object.keys((a.shape as { slots: Record<string, unknown> }).slots ?? {});
    const bk = Object.keys((b.shape as { slots: Record<string, unknown> }).slots ?? {});
    const onlyA = ak.filter((k) => !bk.includes(k));
    const onlyB = bk.filter((k) => !ak.includes(k));
    if (onlyA.length === 0 && onlyB.length === 0) return undefined;
    const parts: string[] = [];
    if (onlyA.length > 0) parts.push(`+${onlyA.join(",")}`);
    if (onlyB.length > 0) parts.push(`+${onlyB.join(",")}`);
    return parts.join(" ");
  }
  if (a.shape.k === "tuple" && b.shape.k === "tuple") {
    const la = (a.shape as { elements: unknown[] }).elements.length;
    const lb = (b.shape as { elements: unknown[] }).elements.length;
    if (la === lb) return undefined;
    return `len ${la}|${lb}`;
  }
  if (a.shape.k === "brand" && b.shape.k === "brand") {
    const an = (a.shape as { name: string }).name;
    const bn = (b.shape as { name: string }).name;
    if (an !== bn) return `brand ${an}|${bn}`;
    // 同 brand（Map/Set/Error…）：下钻内层 Abs 差集
    const ai = (a.shape as { shape: Abs }).shape;
    const bi = (b.shape as { shape: Abs }).shape;
    return sameShapeJoinNote(ai, bi);
  }
  if (a.shape.k === "sum" && b.shape.k === "sum") {
    const am = (a.shape as { members: Abs[] }).members
      .map((m) => shapeBrief(m))
      .sort()
      .join(",");
    const bm = (b.shape as { members: Abs[] }).members
      .map((m) => shapeBrief(m))
      .sort()
      .join(",");
    if (am === bm) return undefined;
    return `sum ${am}|${bm}`;
  }
  return undefined;
}

/** 通用 join：分派到对象/函数/值 */
export function joinAbs(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;
  if (isObj(a) && isObj(b)) {
    const joined = joinObjects(a, b);
    const out = annotateJoinPath(a, b, joined);
    // annotateJoinPath 可能 {...result} 再包一层新身份；侧表按对象身份键控，
    // joinObjects 注册的访问器须随迁（同 $set/$del 的迁移先例）
    if (out !== joined) migrateAccessors(joined, out);
    return out;
  }
  if (a.shape.k === "fn" && b.shape.k === "fn") {
    return annotateJoinPath(a, b, joinFunctions(a, b));
  }
  const result = joinValues(a, b);
  // 推导图打点：任一侧有标签时结果挂 join 边（工件聚合；check 分轨不依赖）
  noteDerivationJoin([a, b], result);
  return annotateJoinPath(a, b, result);
}

// --- Object.create(null) 无原型标记 ---

/** null-proto 对象侧表（按 Abs 对象身份）：`in` 不得回退 Object.prototype */
const nullProtoMarks = new WeakMap<object, true>();

export function markNullProtoObj(o: Abs): Abs {
  nullProtoMarks.set(o as object, true);
  return o;
}

export function isNullProtoObj(o: Abs): boolean {
  return nullProtoMarks.has(o as object);
}

/**
 * ToPrimitive 前置闸门（Bug 381）：**null-proto 无 coercer 判定** +
 * **用户转换钩子真调用**。
 *
 * 修前本函数只探**存在性**（钩子槽在不在）⇒ 钩子体从不执行 ⇒ 钩子的副作用
 * 与 throw 域一并丢失（Bug 381：`valueOfCounter() => 0`；钩子体确定抛错被
 * 折成确定 `no-throw`）。修后按 hint 的 OrdinaryToPrimitive 口径**调用一次**
 * 钩子：副作用发生；钩子体抛错 → NudoThrow 传播（用户 try/catch 可吸收 ⇒
 * 原生同款）。
 *
 * 调用点（hint 随运算面走，BUG-058）：
 * - arithmetic/addsub.ts 的 `+` 臂（default hint；两个操作数各一次 ⇒
 *   `o + o` 调两次，与原生一致）
 * - builtins/global.ts 的 String() 面（**string hint**：toString 先，无自有
 *   toString ⇒ 不回退 valueOf——原生 `String({valueOf(){n++}})` 不调 valueOf）
 * - methods.ts 的 String.prototype.concat（ToString 面，应为 **string hint**；
 *   当前仍传默认值，见 BUG-058 报告）
 * - template.ts 的 concatString 走**纯判定**版（同一次强转只调一次钩子）
 */
export function isNullProtoWithoutCoercer(
  a: Abs,
  hint: CoercionHint = "default",
): boolean {
  if (a.shape.k === "obj" && isNullProtoObj(a) && isNullProtoWithoutCoercerSlot(a)) {
    // null-proto 且**无**自有 coercer → ToPrimitive 无路可走 ⇒ 定抛
    // TypeError（原生同款）
    return true;
  }
  // 非 null-proto（null-proto 但**有** coercer / 普通对象 / brand）：按
  // ToPrimitive(hint) 调一次用户钩子（副作用 + throw 域）。
  //
  // BUG-058：hint 不得写死——`String(x)` / 模板插值 走 **string hint**
  // （toString 先；缺自有 toString ⇒ Object.prototype.toString 恒返回原语
  // ⇒ **不回退 valueOf**），只有 `+` 运算符 / Number() 走 default/number。
  // string hint 由 {@link invokeToPrimitiveHook} 的 string 分支落实：无自有
  // toString 钩子时 `return undefined`（绝不回退 valueOf）。
  invokeToPrimitiveHook(a, hint);
  return false;
}

/**
 * 闭 null-proto 对象且无自有 ToPrimitive coercer（toString / valueOf /
 *  @@toPrimitive 槽——symbol 键写按 "@@X" 投影落地，Bug 73）→ ToPrimitive
 * 无 coercer 可走，原生定抛 TypeError（"Cannot convert object to primitive
 * value"）。open / index 形未知成员可能含 coercer，不得判缺（返回 false 落
 * 上层 may）。Bug 24（global.ts String()）同源；供 arithmetic/template 的
 * `+` 拼接臂复用。
 *
 * **纯判定**（不调用任何钩子）——Bug 381：钩子调用面与本判定拆开，
 * `concatString` 等「已在别处做过 ToPrimitive」的调用点用本函数（避免同一
 * 次强转重复调用钩子：原生每次 ToPrimitive 只调一次钩子）。
 */
export function isNullProtoWithoutCoercerSlot(a: Abs): boolean {
  if (a.shape.k !== "obj" || !isNullProtoObj(a)) return false;
  const so = a.shape as { open?: boolean; index?: unknown; slots?: Record<string, unknown> };
  if (so.open || so.index) return false;
  if (!so.slots) return true;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(so.slots, k);
  return !has("toString") && !has("valueOf") && !has("@@toPrimitive");
}

/** 同一对象的不可变更新（$set/$del）迁移 nullProto 标记 */
export function migrateNullProto(from: Abs, to: Abs): Abs {
  if (nullProtoMarks.has(from as object)) nullProtoMarks.set(to as object, true);
  return to;
}

// ---------------------------------------------------------------------------
// Bug 383：**自有键集不完备**标记（抽象键写的诚实面）
//
// 修前：计算键不可判（对象键 / 抽象键）时，写被**静默丢弃**，接收者只被
// 标 `open`——而 `Object.keys` / `Object.values` / `Object.entries` 仍折
// **exact 空元组**（自信的确切错值：native `Object.keys(o)` = ["[object
// Object]"] vs 引擎 []）。
//
// 修后：抽象键写同时打上「键集不完备」标记（Bug 326 的同一标记位——键家族
// 据此折 partial，不得折 exact 空元组）。标记位与判定**单一事实源**放在
// 本模块（objects.ts 是叶子）：builtins/object/methods.ts 的键家族面与
// exec/runtime/containers/arr-index.ts 的写面共用。
// ---------------------------------------------------------------------------

/** 「自有键集不完备」标记位（prop flags 侧表键——不进槽表，对枚举面零副作用） */
const KEY_SET_OPEN_MARK = "@@nudoKeySetOpen";

/** 标记「自有键集不完备」（键家族据此折 partial，不得折 exact 空元组） */
export function markKeySetOpenAbs(o: Abs): Abs {
  setPropFlags(o, KEY_SET_OPEN_MARK, {
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return o;
}

/** 该对象的自有键集是否不完备（⇒ 键家族折 partial） */
export function keySetIncompleteAbs(o: Abs): boolean {
  return getPropFlags(o)?.has(KEY_SET_OPEN_MARK) === true;
}
