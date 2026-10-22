/**
 * Reflect.* 静态（Bug 19）：宿主命名空间方法分派。
 *
 * 原生各方法首步对 target 做**严格 IsObject**（任何 prim——含抽象 refined
 * prim 与 nullish 字面量——一律 TypeError，不经 Object.* 的 ToObject 装箱
 * 宽容；node v26 实测 Reflect.get(1,'a') / Reflect.get('s','a') /
 * Reflect.get(null,'a') 全抛）。setPrototypeOf 另校验 proto（Object or
 * null）；apply/construct 校验 target 可调用/可构造 + argsList 为对象
 * （CreateListFromArrayLike called on non-object）。
 *
 * 三档口径与全仓约定一致：定抛 → NudoThrow；any/unknown/含坏臂 union →
 * recordMayThrow（值域不变）；对象形态走保守投影。
 *
 * Invariants（族 05 分片 B）：
 * - **反射口径**：Reflect.* 的写面失败一律返 **false 不抛**（[[Set]] /
 *   [[DefineOwnProperty]] / [[Delete]] 的规范返回面）——与 Object.* 面的
 *   定抛口径分面（Bug 302：Reflect.defineProperty 复用 Object 面 ⇒ 陷阱返
 *   false 时定抛；Proxy 陷阱按 ToBoolean(结果) 返 boolean）。
 * - **receiver 语义**（Bug 299）：Reflect.set 的第 4 实参参与 [[Set]]——
 *   靶自有数据属性 ⇒ receiver 建自有数据属性（靶不变）；靶自有访问器 ⇒
 *   派发 setter（this = receiver）；receiver 自有访问器 ⇒ 写门失败返 false。
 * - **访问器侧表**（Bug 306）：Reflect.get ≡ [[Get]] ⇒ 先查 accessorTable
 *   （对象字面量 getter 真身住侧表，槽里只有占位）——此前只读槽占位 ⇒
 *   getter 折 exact undefined 且从不执行。
 * - **Proxy 陷阱派发**（Bug 300/302）：getOwnPropertyDescriptor / defineProperty
 *   / set 三个陷阱名进 proxyTrapOf 的名字联合（exec/match-iter.ts）——此前
 *   getOwnPropertyDescriptor **从不派发**；Reflect 面自派发（Reflect 口径
 *   ToBoolean + 不抛），Object 面需在 object/methods.ts 接线（越界诉求）。
 * - **数组 length 写**（Bug 320）：Reflect.set(arr, "length", v) 走
 *   [[Set]] → ArraySetLength（截断/延长），此前静默丢弃写入。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, strLit, boolLit, unknown } from "../abs.ts";
import { joinAbs, setProtoAbs, canonicalArrayIndex, getSlot, propertyKeyOf } from "../objects.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isNullishLitAbs } from "../surface.ts";
import { boolPrim } from "./shared.ts";
import { evalObjectMethod } from "./object.ts";
import { markExtState, extStateOf, getPropFlags, migrateInvariants } from "./invariants.ts";
import { protoChangeAllowed } from "./object/methods.ts";
import {
  proxyOwnKeysTrapKeys,
  proxyTargetOwnStringKeys,
  enforceProxyDeleteInvariant,
  applyPropertyDescriptorVerdict,
  completePropDescAbs,
  validateDescriptorObject,
  wellKnownSymbolSlotKey,
} from "./object/descriptor.ts";
import { $del, proxyBooleanTrap, proxyGetProtoTrap } from "../exec/runtime/members.ts";
import { protoChainSetVerdict } from "../exec/runtime/proto-set.ts";
import { lookupObjAccessor, migrateAccessors } from "../accessors.ts";
import { $set, $idxSet, $get } from "../exec/runtime/containers.ts";
import { writeInPlace, undef, callAtFunctionBoundary, enforceProxyGetInvariant, litTruth } from "../exec/runtime/state.ts";
import { $call } from "../exec/call.ts";
import { proxyPartsOf, proxyTrapOf } from "../exec/match-iter.ts";
import { slotKeyOfSymbolAbs, symbolAbsForSlotKey } from "../exec/runtime/symbol-key.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { getFnImpl } from "../abs-fn.ts";

/** target 三档：object（确定对象）/ prim（确定非对象）/ may（可能是 prim） */
type TargetClass = { k: "object" } | { k: "prim" } | { k: "may" };

function classifyReflectTarget(a: Abs | undefined): TargetClass {
  // 缺省 ≡ undefined（Reflect.get() 原生 "Reflect.get called on non-object"）
  if (!a) return { k: "prim" };
  // nullish 字面量（shape k:"unknown" + lit term，引擎的 null/undefined 表示）
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
    return { k: "prim" };
  }
  const s = a.shape;
  // 任何 prim 形态（含 symbol prim / 抽象 refined prim）都不是对象 → 定抛
  if (s.k === "prim") return { k: "prim" };
  if (s.k === "any" || s.k === "unknown") return { k: "may" };
  if (s.k === "sum") {
    const bad = (s as { members: Abs[] }).members.some((m) => classifyReflectTarget(m).k !== "object");
    return bad ? { k: "may" } : { k: "object" };
  }
  return { k: "object" }; // obj/tuple/arr/fn/brand/eff：确定对象
}

/** 严格 IsObject 校验落地：prim → NudoThrow；may → recordMayThrow */
function enforceReflectTarget(a: Abs | undefined, what: string): void {
  const c = classifyReflectTarget(a);
  if (c.k === "prim") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "TypeError", cause: `Reflect.${what} called on non-object` });
  }
}

/** apply/construct 的 argsList（CreateListFromArrayLike）：非对象 → 定抛 */
function enforceArgsList(a: Abs | undefined, what: string): void {
  enforceReflectTarget(a, what);
}

/** 闭 obj 槽命中读取（miss → unknown：原型链可能有值，不折假 undefined） */
function closedObjSlotHit(target: Abs, keyAbs: Abs | undefined): Abs | undefined {
  if (target.shape.k !== "obj") return undefined;
  const os = target.shape as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
  if (os.open || os.index) return undefined;
  const kvR = keyAbs ? litValue(keyAbs) : undefined;
  const kv = kvR?.ok ? kvR.value : undefined;
  // symbol 键不在 Abs 槽域（ToPropertyKey 对 symbol 不 ToString、不抛）
  if (typeof kv !== "string" && typeof kv !== "number") return undefined;
  const slot = os.slots[String(kv)];
  return slot ? slot.value : unknown;
}

/** 键 → 字符串槽键（number → 十进制串；symbol → 不可投影 → undefined） */
function reflectSlotKey(keyAbs: Abs | undefined): string | undefined {
  const kvR = keyAbs ? litValue(keyAbs) : undefined;
  const kv = kvR?.ok ? kvR.value : undefined;
  if (typeof kv === "string" || typeof kv === "number") return String(kv);
  return undefined;
}

/**
 * Bug 306：Reflect.get ≡ [[Get]]——**访问器侧表优先**（对象字面量 getter 的
 * 真身住侧表，槽里只有 transpile 落的 `$lit(void 0)` 占位）。此前只读槽 ⇒
 * getter 折 exact undefined（getter **从不执行**）；原生 Reflect.get 走
 * [[Get]] ⇒ 调 getter（this = receiver，第 3 实参；缺省 ≡ target）。
 * 仅 setter 的键读值恒 undefined（原生同款）。
 */
function reflectAccessorGet(
  target: Abs,
  keyAbs: Abs | undefined,
  receiver: Abs,
): Abs | undefined {
  const key = reflectSlotKey(keyAbs);
  if (key === undefined) return undefined;
  const holder = target.shape.k === "brand" ? target.shape.shape : target;
  const acc = lookupObjAccessor(holder, key);
  if (!acc) return undefined;
  return acc.get ? acc.get(receiver) : undef();
}

/** ToBoolean（Proxy 陷阱结果 / 反射面的 boolean 化）：字面量按真值；
 *  对象形恒真；不可判 → undefined（调用方落保守 boolean） */
function reflectTruth(a: Abs): boolean | undefined {
  return litTruth(a);
}

/** 自有槽容器（obj 自身 / brand 的内层 obj）；无 → undefined */
function ownHolderOf(o: Abs): Abs | undefined {
  const holder = o.shape.k === "brand" ? o.shape.shape : o;
  return holder.shape.k === "obj" ? holder : undefined;
}

/**
 * Bug 299/320：Reflect.set ≡ [[Set]]（ES2024 13.15.2
 * OrdinarySetWithOwnDescriptor）——**第 4 实参 receiver** 参与写语义：
 * - 靶有自有**数据**属性（可写）：receiver 无自有该键 → receiver **建自有
 *   数据属性**（靶不变）；receiver 自有该键是**访问器** → false；receiver
 *   自有不可写数据属性 → false。
 * - 靶有自有**访问器**属性：派发 setter（this = receiver）；无 setter → false。
 * - 靶无自有该键：沿原型链上溯（首个持键原型决定写语义），链上无人持键 →
 *   receiver 建自有数据属性。
 * 失败一律返 **false**（Reflect 口径），**不抛**（strict 赋值才抛）。
 */
function reflectSetOnTarget(
  target: Abs,
  key: string,
  value: Abs,
  receiver: Abs,
): Abs {
  const tHolder = ownHolderOf(target);
  const tSlots = tHolder
    ? (tHolder.shape as { slots: Record<string, { value: Abs }> }).slots
    : undefined;
  const tAcc = tHolder ? lookupObjAccessor(tHolder, key) : undefined;
  const tHasOwn = tSlots ? Object.prototype.hasOwnProperty.call(tSlots, key) : false;
  const tFlags =
    getPropFlags(target)?.get(key) ??
    (tHolder && tHolder !== target ? getPropFlags(tHolder)?.get(key) : undefined);
  const tFrozen =
    extStateOf(target) === "frozen" || (tHolder ? extStateOf(tHolder) === "frozen" : false);

  // 数组 length：ArraySetLength（$set 的 length 臂）——receiver ≡ 靶时
  // 截断/延长（原生 Reflect.set(arr,"length",v) 改的是数组本身）。
  if (target.shape.k === "tuple" && key === "length") {
    if (receiver === target) {
      writeInPlace(target, $set(target, "length", value));
      return boolLit(true);
    }
    return reflectCreateDataOnReceiver(receiver, key, value);
  }
  // 靶无自有该键：沿原型链上溯（首个持键原型决定写语义）
  if (!tHasOwn) {
    const verdict = protoChainSetVerdict(target, key);
    if (verdict.kind === "deny") return boolLit(false);
    if (verdict.kind === "setter") {
      verdict.setter(receiver, value);
      return boolLit(true);
    }
    return reflectCreateDataOnReceiver(receiver, key, value);
  }
  // 靶有自有访问器属性：派发 setter（this = receiver）；无 setter → false
  if (tAcc) {
    if (!tAcc.set) return boolLit(false);
    tAcc.set(receiver, value);
    return boolLit(true);
  }
  // 靶有自有数据属性：不可写 → false
  if (tFrozen || tFlags?.writable === false) return boolLit(false);
  if (receiver === target) {
    writeInPlace(target, $set(target, key, value));
    return boolLit(true);
  }
  // receiver 的自有描述符（receiver ≠ 靶）
  const rHolder = ownHolderOf(receiver);
  const rSlots = rHolder
    ? (rHolder.shape as { slots: Record<string, { value: Abs }> }).slots
    : undefined;
  const rHasOwn = rSlots ? Object.prototype.hasOwnProperty.call(rSlots, key) : false;
  if (rHasOwn) {
    const rAcc = lookupObjAccessor(rHolder!, key);
    // receiver 自有访问器 → false（原生：不得改写 accessor 机制）
    if (rAcc) return boolLit(false);
    const rFlags =
      getPropFlags(receiver)?.get(key) ??
      (rHolder && rHolder !== receiver ? getPropFlags(rHolder)?.get(key) : undefined);
    if (extStateOf(receiver) === "frozen" || rFlags?.writable === false) {
      return boolLit(false);
    }
    writeInPlace(receiver, $set(receiver, key, value));
    return boolLit(true);
  }
  return reflectCreateDataOnReceiver(receiver, key, value);
}

/** CreateDataProperty(receiver, key, value)：receiver 不可扩展 → false；
 *  已有自有属性且不可配置 → false；否则写自有数据属性。 */
function reflectCreateDataOnReceiver(receiver: Abs, key: string, value: Abs): Abs {
  const rHolder = ownHolderOf(receiver);
  const rSlots = rHolder
    ? (rHolder.shape as { slots: Record<string, { value: Abs }> }).slots
    : undefined;
  if (rSlots) {
    const has = Object.prototype.hasOwnProperty.call(rSlots, key);
    const rAcc = lookupObjAccessor(rHolder!, key);
    // receiver 自有**访问器**属性 → 写门失败（原生：不得改写访问机制）
    if (rAcc) return boolLit(false);
    const st = extStateOf(receiver);
    // 不可扩展 receiver 不能建新键（原生 CreateDataProperty 失败 → false）
    if (!has && (st === "frozen" || st === "sealed" || st === "nonext")) {
      return boolLit(false);
    }
    if (has) {
      const rFlags = getPropFlags(receiver)?.get(key);
      if (rFlags?.configurable === false) return boolLit(false);
    }
    writeInPlace(receiver, $set(receiver, key, value));
    return boolLit(true);
  }
  // 数组形 receiver：下标键可写（length 等特殊键不在此路径）
  if ((receiver.shape.k === "tuple" || receiver.shape.k === "arr") && canonicalArrayIndex(key) !== undefined) {
    writeInPlace(receiver, $idxSet(receiver, strLit(key), value));
    return boolLit(true);
  }
  // 无槽模型且不可判 → 保守 boolean（不假绿也不假抛）
  return boolPrim();
}

/**
 * Bug 302：Reflect.defineProperty ≡ [[DefineOwnProperty]]——返回 **boolean**
 * （原生：重定义失败返 false **不抛**；仅「描述符非法」定抛 TypeError）。
 * 共享安装机器（builtins/object/descriptor.ts 的
 * applyPropertyDescriptorVerdict）——Object 面走同一台机器的抛错包装。
 */
function reflectDefinePropertyOnTarget(
  target: Abs,
  keyAbs: Abs,
  descAbs: Abs,
): Abs {
  const kStr = propertyKeyOf(keyAbs);
  if (kStr !== undefined) {
    return reflectApplyVerdict(target, kStr, descAbs);
  }
  if (isSymbolAbs(keyAbs)) {
    const sk = wellKnownSymbolSlotKey(keyAbs);
    if (sk !== undefined) {
      return reflectApplyVerdict(target, sk, descAbs, { symbolKey: true });
    }
    return boolPrim(); // 不可投影的 symbol 键 → 保守 boolean
  }
  return boolPrim(); // 抽象键 → 保守 boolean
}

/** Reflect 口径的描述符安装：成功 → true（就地写回）；失败 → false */
function reflectApplyVerdict(
  target: Abs,
  key: string,
  descAbs: Abs,
  opts?: { symbolKey?: boolean },
): Abs {
  const r = applyPropertyDescriptorVerdict(target, key, descAbs, opts);
  if (!r.ok) return boolLit(false);
  if (r.next !== target) {
    writeInPlace(target, r.next);
    migrateAccessors(r.next, target);
    migrateInvariants(r.next, target);
  }
  return boolLit(true);
}

/**
 * Bug 300：Proxy [[GetOwnProperty]] 陷阱结果的 ToPropertyDescriptor 判定——
 * 非对象 → 原生定抛 TypeError；抽象值 → 保守 unknown（不可判不假抛）；
 * 对象 → 补全后的描述符（CompletePropertyDescriptor）。
 */
function reflectDescriptorResult(r: Abs): Abs {
  const s = r.shape;
  if (s.k === "prim" || s.k === "never") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (s.k === "any" || s.k === "unknown" || s.k === "sum") return unknown;
  return completePropDescAbs(r);
}

export function evalReflectMethod(method: string, args: Abs[]): Abs | undefined {
  switch (method) {
    case "get": {
      enforceReflectTarget(args[0], "get");
      const t0 = args[0]!;
      /**
       * Bug 210：Proxy get 陷阱优先（[[Get]]）——handler 的 "get" 槽派发，
       * 实参 (target, key, receiver=proxy)，与成员读面（containers/member.ts
       * 的 $get）同款；无陷阱回退靶读（Receiver = proxy，规范转发）。
       * 陷阱结果过 [[Get]] 规范不变量（靶上不可配置+不可写属性须返回实际值，
       * 否则原生定抛 TypeError）。
       */
      if (t0.shape.k === "brand" && t0.shape.name === "Proxy") {
        const parts = proxyPartsOf(t0);
        if (parts) {
          const trap = proxyTrapOf(parts.handler, "get");
          const kvR = args[1] ? litValue(args[1]) : undefined;
          const kv = kvR?.ok ? kvR.value : undefined;
          // 键 → 槽键面（字符串键原样；number → 十进制串；symbol → "@@X"
          // 投影 + symbolKey 标记——Bug 149 的陷阱边界还原真 symbol）
          let slotKey: string | undefined;
          let symKey = false;
          if (typeof kv === "string") slotKey = kv;
          else if (typeof kv === "number") slotKey = String(kv);
          else if (typeof kv === "symbol") {
            slotKey = slotKeyOfSymbolAbs(args[1]!);
            symKey = true;
          }
          if (trap.k === "fn") {
            const keyAbs = args[1] ?? undef();
            // receiver：Reflect.get 的第 3 实参（缺省 ≡ target，即 proxy 自己）
            const recv = args[2] ?? t0;
            const r = $call(trap.fn, [parts.target, keyAbs, recv], parts.handler);
            if (slotKey !== undefined && !symKey) {
              enforceProxyGetInvariant(parts.target, slotKey, r);
            }
            return r;
          }
          if (trap.k === "dead" || trap.k === "opaque") {
            recordMayThrow({ kind: "TypeError", cause: "Proxy get trap not callable / unknown" });
            return unknown;
          }
          if (slotKey === undefined) return unknown;
          return $get(
            parts.target,
            slotKey,
            symKey ? { symbolKey: true } : undefined,
            args[2] ?? t0,
          );
        }
      }
      // Bug 306：访问器侧表优先（getter 真身住侧表，槽里只有占位）——
      // 原生 Reflect.get 走 [[Get]] ⇒ 调 getter（this = receiver）。
      const accHit = reflectAccessorGet(t0, args[1], args[2] ?? t0);
      if (accHit !== undefined) return accHit;
      const hit = closedObjSlotHit(t0, args[1]);
      return hit ?? unknown;
    }
    case "set": {
      // Bug 31：Reflect.set ≡ [[Set]]——普通可扩展对象上按 receiver（缺省 ≡
      // target）写槽成功；此前只校验不写（o.a 后续读折 undefined 错误值）。
      // 就地写回（writeInPlace 保 Abs 身份——别名可见），返回值照原生 boolean。
      enforceReflectTarget(args[0], "set");
      // 第 4 实参 receiver：非对象 → TypeError（缺省 ≡ target）
      const recvArg = args[3];
      if (recvArg !== undefined) {
        if (recvArg.term?.op === "lit") {
          if (recvArg.term.value !== null && typeof recvArg.term.value !== "object") {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
        } else if (recvArg.shape.k === "prim") {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        } else if (
          recvArg.shape.k === "any" ||
          recvArg.shape.k === "unknown" ||
          recvArg.shape.k === "sum"
        ) {
          recordMayThrow({ kind: "TypeError", cause: "Reflect.set receiver must be an object" });
        }
      }
      const t0 = args[0]!;
      // Bug 299：第 4 实参 receiver 参与写语义（缺省 ≡ target）
      const receiver = recvArg ?? t0;
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      if (typeof kv === "string" || typeof kv === "number") {
        const key = String(kv);
        const value = args[2] ?? undef();
        /**
         * Bug 299：Proxy [[Set]] 陷阱优先——**Reflect 口径**（ToBoolean(陷阱
         * 结果)，失败返 false **不抛**；赋值运算符才是 strict 抛）。此前走
         * $set 的 Proxy 臂（赋值口径）⇒ 陷阱返 false 时定抛 TypeError。
         * 无陷阱 → 转发靶的 [[Set]]（receiver 照传）。
         */
        if (t0.shape.k === "brand" && t0.shape.name === "Proxy") {
          const parts = proxyPartsOf(t0);
          if (parts) {
            const trap = proxyTrapOf(parts.handler, "set");
            if (trap.k === "fn") {
              const r = $call(
                trap.fn,
                [parts.target, args[1] ?? undef(), value, receiver],
                parts.handler,
              );
              const truth = reflectTruth(r);
              return truth === undefined ? boolPrim() : boolLit(truth);
            }
            if (trap.k === "dead" || trap.k === "opaque") {
              recordMayThrow({ kind: "TypeError", cause: "Proxy set trap not callable / unknown" });
              return boolPrim();
            }
            return reflectSetOnTarget(parts.target, key, value, receiver);
          }
        }
        /**
         * Bug 197（Reflect.set 镜像）：receiver **无自有该键**时，[[Set]] 沿
         * [[Prototype]] 链上溯——首个持有该键的原型的访问器（无 setter）/
         * 不可写数据属性 / frozen 原型 ⇒ 写门失败。原生 Reflect.set 在写门
         * 失败时**返 false**（不抛；抛错是 strict 赋值 `$set` 的语义）⇒ 走
         * core 侧同一判定（exec/runtime/proto-set.ts 的 protoChainSetVerdict）。
         * Bug 299/320：receiver 语义与数组 length 写见 reflectSetOnTarget。
         */
        if (t0.shape.k === "tuple" || t0.shape.k === "arr") {
          if (canonicalArrayIndex(key) !== undefined) {
            writeInPlace(t0, $idxSet(t0, args[1]!, value));
            return boolLit(true);
          }
          if (t0.shape.k === "arr") {
            // 数组视图的 length 不可判 → 保守 boolean（不假绿也不假抛）
            return boolPrim();
          }
        }
        return reflectSetOnTarget(t0, key, value, receiver);
      }
      // 键不可判 → 写目标不可判 → 保守 boolean
      return boolPrim();
    }
    case "has": {
      enforceReflectTarget(args[0], "has");
      const hit = closedObjSlotHit(args[0]!, args[1]);
      // 槽命中 → true；miss 走原型链不可判 → 保守 boolean
      if (hit !== undefined && hit !== unknown) return boolLit(true);
      return boolPrim();
    }
    case "deleteProperty": {
      // Bug 31：Reflect.deleteProperty ≡ [[Delete]]——就地删槽（$del），返回
      // 原生 boolean；非配置属性 / frozen 目标原生返 false 不抛。
      enforceReflectTarget(args[0], "deleteProperty");
      const t0 = args[0]!;
      // Bug 124：deleteProperty 陷阱优先——返回 ToBoolean(陷阱结果)（falsy
      // 字面量 → false **不抛**，Reflect 口径与 delete 运算符的 strict 抛
      // 不同，node v26 实测），且不触碰靶（删除责任在陷阱）
      {
        const trapR = proxyBooleanTrap(t0, "deleteProperty", (t) => [t, args[1] ?? undef()]);
        if (trapR === "opaque") return boolPrim();
        if (trapR !== undefined) {
          // Bug 230：Proxy [[Delete]] 不变量（ES2024 10.5.9 step 10）——陷阱
          // 返回 **true** 时，若靶上该键是**不可配置**自有属性 ⇒ 原生定抛
          // TypeError。此前直接返 true（假绿）。
          if (trapR.term?.op === "lit" && trapR.term.value === true) {
            enforceProxyDeleteInvariant(t0, args[1]);
          }
          return trapR;
        }
      }
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      if (typeof kv === "string" || typeof kv === "number") {
        const key = String(kv);
        const flags = getPropFlags(t0)?.get(key);
        if (extStateOf(t0) === "frozen" || flags?.configurable === false) {
          return boolLit(false);
        }
        if (
          t0.shape.k === "obj" ||
          t0.shape.k === "brand" ||
          t0.shape.k === "tuple" ||
          t0.shape.k === "arr"
        ) {
          writeInPlace(t0, $del(t0, args[1]!));
          return boolLit(true);
        }
      }
      return boolPrim();
    }
    case "ownKeys": {
      enforceReflectTarget(args[0], "ownKeys");
      const t0 = args[0]!;
      /**
       * Bug 210：Proxy ownKeys 陷阱优先（[[OwnPropertyKeys]]）——handler 的
       * "ownKeys" 槽派发（实参 target），并过规范不变量（重复名 / 漏不可扩展
       * 靶的自有键 / 非字符串键 → 原生定抛 TypeError）。陷阱缺席 → 落回
       * 靶面（下方通用路径）。
       */
      if (t0.shape.k === "brand" && t0.shape.name === "Proxy") {
        const outcome = proxyOwnKeysTrapKeys(t0);
        if (outcome.k === "keys") {
          return abs({ k: "tuple", elements: outcome.keys }, undefined, undefined, "exact");
        }
        if (outcome.k === "opaque") {
          return abs(
            {
              k: "arr",
              element: joinAbs(
                abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
                abs({ k: "prim", type: "symbol" }, undefined, undefined, "path"),
              ),
            },
            undefined,
            undefined,
            "partial",
          );
        }
        // absent（无 ownKeys 陷阱）→ 规范 step 6 转发**靶**的自有键面
        const tKeys = outcome.target ? proxyTargetOwnStringKeys(outcome.target) : undefined;
        if (tKeys) {
          return abs(
            { k: "tuple", elements: tKeys.map((n) => strLit(n)) },
            undefined,
            undefined,
            "exact",
          );
        }
      }
      if (t0.shape.k === "obj") {
        const os = t0.shape as {
          slots: Record<string, { value: Abs; internal?: boolean; symbolKey?: boolean }>;
          open?: boolean;
          index?: unknown;
        };
        if (!os.open && !os.index) {
          // 与 Object.getOwnPropertyNames 同口径：闭 obj 自有键精确枚举
          // Bug 295：Reflect.ownKeys 返回**全部**自有键（字符串键 + **真
          // symbol**）——原生 `typeof Reflect.ownKeys(o)[0] === "symbol"`、
          // `.join()` 原生定抛 TypeError（symbol 不是 String）。引擎内部把
          // symbol 键投影成 "@@X" 槽名 ⇒ 须还原成宿主真 symbol（与
          // Proxy 陷阱 key 同一映射源：symbol-key.ts 的 slotKey→symbol）。
          // internal 私有槽（原生私有字段对 ownKeys 不可见）剔除。
          const elements = Object.keys(os.slots)
            .filter((n) => os.slots[n]?.internal !== true)
            .map((n) => {
              if (os.slots[n]?.symbolKey === true) {
                const sym = symbolAbsForSlotKey(n);
                // 非 well-known 槽键 → 无宿主 symbol 可还原 → 保守留串
                // （不得凭空捏一个 symbol）
                if (sym !== undefined) return sym;
              }
              return strLit(n);
            });
          return abs({ k: "tuple", elements }, undefined, undefined, "exact");
        }
      } else if (t0.shape.k === "tuple") {
        const holes = (t0.shape as { holes?: number[] }).holes ?? [];
        const names = t0.shape.elements
          .map((_, i) => i)
          .filter((i) => !holes.includes(i))
          .map(String);
        names.push("length");
        return abs({ k: "tuple", elements: names.map((n) => strLit(n)) }, undefined, undefined, "exact");
      }
      // 抽象/开放面：string | symbol 键（含 symbol 键，比 Names 面宽）
      return abs(
        {
          k: "arr",
          element: joinAbs(
            abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
            abs({ k: "prim", type: "symbol" }, undefined, undefined, "path"),
          ),
        },
        undefined,
        undefined,
        "partial",
      );
    }
    case "defineProperty": {
      // target 严格 IsObject + 描述符校验/写入复用 Object.defineProperty 面
      //（Bug 39 同源），返回 boolean（redefine 失败原生返 false 不抛）。
      // Bug 31：保留返回容器并**就地写回**第一实参（Object.defineProperty
      // 的语句级 emit 写回只匹配 callee.object.name === "Object"——Reflect
      // 路径值域是 boolean，写回只能就地；访问器/flags 随容器迁移）。
      enforceReflectTarget(args[0], "defineProperty");
      const t0 = args[0]!;
      // 描述符必须是对象（ToPropertyDescriptor 前置）——原生定抛
      validateDescriptorObject(args[2], "Reflect.defineProperty");
      /**
       * Bug 302：Proxy defineProperty 陷阱优先——**Reflect 口径**（ToBoolean
       * (陷阱结果)，失败返 false **不抛**；Object.defineProperty 才是定抛
       * TypeError）。此前 Reflect 复用 Object 面 ⇒ 陷阱返 false 时定抛。
       */
      if (t0.shape.k === "brand" && t0.shape.name === "Proxy") {
        const parts = proxyPartsOf(t0);
        if (parts) {
          const trap = proxyTrapOf(parts.handler, "defineProperty");
          if (trap.k === "fn") {
            const r = $call(
              trap.fn,
              [parts.target, args[1] ?? undef(), args[2] ?? undef()],
              parts.handler,
            );
            const truth = reflectTruth(r);
            return truth === undefined ? boolPrim() : boolLit(truth);
          }
          if (trap.k === "dead" || trap.k === "opaque") {
            recordMayThrow({ kind: "TypeError", cause: "Proxy defineProperty trap not callable / unknown" });
            return boolPrim();
          }
          // 无陷阱 → 转发靶的 [[DefineOwnProperty]]
          return reflectDefinePropertyOnTarget(parts.target, args[1] ?? undef(), args[2]!);
        }
      }
      return reflectDefinePropertyOnTarget(t0, args[1] ?? undef(), args[2]!);
    }
    case "getOwnPropertyDescriptor": {
      enforceReflectTarget(args[0], "getOwnPropertyDescriptor");
      const t0 = args[0]!;
      /**
       * Bug 300：Proxy [[GetOwnProperty]] 陷阱优先——handler 的
       * "getOwnPropertyDescriptor" 槽派发（实参 (target, key)）；陷阱结果非
       * 对象 → 原生定抛 TypeError。此前陷阱**从不派发**（陷阱名并集里没有
       * 它）⇒ 描述符面退化成「靶面 | undefined」并定抛。
       */
      if (t0.shape.k === "brand" && t0.shape.name === "Proxy") {
        const parts = proxyPartsOf(t0);
        if (parts) {
          const trap = proxyTrapOf(parts.handler, "getOwnPropertyDescriptor");
          if (trap.k === "fn") {
            const r = $call(trap.fn, [parts.target, args[1] ?? undef()], parts.handler);
            return reflectDescriptorResult(r);
          }
          if (trap.k === "dead" || trap.k === "opaque") {
            recordMayThrow({
              kind: "TypeError",
              cause: "Proxy getOwnPropertyDescriptor trap not callable / unknown",
            });
            return unknown;
          }
          // 无陷阱 → 转发靶的 [[GetOwnProperty]]
          return evalObjectMethod("getOwnPropertyDescriptor", [parts.target, args[1] ?? undef()]);
        }
      }
      return evalObjectMethod("getOwnPropertyDescriptor", args);
    }
    case "getPrototypeOf": {
      enforceReflectTarget(args[0], "getPrototypeOf");
      // Bug 124：getPrototypeOf 陷阱优先——返回陷阱结果（Object/null，非对象
      // 非 null 字面量定抛 TypeError）；absent → Object.getPrototypeOf 靶语义
      {
        const trapR = proxyGetProtoTrap(args[0]!);
        if (trapR === "opaque") return unknown;
        if (trapR !== undefined) return trapR;
      }
      return evalObjectMethod("getPrototypeOf", args);
    }
    case "setPrototypeOf": {
      enforceReflectTarget(args[0], "setPrototypeOf");
      // proto：Object or null（node 实测 setPrototypeOf({},1) → TypeError）
      const p0 = args[1];
      if (!p0) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (p0.term?.op === "lit") {
        const pv = p0.term.value;
        if (pv !== null && typeof pv !== "object") {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
      } else if (p0.shape.k === "prim") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else if (p0.shape.k === "any" || p0.shape.k === "unknown" || p0.shape.k === "sum") {
        recordMayThrow({ kind: "TypeError", cause: "Reflect.setPrototypeOf proto must be an object or null" });
      }
      // Bug 31：应用原型设定（就地：null → nullProto 标记；object → open +
      // protoTable，setProtoAbs 语义）；不可扩展目标原生返 false 不抛。
      // Bug 120：SameValue+ext 判定抽共享 protoChangeAllowed（object/methods.ts
      // 单一事实源——ES2024 OrdinarySetPrototypeOf step 3+4，SameValue 先于
      // extensible 检查：原型未变时原生返 true；Object.setPrototypeOf 据此
      // 抛 TypeError，此处返 boolean）。
      // Bug 385 / 386：**恒**走 protoChangeAllowed——原型环（native: false）
      // 与不可变原型 Object.prototype（native: false）都在此拒绝。
      // Reflect 口径是**返 boolean 不抛**（node 实测：
      // Reflect.setPrototypeOf(Object.prototype, {}) → false；
      // Reflect.setPrototypeOf(b, a)（a→b 已成环）→ false）。
      const t0 = args[0]!;
      // Bug 124：setPrototypeOf 陷阱优先——返回 ToBoolean(陷阱结果)（falsy
      // 字面量 → false 不抛，Reflect 口径），且不落侧表（原型设定责任在陷阱）
      {
        const trapR = proxyBooleanTrap(t0, "setPrototypeOf", (t) => [t, p0]);
        if (trapR === "opaque") return boolPrim();
        if (trapR !== undefined) return trapR;
      }
      if (!protoChangeAllowed(t0, p0)) return boolLit(false);
      setProtoAbs(t0, p0);
      return boolLit(true);
    }
    case "apply":
    case "construct": {
      // 可调用/可构造三档：fn → 按 ctor facet；brand/any/unknown/sum → may
      //（类值可调用、实例不可）；prim（含 nullish）与 obj/tuple/arr/eff →
      // 确定不可调用 → 定抛（node 实测 apply(1,…) TypeError）
      const t0 = args[0];
      if (!t0) throw new NudoThrow(errorTypeAbs("TypeError"));
      const s = t0.shape;
      const what = method === "apply" ? "callable" : "a constructor";
      if (s.k === "fn") {
        const ctor = (s as { ctor?: boolean }).ctor;
        if (method === "construct" && ctor === false) {
          throw new NudoThrow(errorTypeAbs("TypeError")); // 箭头/generator 不可构造
        }
        // Bug 14：apply 的 fn target 恒可调用（ctor facet 只与 construct 相关，
        // Math.max 等命名空间一等函数 ctor 缺省）——仅 construct 记 may
        if (method === "construct" && ctor === undefined) {
          recordMayThrow({ kind: "TypeError", cause: `Reflect.${method} target may not be ${what}` });
        }
      } else if (
        s.k === "brand" ||
        s.k === "any" ||
        s.k === "unknown" ||
        s.k === "sum"
      ) {
        recordMayThrow({ kind: "TypeError", cause: `Reflect.${method} target may not be ${what}` });
      } else {
        // prim（含 nullish 字面量）/ obj / tuple / arr / eff：确定不可调用
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 121：argsList 槽位按方法索引——apply 是 args[2]，
      // construct 是 args[1]（此前共用 args[2]：construct 的 2 参合法形
      // 被缺省 newTarget ≡ undefined 的 prim 分类定抛成假 never，而
      // argsList 本体从未校验 → Reflect.construct(A,"s",A) 漏抛）。
      enforceArgsList(args[method === "apply" ? 2 : 1], method);
      // Bug 121：construct 的 newTarget 在场时须过 IsConstructor——
      // 普通对象 / prim（含 nullish 字面量）/ ctor:false fn 原生定抛
      // TypeError；brand 类值带 ctor facet（$class ctor:true）可精确；
      // 其余不可判面记 may（与 target 侧同三档口径）。apply 无此参。
      if (method === "construct" && args[2] !== undefined) {
        const nt = args[2];
        if (isNullishLitAbs(nt)) throw new NudoThrow(errorTypeAbs("TypeError"));
        const ns = nt.shape;
        if (ns.k === "fn") {
          const nctor = (ns as { ctor?: boolean }).ctor;
          if (nctor === false) throw new NudoThrow(errorTypeAbs("TypeError"));
          if (nctor !== true) {
            recordMayThrow({ kind: "TypeError", cause: "Reflect.construct newTarget may not be a constructor" });
          }
        } else if (ns.k === "brand") {
          const nctor = (ns as { ctor?: boolean }).ctor;
          if (nctor === false) throw new NudoThrow(errorTypeAbs("TypeError"));
          if (nctor !== true) {
            recordMayThrow({ kind: "TypeError", cause: "Reflect.construct newTarget may not be a constructor" });
          }
        } else if (ns.k === "any" || ns.k === "unknown" || ns.k === "sum") {
          recordMayThrow({ kind: "TypeError", cause: "Reflect.construct newTarget may not be a constructor" });
        } else {
          // obj / tuple / arr / eff / 非 nullish prim：确定不可构造
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
      }
      // Bug 14：apply 镜像 $invoke 的 apply 路径（f.apply(t, a) ≡
      // Reflect.apply(f, t, a)——同一操作两口径）；construct 保持保守不
      // 复放（不同方法面，报告「已排除」）。argsList 展开：tuple 精确
      // 展开逐元素；arr → 单 element 槽位；闭 obj 无 length 槽 → 精确 0
      // 参（与 $invokeInner expandApplyArgs 同口径）。
      if (method === "apply") {
        const list = args[2];
        const expanded: Abs[] = [];
        let replay = false;
        if (list && (list.shape.k === "tuple" || list.shape.k === "arr")) {
          if (list.shape.k === "tuple") {
            expanded.push(...(list.shape as { elements: Abs[] }).elements);
          } else {
            expanded.push((list.shape as { element: Abs }).element);
          }
          // fn target（含 apply/body impl）→ 真复放；无 impl 的抽象 fn 面
          // → $call 走 instantiateReturn/unknown（同一保守口径）
          const impl = getFnImpl(t0);
          if (impl?.apply || impl?.body || impl?.relation) replay = true;
        } else if (
          list &&
          list.shape.k === "obj" &&
          (list.shape as { open?: boolean }).open !== true
        ) {
          const lenAbs = getSlot(
            (list.shape as { slots: Record<string, { value: Abs }> }).slots,
            "length",
          )?.value;
          if (!lenAbs || isNullishLitAbs(lenAbs)) expanded.length = 0;
          else expanded.push(unknown);
        } else {
          expanded.push(unknown);
        }
        if (replay) {
          return callAtFunctionBoundary(() => $call(t0, expanded, args[1]));
        }
        if (s.k === "fn") {
          // 无 impl 的 fn Abs：保持恒等域（unknown），不折假
          return unknown;
        }
      }
      // 不复放调用（保守）：值域不折假
      return unknown;
    }
    case "isExtensible": {
      enforceReflectTarget(args[0], method);
      return boolPrim();
    }
    case "preventExtensions": {
      // Bug 31：标记 nonext（就地——Object.isExtensible(o) 随后折 false）；
      // 对象 target 原生恒返 true（已不可扩展也 true）。
      enforceReflectTarget(args[0], method);
      // Bug 124：preventExtensions 陷阱优先——返回 ToBoolean(陷阱结果)
      //（falsy 字面量 → false 不抛，Reflect 口径），不落 nonext 标记
      {
        const trapR = proxyBooleanTrap(args[0]!, "preventExtensions", (t) => [t]);
        if (trapR === "opaque") return boolPrim();
        if (trapR !== undefined) return trapR;
      }
      if (args[0]) markExtState(args[0]!, "nonext");
      return boolLit(true);
    }
    default:
      return undefined;
  }
}
