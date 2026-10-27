/**
 * evalObjectMethod：Object.* 静态面大分派（create/keys/values/entries/
 * hasOwn/getPrototypeOf/setPrototypeOf/assign/is/freeze 族/defineProperty
 * 族/getOwnPropertyDescriptor(s)/getOwnPropertyNames/getOwnPropertySymbols/
 * fromEntries/groupBy）。
 *
 * Invariants:
 * - 枚举/读值/描述符机器复用 descriptor.ts 与 enum-entries.ts（单一实现不
 *   复制）；Error 家族判定经 error.ts facade（isErrorCtorName）。
 * - 抽象接收者 may-nullish 只记 throws 效果、值域不变（Bug 27/35/61：仅
 *   any/unknown/含 nullish 臂 union 才记；prim/obj/tuple/fn/brand 形态
 *   原生全定不假 may）。
 * - create：null 原型走 nullProto 标记（in 不回退 Object.prototype）；
 *   Abs 对象原型进 protoTable（[[Prototype]] 事实，Bug 67——instanceof 链
 *   终止判定不得把 null 终止链折 true）；第二实参 propertiesObject 逐可
 *   枚举键过 ToPropertyDescriptor 安装自有属性（Bug 32/23）。
 * - Bug 323：create 的第二实参按**值**判定——「If properties is not
 *   undefined」⇒ 显式 `undefined` 与不传同义（整步跳过，不抛）；`null` 抛。
 * - Bug 324：defineProperties 的第二实参走 **ToObject**——null/undefined
 *   抛；其它原始值装箱成零自有可枚举属性的包装器 ⇒ 不定义任何属性、不抛
 *   （非空字符串例外：装箱后有下标键 ⇒ 描述符是字符 ⇒ TypeError）。
 * - Bug 291：freeze / seal 落**键级标志**（freeze ⇒ writable+configurable
 *   假；seal ⇒ configurable 假）＋ isFrozen / isSealed 的**平凡真**判定
 *   （不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）。
 * - Bug 301：freeze / seal 对 **Proxy** 走陷阱（preventExtensions ＋ 逐键
 *   defineProperty；falsy ⇒ TypeError）。
 * - Bug 308：RegExp 实例的自有 `lastIndex`（gOPN = 「全部自有键」语义）
 *   与 gOPD 的数据描述符（可写、非可枚举、不可配置）。
 * - Bug 315：Object.prototype.toLocaleString 的委派在 object-proto.ts；
 *   本模块的描述符面须与之同口径（gOPDs 的访问器描述符 = {get, set}）。
 * - Bug 326：键家族（keys/values/entries）对**自有键集不完备**的对象折
 *   partial（标记在 prop flags 侧表）——不得折 exact 空元组。
 * - Bug 1075：gOPDs 的自有键面走 [[OwnPropertyKeys]]——**含 symbol 键**
 *   （原生 gOPDs 的结果对象带真 symbol 键）⇒ symbol 投影槽**保留**并带
 *   `symbolKey` 标记（字符串键面 Object.keys / gOPN 仍剔除它）。
 * - Bug 1077：不可变原型 Object.prototype 置 **null** 原型**放行**
 *   （protoChangeAllowed；置非 null 仍拒——Object 面抛 / Reflect 面 false）。
 * - 未建模方法 → undefined 走通用回退。
 */

import type { Abs } from "../../abs.ts";
import {
  abs,
  litValue,
  numLit,
  strLit,
  boolLit,
  unknown,
  confJoin,
  isExactLit,
} from "../../abs.ts";
import {
  markNullProtoObj,
  canonicalArrayIndex,
  setProtoAbs,
  getProtoAbs,
  isNullProtoObj,
  getSlot,
  setSlot,
  propertyKeyOf,
  isImmutableProtoAbs,
  protoChainContains,
  markKeySetOpenAbs,
  keySetIncompleteAbs,
  type ObjShape,
} from "../../objects.ts";
import { mapEntriesAbs } from "../../collections.ts";
import { undefAbs } from "../../hof.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { lookupObjAccessor } from "../../accessors.ts";
import { absFunction } from "../../abs-fn.ts";
import { isSymbolAbs } from "../symbol.ts";
import { boolPrim, str, isPrimLike, noBody, typedArrayElementOf } from "../shared.ts";
import {
  getPropFlags,
  markExtState,
  extStateOf,
  setPropFlags,
  isEnumerableView,
  enumOwnKeys,
} from "../invariants.ts";
import { classInstanceInnerOf, getEvalClass } from "../../exec/class-registry.ts";
import { classNameOfValue } from "../../class-mark.ts";
import { protoOfRecv, objectProtoBrand } from "../ctor.ts";
import { isErrorCtorName } from "../error.ts";
import { isRegExpBrandAbs } from "../regexp.ts";
// Bug 124：Object.* 的 Proxy 对象级陷阱前置派发（deleteProperty 在 $del/
// $delRes；此处 getPrototypeOf/setPrototypeOf/preventExtensions/defineProperty）
import { proxyBooleanTrap, proxyGetProtoTrap, protoBrandOwnMember } from "../../exec/runtime/members.ts";
import { $get } from "../../exec/runtime/containers.ts";

import {
  applyPropertyDescriptor,
  maybePropDescAbs,
  mkPropDescAbs,
  performObjectAssign,
  proxyOwnKeysTrapKeys,
  proxyTargetEnumerableStringKeys,
  proxyTargetOwnStringKeys,
  proxyGetOwnPropDescTrap,
  readProperty,
  validateDefineTarget,
  validateDescriptorObject,
  wellKnownSymbolSlotKey,
} from "./descriptor.ts";
import { proxyPartsOf, proxyTrapOf } from "../../exec/match-iter.ts";
// 族 58 · Bug 321：原型 brand 的自有键集判定（单一事实源，见 members.ts）。
import { protoBrandOwnStringKeys } from "../../exec/runtime/members.ts";
// Bug 284：Proxy 的 isExtensible 陷阱派发需要 $call（陷阱实参 (target)，
// this = handler）——exec/call.ts 已在本模块的依赖图内（exec/runtime/members.ts
// 引入），此处只是显式直连。
import { $call } from "../../exec/call.ts";
import {
  boxedStringEnumEntries,
  builtinBrandNoEnumKeys,
  builtinBrandOwnKeyNames,
  foldGroupBy,
  typedArrayEnumKeyView,
} from "./enum-entries.ts";

/**
 * Bug 120：OrdinarySetPrototypeOf step 3+4（ES2024）——可扩展目标恒允许；
 * 不可扩展（freeze/seal/preventExtensions 侧表标记）目标仅 SameValue 同
 * 原型豁免：nullProto ↔ lit null / protoTable 同 Abs 身份 / 缺省原型 ↔
 * Object.prototype 单例。抽自 reflect.ts 的 Reflect.setPrototypeOf 判定块
 *（两入口同一事实源：Reflect 据此返 boolean、Object.setPrototypeOf 据此
 * 抛 TypeError；SameValue 检查先于 extensibility——frozen 重设同原型不抛，
 * eval-value-read-reflect.test.ts 已 pin）。
 */
export function protoChangeAllowed(t0: Abs, p0: Abs): boolean {
  // Bug 386 / 1077：不可变原型对象（Object.prototype）——[[SetPrototypeOf]]
  // 拒绝**非 null** 原型（原生：Object.setPrototypeOf 抛 TypeError: Immutable
  // prototype object 'Object.prototype' cannot have their prototype set；
  // Reflect 返 false）；**置 null 放行**——ES2024 10.4.1.2 的
  // Object.prototype.[[SetPrototypeOf]] 只在 V **非 null** 时抛，node v26
  // 实测 `Object.setPrototypeOf(Object.prototype, null)` 不抛（Object.prototype
  // 的 [[Prototype]] 本就是 null ⇒ 空操作）、`Reflect.setPrototypeOf(...)` 返
  // true。规范 + V8 一致：仅 Object.prototype 是不可变原型，其余内建原型可改。
  if (isImmutableProtoAbs(t0)) {
    return p0.term?.op === "lit" && p0.term.value === null;
  }
  // Bug 385：原型环——新原型的 [[Prototype]] 链上溯已含 t0 ⇒ 拒绝
  // （原生：Object.setPrototypeOf 抛 TypeError: Cyclic __proto__ value；
  // Reflect 返 false）。修前引擎**静默建出活原型环**（native 不存在该状态）。
  if (protoChainContains(p0, t0)) return false;
  if (extStateOf(t0) === undefined) return true;
  const curIsNull = isNullProtoObj(t0);
  const p0IsNull = p0.term?.op === "lit" && p0.term.value === null;
  if (curIsNull && p0IsNull) return true;
  if (curIsNull !== p0IsNull) return false; // 一侧 null 一侧对象：必不同
  if (getProtoAbs(t0) === p0) return true;
  if (getProtoAbs(t0) === undefined && p0 === objectProtoBrand()) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Bug 291 / 301：freeze / seal / preventExtensions 的键级标志 + Proxy 陷阱
// ---------------------------------------------------------------------------

/** Bug 291/301：Proxy 判定（brand 名为 "Proxy"） */
function isProxyAbs(o: Abs): boolean {
  return o.shape.k === "brand" && (o.shape as { name?: string }).name === "Proxy";
}

/**
 * Bug 326：对象的**自有键集不完备**（键集可能多于槽表）——键家族
 * （Object.keys/values/entries）据此折 partial，**不得**折 exact 空元组
 * （自信的确切错值：native `Object.keys(Object.groupBy([1,2], f))` =
 * ["[object Object]"]，引擎此前折 [] ⇒ dts / zod / guard 三个产物面据此
 * 判「只接受空数组」⇒ TS 消费方吃假红、运行时校验器拒掉每一个真实值）。
 *
 * 标记载体 = **prop flags 侧表**（不是 shape 字段——shape 类型在共享
 * 文件里；侧表是键名 → 标志的 WeakMap，加一个**不存在于槽表**的标记键
 * 对任何视图零副作用：枚举视图按槽表键过滤、描述符面按实键查表）。
 * 不用 shape.open 判：open 语义是「键集可能多于槽表」但**自有键集已知**
 * 的对象也用它（Object.create(<obj>) 的空槽产品——动态继承不建模 ⇒ 缺槽
 * 读保守 unknown；它的自有键集确为空，原生 keys = []，Bug 41 pin）⇒ 用
 * open 判会把那一族也折 partial（既有测试 pin）。
 *
 * Bug 383：标记位与判定搬进 objects.ts（叶子模块）——**单一事实源**，本模块
 * 与 exec/runtime/containers/arr-index.ts（抽象键写面）共用同一标记位。
 */

/** 标记「自有键集不完备」（组键运行时决定、静态不可知的那一族） */
function markKeySetOpen(o: Abs): Abs {
  return markKeySetOpenAbs(o);
}

/** 该对象的自有键集是否不完备（⇒ 键家族折 partial） */
function keySetIncomplete(o: Abs): boolean {
  return keySetIncompleteAbs(o);
}

/**
 * Bug 291：不变性（freeze / seal）作用时的**自有键**集合 + 标志落点。
 * - obj：槽表键（internal 私有槽剔除——非自有属性）
 * - tuple：下标键（+ "length"）
 * - fn：函数自身槽（expando）
 * - brand（用户类实例）：内层 obj 的槽（类字段）；标志记在 **brand** 上
 *   （与 applyPropertyDescriptor 同款：flags 表记在接收者 brand）
 * 键集不可判（开放 obj / 抽象接收者）→ undefined（不逐键落地标志）。
 */
function integrityOwnKeys(o: Abs): { target: Abs; keys: string[] } | undefined {
  const s = o.shape;
  if (s.k === "obj") {
    const os = s as { slots: Record<string, { internal?: boolean }>; open?: boolean };
    if (os.open) return undefined;
    return {
      target: o,
      keys: Object.keys(os.slots).filter((k) => os.slots[k]?.internal !== true),
    };
  }
  if (s.k === "tuple") {
    const holes = (s as { holes?: number[] }).holes ?? [];
    const keys = (s as { elements: Abs[] }).elements
      .map((_, i) => String(i))
      .filter((k) => !holes.includes(Number(k)));
    keys.push("length");
    return { target: o, keys };
  }
  if (s.k === "fn") {
    const slots = (s as { slots?: Record<string, unknown> }).slots;
    return { target: o, keys: slots ? Object.keys(slots) : [] };
  }
  if (s.k === "brand") {
    const inner = classInstanceInnerOf(o);
    if (!inner) return undefined;
    const islots = (inner.shape as ObjShape).slots as Record<string, { internal?: boolean }>;
    return {
      target: o,
      keys: Object.keys(islots).filter((k) => islots[k]?.internal !== true),
    };
  }
  return undefined;
}

/**
 * Bug 291：键级不变性标志落地——Object.freeze 把每个自有键的 writable /
 * configurable 置 false；Object.seal 只置 configurable false（writable /
 * enumerable 保持）。此前只打一个 extState 标签 ⇒ 描述符面完全看不到冻结
 * （gOPD(o,"a").writable 仍折 true、configurable 仍折 true——原生冻结后
 * 是 false）。
 */
function applyIntegrityFlags(o: Abs, level: "frozen" | "sealed"): void {
  const t = integrityOwnKeys(o);
  if (!t) return;
  for (const key of t.keys) {
    const prev = getPropFlags(t.target)?.get(key);
    setPropFlags(t.target, key, {
      writable: level === "frozen" ? false : prev?.writable,
      enumerable: prev?.enumerable,
      configurable: false,
    });
  }
}

/** 该自有键是**数据**属性（非访问器）——访问器无 [[Writable]]，不阻碍 frozen */
function isDataProperty(o: Abs, key: string): boolean {
  const s = o.shape;
  if (s.k === "obj") return !lookupObjAccessor(o, key);
  if (s.k === "brand") {
    const inner = classInstanceInnerOf(o);
    return inner ? !lookupObjAccessor(inner, key) : true;
  }
  return true; // tuple / fn：槽即数据属性
}

/**
 * Bug 291：isFrozen / isSealed 判定（ES2024 §7.3.15/16 + node v26 实测）：
 * - isSealed(O)：O 不可扩展 ∧ 每个自有属性都**不可配置**
 * - isFrozen(O)：O 不可扩展 ∧ 每个自有属性都不可配置 ∧（**数据**属性）
 *   不可写（访问器属性无 [[Writable]] ⇒ 不构成阻碍——node 实测
 *   `Object.isFrozen(Object.freeze({get a(){}}))` === true）
 * 此前只认 extState 标签 ⇒ `Object.isFrozen(Object.seal({}))` 折 false
 * （原生 true——空对象密封即冻结）、`Object.isFrozen(
 * Object.preventExtensions({}))` 折 false（原生 true）、defineProperty
 * 收紧标志后再 preventExtensions 的对象也折 false（原生 true）。
 */
function integrityTruth(t: Abs, wantFrozen: boolean): boolean {
  const st = extStateOf(t);
  if (wantFrozen ? st === "frozen" : st === "sealed" || st === "frozen") return true;
  // 仍可扩展 ⇒ 既不 sealed 也不 frozen
  if (st === undefined) return false;
  const own = integrityOwnKeys(t);
  if (!own) return false;
  for (const key of own.keys) {
    const flags = getPropFlags(own.target)?.get(key);
    if (flags?.configurable !== false) return false;
    if (wantFrozen && isDataProperty(t, key) && flags?.writable !== false) return false;
  }
  return true;
}

/**
 * Bug 301：Proxy 的 freeze / seal 陷阱派发（原生 SetIntegrityLevel,
 * ES2024 10.4.6）：先 [[PreventExtensions]]（preventExtensions 陷阱），
 * 再对每个自有键 [[DefineOwnProperty]]（defineProperty 陷阱，描述符带
 * 当前 writable / enumerable + configurable:false）；任一陷阱返回 falsy ⇒
 * TypeError。
 * 此前 freeze / seal **完全无视**陷阱（直接落 extState 标记）⇒ 代理的
 * 不可扩展性与键级标志全被跳过（假冻结：node 实测
 * `Object.freeze(new Proxy(o, {preventExtensions(){return false}}))` 抛
 * TypeError，引擎不抛；defineProperty 陷阱返回 false 也被吞）。
 */
function proxySetIntegrity(o: Abs, level: "frozen" | "sealed"): void {
  const pe = proxyBooleanTrap(o, "preventExtensions", (t) => [t]);
  if (pe === "opaque") {
    recordMayThrow({ kind: "TypeError", cause: "Proxy preventExtensions trap result unknown" });
    return;
  }
  if (pe !== undefined && pe.term?.op === "lit" && pe.term.value === false) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const outcome = proxyOwnKeysTrapKeys(o);
  let target: Abs | undefined;
  let keys: string[] | undefined;
  if (outcome.k === "keys") {
    target = outcome.target;
    keys = outcome.keys.map((k) => {
      const kv = litValue(k);
      return kv.ok ? String(kv.value) : "";
    });
  } else if (outcome.k === "absent") {
    target = outcome.target;
    keys = target ? proxyTargetOwnStringKeys(target) : undefined;
  }
  if (keys === undefined) {
    recordMayThrow({ kind: "TypeError", cause: "Proxy own keys unknown" });
    return;
  }
  for (const key of keys) {
    const cur = target ? getPropFlags(target)?.get(key) : undefined;
    const desc = abs(
      {
        k: "obj",
        slots: {
          writable: { value: boolLit(level === "frozen" ? false : cur?.writable !== false) },
          enumerable: { value: boolLit(cur?.enumerable !== false) },
          configurable: { value: boolLit(false) },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const dp = proxyBooleanTrap(o, "defineProperty", (t) => [t, strLit(key), desc]);
    if (dp === "opaque") {
      recordMayThrow({ kind: "TypeError", cause: "Proxy defineProperty trap result unknown" });
      continue;
    }
    if (dp !== undefined && dp.term?.op === "lit" && dp.term.value === false) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
}

/**
 * Bug 284：Proxy 的 [[IsExtensible]]（ES2024 10.5.4）——
 * 1. GetMethod(handler, "isExtensible")；缺席 ⇒ 回退**靶**的 [[IsExtensible]]；
 * 2. ToBoolean(陷阱结果) 与靶的实际可扩展性**不一致** ⇒ TypeError
 *    （原生 'isExtensible' on proxy: trap result did not reflect extensibility
 *    of proxy target）。
 *
 * 此前本模块**无派发点**（陷阱名并集里没有 isExtensible ⇒ 取陷阱恒「不存在」）
 * ⇒ Object.isExtensible(proxy) 恒折 true：假绿（原生必抛 TypeError）＋
 * 陷阱副作用（副作用面）整体丢失。
 *
 * 靶的**实际**可扩展性：引擎的可扩展性标记落在**代理**自身
 * （Object.preventExtensions / freeze / seal(proxy) ⇒ markExtState(proxy)），
 * 而原生是**靶**被冻结 ⇒ 代理自身带标记 ⇔ 靶已不可扩展——但仅当 handler
 * **没有** preventExtensions 陷阱时成立（陷阱自己负责冻结靶，引擎只看靶的
 * 实际标记）。
 */
function proxyIsExtensible(o: Abs): Abs | undefined {
  const parts = proxyPartsOf(o);
  if (!parts) return undefined; // 无 Proxy 侧表 ⇒ 落通用口径
  const targetExtensible =
    extStateOf(parts.target) === undefined &&
    !(
      extStateOf(o) !== undefined &&
      proxyTrapOf(parts.handler, "preventExtensions").k === "absent"
    );
  const trap = proxyTrapOf(parts.handler, "isExtensible");
  if (trap.k === "absent") return boolLit(targetExtensible); // 规范 step 4：回退靶语义
  if (trap.k === "dead") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (trap.k === "opaque") {
    recordMayThrow({ kind: "TypeError", cause: "Proxy isExtensible trap result unknown" });
    return boolPrim();
  }
  const r = $call(trap.fn, [parts.target], parts.handler);
  const rv = litValue(r);
  if (!rv.ok) {
    // 抽象结果：ToBoolean 不可判 ⇒ 不变量不可判（may）⇒ 保守 boolean 域
    recordMayThrow({ kind: "TypeError", cause: "Proxy isExtensible trap result is abstract" });
    return boolPrim();
  }
  const trapExtensible = Boolean(rv.value);
  if (trapExtensible !== targetExtensible) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  return boolLit(trapExtensible);
}

/**
 * 族 65 · Bug 240：`Object.getOwnPropertySymbols` 的**自有 symbol 键**投影。
 *
 * 原生返回自有 symbol 键的数组（node v26.10.0 实测：普通对象 / 数组 /
 * 字符串 / 数字 / 函数 / Error 实例 / TA 实例 / 生成器对象 / Map / Promise
 * ⇒ `[]`；宿主命名空间对象（Math / JSON / Intl / Reflect / globalThis）⇒
 * `[Symbol.toStringTag]`；`Array.prototype` ⇒ `[Symbol.iterator,
 * Symbol.unscopables]`；`Array` / `Promise` / `Map` / `Set` 构造器 ⇒
 * `[Symbol.species]`）。
 *
 * 引擎把 symbol 键投影成 `"@@X"` 槽（Slot.symbolKey 标记——宿主对象投影
 * 见 exec/runtime/state.ts，转译期 `[Symbol.X]` 同口径）⇒ **闭**对象的自有
 * symbol 键集 = 槽里 `symbolKey` 且**非 internal / 非 inherited** 的那些。
 * internal 槽不是自有属性（生成器对象的 `@@iterator` 在原生是原型链成员
 * ⇒ 原生 `gOPS(g())` === `[]`）⇒ 剔除。
 *
 * 键集**不可判**时（开放 obj / 抽象 brand / arr / eff / any / unknown /
 * sum / Proxy / 原型 brand——引擎未建模原型对象自身的 symbol 键）⇒ 返回
 * undefined（调用方沿保守 `symbol[]` 域，**不折空**：空是自信的确切错值）。
 */
function ownSymbolKeysAbs(a0: Abs): Abs | undefined {
  const symPrim = (): Abs => abs({ k: "prim", type: "symbol" }, undefined, undefined, "path");
  const tupleOf = (n: number): Abs =>
    abs({ k: "tuple", elements: Array.from({ length: n }, () => symPrim()) }, undefined, undefined, "exact");
  const countOwn = (slots: Record<string, { value: Abs; internal?: boolean; inherited?: boolean; symbolKey?: boolean }>): number =>
    Object.keys(slots).filter((n) => {
      const s = slots[n]!;
      return s.symbolKey === true && s.internal !== true && s.inherited !== true;
    }).length;
  const s = a0.shape;
  if (s.k === "obj") {
    const os = s as unknown as {
      slots: Record<string, { value: Abs; internal?: boolean; inherited?: boolean; symbolKey?: boolean }>;
      open?: boolean;
      index?: unknown;
    };
    if (os.open === true || os.index !== undefined) return undefined;
    return tupleOf(countOwn(os.slots));
  }
  if (s.k === "brand") {
    // Proxy：ownKeys 陷阱可给任意 symbol 键 ⇒ 不可判。
    if (s.name === "Proxy") return undefined;
    // 原型 brand（`X.prototype`）：引擎只建模了原型的**字符串**自有键，
    // 原型的自有 symbol 键未建模 ⇒ 不可判（不折空）。
    if (s.name.endsWith(".prototype")) return undefined;
    const inner = s.shape;
    if (inner.shape.k !== "obj") return undefined;
    const os = inner.shape as unknown as {
      slots: Record<string, { value: Abs; internal?: boolean; inherited?: boolean; symbolKey?: boolean }>;
      open?: boolean;
      index?: unknown;
    };
    if (os.open === true || os.index !== undefined) return undefined;
    return tupleOf(countOwn(os.slots));
  }
  if (s.k === "tuple") {
    // 元组 = 闭合数组值：引擎槽域无 symbol 键 ⇒ 原生无自有 symbol 键。
    return tupleOf(0);
  }
  if (s.k === "prim") {
    // 装箱原始值（Number / String / Boolean / BigInt / Symbol 包装）：
    // 原生包装器无自有 symbol 键。
    return tupleOf(0);
  }
  if (s.k === "fn") {
    // 函数值：自有键 = 静态 / expando 槽（引擎建模在 fn 槽域）⇒ symbol 键
    // 取 symbolKey 槽计数。
    const slots = s.slots;
    if (!slots) return tupleOf(0);
    return tupleOf(countOwn(slots));
  }
  return undefined;
}

/**
 * Bug 57/84：访问器属性描述符（get/set thunk 包成 fn Abs；调用经 apply 钩子
 * 求值）。this 回退 target——描述符 getter 被调用时 this 为接收者（obj 臂为
 * 本体、类实例臂为承载槽的内层 inner，但原生 this 是 brand 实例，侧表 thunk
 * 闭包已绑定接收者语义）。gOPD 与 gOPDs 共用（单一实现）。
 */
function accessorPropDescAbs(target: Abs, key: string): Abs | undefined {
  const acc = lookupObjAccessor(target, key);
  if (!acc) return undefined;
  const flags = getPropFlags(target)?.get(key);
  const wrapGet = (thunk: (t: Abs) => Abs): Abs =>
    absFunction(["_this"], {
      body: noBody,
      apply: (_args, thisVal) => thunk(thisVal ?? target),
    });
  const wrapSet = (thunk: (t: Abs, v: Abs) => Abs): Abs =>
    absFunction(["_this", "value"], {
      body: noBody,
      apply: (args2, thisVal) => {
        thunk(thisVal ?? target, args2[0] ?? undefAbs());
        return undefAbs(); // setter 返回值原生丢弃
      },
    });
  return abs(
    {
      k: "obj",
      slots: {
        get: { value: acc.get ? wrapGet(acc.get) : undefAbs() },
        set: { value: acc.set ? wrapSet(acc.set) : undefAbs() },
        enumerable: { value: boolLit(flags?.enumerable !== false) },
        configurable: { value: boolLit(flags?.configurable !== false) },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/** Object.keys/values/entries/assign + 不变性方法 */
export function evalObjectMethod(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0];

  /**
   * 抽象接收者可能 nullish → ToObject/RequireObjectCoercible may TypeError
   *（Bug 27/35/61：仅补 throws 效果，值域不变；any/unknown/含 nullish 臂
   * union 才记——prim/obj/tuple/fn/brand 形态原生全定）。
   */
  const noteRecvMayNullish = (a: Abs | undefined, cause: string): void => {
    if (!a) return;
    const mayNullish = (m: Abs): boolean =>
      m.shape.k === "any" ||
      m.shape.k === "unknown" ||
      (m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined));
    const k = a.shape.k;
    if (
      k === "any" ||
      k === "unknown" ||
      (k === "sum" && (a.shape as unknown as { members: Abs[] }).members.some(mayNullish))
    ) {
      recordMayThrow({ kind: "TypeError", cause });
    }
  };

/** enumerable:false（defineProperty 记录）/ internal 私有槽（Bug 84）的键
 *  从枚举视图剔除；includeSymbols 供 assign/defineProperties（原生
 *  [[OwnPropertyKeys]] 含可枚举 symbol——经 "@@X" 投影槽），默认剔除
 *  （Object.keys/values/entries 是字符串键视图，Bug 117） */
  const enumKeys = (slots: Record<string, unknown>, target: Abs, includeSymbols = false): string[] => {
    const flags = getPropFlags(target);
    return Object.keys(slots).filter(
      (k) =>
        flags?.get(k)?.enumerable !== false &&
        (slots[k] as { internal?: boolean })?.internal !== true &&
        (includeSymbols || (slots[k] as { symbolKey?: boolean })?.symbolKey !== true),
    );
  };

  /** Bug 84：用户类实例 brand 的公有可枚举自有键值对（私有 Slot.internal
   * 剔除）；非类实例面 → undefined（调用方保持既有保守口径）
   * Bug 295：Object.keys|values|entries 是**字符串键**视图——symbol 键不进
   * （原生类实例的 keys 家族看不到 Symbol.toStringTag）。enumOwnKeys 是
   * CopyDataProperties 视图（含 symbol 键）⇒ 这里用本地 enumKeys
   * （includeSymbols 默认 false）。 */
  const classInstanceEnumEntries = (a0: Abs | undefined): Array<[string, Abs]> | undefined => {
    const inner = a0 ? classInstanceInnerOf(a0) : undefined;
    if (!inner) return undefined;
    const slots = (inner.shape as ObjShape).slots as Record<string, { value: Abs }>;
    return enumKeys(slots, inner).map((k) => [k, getSlot(slots, k)!.value] as [string, Abs]);
  };

  /** Bug 125：TA brand 枚举投影素材——typedArrayEnumKeyView（exact/open/
   * 非 TA）+ 元素域 prim（枚举键全在界内，元素读不并入越界 undefined 臂） */
  const taEnumInfo = (
    a0: Abs | undefined,
  ): { view: { k: "exact"; count: number } | { k: "open" }; elem: Abs } | undefined => {
    const view = typedArrayEnumKeyView(a0);
    if (!view) return undefined;
    const et = typedArrayElementOf((a0!.shape as { name?: string }).name ?? "") ?? "number";
    return { view, elem: abs({ k: "prim", type: et }, undefined, undefined, "exact") };
  };

  /** Bug 129：freeze/seal 的 TA 非空守卫——SetIntegrityLevel 对整数索引
   * 异质对象不可行：长度槽可证 >0 → 定抛 TypeError（V8「Cannot freeze|
   * seal array buffer views with elements」）、==0 合法照冻、长度抽象/
   * 未建模（无 length 槽）→ may。抽象接收者（any/unknown/含 any 臂或
   * 开放长度 TA 臂的 sum）可能是非空 TA → may（gate 面）。preventExtensions/
   * isFrozen/isSealed 原生对 TA 不抛——不走此守卫。 */
  const taSetIntegrityGuard = (recv: Abs | undefined, what: "freeze" | "seal"): void => {
    const view = typedArrayEnumKeyView(recv);
    if (view) {
      if (view.k === "exact") {
        if (view.count > 0) throw new NudoThrow(errorTypeAbs("TypeError"));
      } else {
        recordMayThrow({ kind: "TypeError", cause: `Cannot ${what} array buffer views with elements` });
      }
      return;
    }
    const cause = `Cannot ${what} array buffer views with elements`;
    const mayTa = (m: Abs): boolean =>
      m.shape.k === "any" || m.shape.k === "unknown" || typedArrayEnumKeyView(m) !== undefined;
    const k = recv?.shape.k;
    if (k === "any" || k === "unknown") {
      recordMayThrow({ kind: "TypeError", cause });
    } else if (k === "sum") {
      if ((recv!.shape as unknown as { members: Abs[] }).members.some(mayTa)) {
        recordMayThrow({ kind: "TypeError", cause });
      }
    }
  };

  switch (name) {
    case "create": {
      // null 原型：空闭对象 + nullProto 标记（in 不回退 Object.prototype）。
      // create()/create(undefined)/prim 字面量 proto：原生 TypeError 硬抛
      if (a0 === undefined || (a0.term?.op === "lit" && a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const protoVR = litValue(a0);
      const protoV = protoVR.ok ? protoVR.value : undefined;
      let base: Abs | undefined;
      let nullProto = false;
      // Bug 67 联动：Abs 对象原型进 protoTable（[[Prototype]] 事实）——
      // instanceof Object 的链终止判定（null 终止链不得折 true）与
      // gPo(super) 投影消费；宿主原始对象原型不收形，不入表
      let protoToRecord: Abs | undefined;
      if (protoV === null) {
        base = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
        nullProto = true;
      } else if (typeof protoV === "object") {
        base = abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      } else if (a0.term?.op === "lit") {
        // number/string/bool/bigint/symbol 字面量 proto：原生 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else if (a0.shape.k === "prim") {
        // Bug 33：shape 先于 lit 判定——prim 形态（symbol prim 无 lit 项，
        // Symbol() 产物；抽象 number/string/bool/bigint prim 同为非对象）→
        // 原生定抛（Object prototype may only be an Object or null）
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else if (a0.shape.k === "any" || a0.shape.k === "unknown" || a0.shape.k === "sum") {
        // 抽象 proto（any/unknown/含 prim 臂 union）→ may TypeError；值域
        // 保持 unknown（descriptors 不可装）
        recordMayThrow({ kind: "TypeError", cause: "Object.create proto must be an object or null" });
      } else {
        // Bug 41：obj/tuple/arr/fn/brand/eff proto——合法对象（ToObject 全
        // 定、下游 keys 家族恒 total 不再假 may-throw）；动态继承不建模：
        // open obj（缺槽读保守 unknown，兼容「不得折成 false」pin；keys
        // 家族走 obj 分支精确枚举自有槽）
        base = abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "path");
        protoToRecord = a0;
      }
      // Bug 32：第二实参 propertiesObject——逐（可枚举字符串键）描述符经
      // ToPropertyDescriptor + DefineOwnProperty 安装为**自有属性**（此前
      // 整体忽略：createDescNull 静默 undefined / obj-proto 变体假 unknown）。
      const props = args[1];
      // Bug 323：第二实参按**值**判定（规范「If properties is not undefined」）
      // ——实参槽缺席与**显式** `undefined` 同义（整步跳过：只建对象、不定义
      // 任何属性、不抛；node 实测 create(o) 与 create(o, undefined) 同为 OK）
      // ⇒ 此前「槽在 + 值是 undefined」被误判成必抛 TypeError（L2 假红 +
      // 返回值错折 never，与 1 参形态自相矛盾）；`null` 走 ToObject → 仍定抛。
      const propsValueIsUndefined =
        props !== undefined && props.term?.op === "lit" && props.term.value === undefined;
      if (props !== undefined && !propsValueIsUndefined) {
        if (!props || (props.term?.op === "lit" && props.term.value === null)) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        if (props.shape.k === "any" || props.shape.k === "unknown" || props.shape.k === "sum") {
          recordMayThrow({
            kind: "TypeError",
            cause: "Object.create propertiesObject must be an object",
          });
        } else if (base !== undefined && props.shape.k === "obj") {
          const ps = props.shape as unknown as {
            slots: Record<string, { value: Abs }>;
            open?: boolean;
            index?: unknown;
          };
          // 原生只取自有**可枚举**键（EnumerableTrue 过滤；含 symbol 键——
          // 经 "@@X" 投影槽，Bug 117 标记随安装传递）
          for (const key of ps.open || ps.index ? [] : enumKeys(ps.slots, props, true)) {
            const slot = ps.slots[key]! as { value: Abs; symbolKey?: boolean };
            validateDescriptorObject(slot.value, "Object.create");
            base = applyPropertyDescriptor(
              base,
              key,
              slot.value,
              slot.symbolKey ? { symbolKey: true } : undefined,
            );
          }
        } else if (props.shape.k === "tuple") {
          // Bug 23：tuple props——下标槽即自有可枚举键（hole 位无键跳过），
          // 元素照 obj 臂逐一经 ToPropertyDescriptor（validateDescriptorObject
          // 单一分类：lit prim/nullish 定抛、抽象 may）+ 安装 "i"（原生
          // node 实测 [{}] 落键 "0"）
          const holes = (props.shape as { holes?: number[] }).holes ?? [];
          props.shape.elements.forEach((el, i) => {
            if (holes.includes(i)) return;
            validateDescriptorObject(el, "Object.create");
            if (base !== undefined) base = applyPropertyDescriptor(base, String(i), el);
          });
        } else if (props.term?.op === "lit" && typeof props.term.value === "string") {
          // Bug 23：字符串字面量 props——非空串装箱后 "0".."n-1" 全是单字符
          // string（非对象）→ ToPropertyDescriptor 定抛；空串零可枚举键，
          // 不抛不装
          if (props.term.value.length > 0) {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
        } else if (
          (props.shape.k === "prim" &&
            (props.shape as { type?: string }).type === "string") ||
          props.shape.k === "arr"
        ) {
          // Bug 23：抽象 string（可能非空）与抽象数组（元素可能非对象）
          // props → may TypeError
          recordMayThrow({
            kind: "TypeError",
            cause: "Object.create propertiesObject must be an object",
          });
        }
        // 其余 prim propertiesObject（number/bool/bigint/symbol 字面量与
        // 抽象）：ToObject 装箱零可枚举自有键 → 无属性安装（node 实测
        // Object.create(null, 5/true/1n/Symbol()) 静默）；fn/brand 无字符
        // 串可枚举键槽同理
      }
      if (base !== undefined && nullProto) return markNullProtoObj(base);
      if (base !== undefined && protoToRecord !== undefined) {
        return setProtoAbs(base, protoToRecord);
      }
      return base; // 抽象 proto 臂：保守 unknown（值域与前一致）
    }
    case "keys": {
      // Bug 61：缺省 ≡ undefined → ToObject 定抛；nullish 字面量同（原仅字面量臂）
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      /**
       * Bug 210：Proxy ownKeys 陷阱优先（[[OwnPropertyKeys]]）——原生
       * Object.keys(proxy) 走 handler 的 "ownKeys" 陷阱，再按**可枚举**性
       * 过滤（[[GetOwnProperty]] 面：靶上无该键 / 该键不可枚举 → 不进结果）。
       * 无陷阱 → 规范 step 6 转发**靶**的自有键面。
       */
      {
        const outcome = proxyOwnKeysTrapKeys(a0);
        if (outcome.k === "keys") {
          const enumKeys = proxyTargetEnumerableStringKeys(outcome.target);
          if (enumKeys === undefined) {
            return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
          }
          const names = outcome.keys
            .filter((k) => typeof (k.term?.op === "lit" ? k.term.value : undefined) === "string")
            .map((k) => String((k.term as { value: unknown }).value))
            .filter((n) => enumKeys.includes(n));
          return abs({ k: "tuple", elements: names.map((n) => strLit(n)) }, undefined, undefined, "exact");
        }
        if (outcome.k === "opaque") {
          return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
        }
        // absent（无 ownKeys 陷阱）→ 靶的可枚举自有键（原生转发 target 面）
        if (outcome.target) {
          const enumKeys = proxyTargetEnumerableStringKeys(outcome.target);
          if (enumKeys === undefined) {
            return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
          }
          return abs(
            { k: "tuple", elements: enumKeys.map((n) => strLit(n)) },
            undefined,
            undefined,
            "exact",
          );
        }
      }
      if (a0?.shape.k === "obj") {
        // Bug 326：**自有键集不完备**的开放对象（典型产物：Object.groupBy 的
        // 分组对象——组键由回调运行时 ToPropertyKey 决定，静态不可知）折
        // partial；此前折 exact 空元组 = 自信的确切错值（native
        // keys(groupBy(...)) = ["[object Object]"] vs 引擎 []）⇒ dts/zod/
        // guard 三个产物面据此判「只接受空数组」。判据见 keySetIncomplete。
        if (keySetIncomplete(a0)) {
          return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
        }
        const os = a0.shape as { slots: Record<string, unknown> };
        const keys = enumKeys(os.slots, a0).map((k) => strLit(k));
        return abs({ k: "tuple", elements: keys }, undefined, undefined, "exact");
      }
      if (a0?.shape.k === "tuple") {
        // 数组：索引键（hole 槽无键；defineProperty 记下的 enumerable:false
        // 下标同样剔除——Bug 86）
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const keys = a0.shape.elements
          .map((_, i) => i)
          .filter((i) => !holes.includes(i) && isEnumerableView(a0, String(i)))
          .map((i) => strLit(String(i)));
        return abs({ k: "tuple", elements: keys }, undefined, undefined, "exact");
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "string") {
        // 字符串装箱：code unit 索引键
        const s = a0.term.value;
        return abs(
          { k: "tuple", elements: Array.from({ length: s.length }, (_, i) => strLit(String(i))) },
          undefined,
          undefined,
          "exact",
        );
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "number") {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      }
      // Bug 43：非字符串 prim（boolean/bigint/symbol 字面量 + 抽象 prim）装
      // 箱零可枚举自有属性 → []（gOPN Bug 35 同款臂；keys 对抽象 string
      // 保持 string[]——长度未知，generic 同域）
      if (a0?.shape.k === "prim" && (a0.shape as { type?: string }).type !== "string") {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      }
      // Bug 43：内建 brand 接收者分类——boxed String → 下标键（length 不可
      // 枚举）；其余内建 brand 零可枚举自有键；用户/未知 brand 保持 generic
      {
        // Bug 125：TA brand——下标键 "0".."n-1"（整数索引异质属性，自有
        // 可枚举；length 是原型访问器非自有键）；长度槽可知（数字/字面量
        // 源构造形态）→ 精确键元组；长度开放 → 诚实 partial string[]（此前
        // 整族折 []——wrong-exact）
        const ta = taEnumInfo(a0);
        if (ta) {
          return ta.view.k === "exact"
            ? abs(
                {
                  k: "tuple",
                  elements: Array.from({ length: ta.view.count }, (_, i) => strLit(String(i))),
                },
                undefined,
                undefined,
                "exact",
              )
            : abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
        }
        const brandKeys = boxedStringEnumEntries(a0);
        if (brandKeys) {
          return abs({ k: "tuple", elements: brandKeys.map(([k]) => strLit(k)) }, undefined, undefined, "exact");
        }
        if (builtinBrandNoEnumKeys(a0)) {
          // Bug 308 口径分离：此处是「**可枚举**自有键」视图（Object.keys
          // 语义）——RegExp 的 `lastIndex` 是自有但**非可枚举** ⇒ 不入
          // （原生 Object.keys(/x/) = []）；gOPN（「全部自有键」）另走
          // builtinBrandOwnKeyNames。
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        // Bug 84：用户类实例——内层闭 obj 公有可枚举自有键（私有槽 internal 剔除；
        // 此前整 brand 保守 partial string[]）
        const ciKeys = classInstanceEnumEntries(a0);
        if (ciKeys) {
          return abs({ k: "tuple", elements: ciKeys.map(([k]) => strLit(k)) }, undefined, undefined, "exact");
        }
      }
      // Bug 61：抽象接收者（any/unknown/含 nullish 臂 union）may ToObject 抛——
      // 仅补 throws 效果，partial 值域不变
      noteRecvMayNullish(a0, "Object.keys receiver ToObject");
      return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
    }
    case "values": {
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0?.shape.k === "obj") {
        // Bug 326：自有键集不完备 ⇒ 诚实 partial（此前 exact 空元组 =
        // 自信的确切错值，native values = [[1,2]]）
        if (keySetIncomplete(a0)) {
          return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
        }
        const os = a0.shape as { slots: Record<string, { value: Abs }> };
        const slots = os.slots;
        // Bug 57：[[Get]] 语义——访问器 getter 求值（直接读占位槽会折
        // undefined/unknown）
        const vals = enumKeys(slots, a0).map((k) => readProperty(a0, k));
        return abs({ k: "tuple", elements: vals }, undefined, undefined, "exact");
      }
      if (a0?.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        // Bug 86：enumerable:false 下标键剔除（与 keys 同口径）
        return abs(
          {
            k: "tuple",
            elements: a0.shape.elements.filter(
              (_, i) => !holes.includes(i) && isEnumerableView(a0, String(i)),
            ),
          },
          undefined,
          undefined,
          a0.conf,
        );
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "string") {
        // code unit（与 Object.keys 同口径），不是 Array.from 的 code point
        const s = a0.term.value;
        return abs(
          {
            k: "tuple",
            elements: Array.from({ length: s.length }, (_, i) => strLit(s[i]!)),
          },
          undefined,
          undefined,
          "exact",
        );
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "number") {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      }
      // Bug 43：非字符串 prim（boolean/bigint/symbol 字面量 + 抽象 prim）装
      // 箱零可枚举自有属性 → []；抽象 string prim → string[]（字符序列）
      if (a0?.shape.k === "prim") {
        if ((a0.shape as { type?: string }).type !== "string") {
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
      }
      // Bug 43：内建 brand 接收者分类——boxed String → 下标槽字符；其余
      // 内建 brand 零可枚举自有键；用户/未知 brand 保持 generic
      {
        // Bug 125：TA brand——值走元素域（枚举键全在界内，无越界 undefined
        // 臂）；长度开放 → partial <元素域>[]（keys 同口径不再折空）
        const ta = taEnumInfo(a0);
        if (ta) {
          return ta.view.k === "exact"
            ? abs(
                { k: "tuple", elements: Array.from({ length: ta.view.count }, () => ta.elem) },
                undefined,
                undefined,
                "exact",
              )
            : abs({ k: "arr", element: ta.elem }, undefined, undefined, "partial");
        }
        const brandVals = boxedStringEnumEntries(a0);
        if (brandVals) {
          return abs({ k: "tuple", elements: brandVals.map(([, v]) => v) }, undefined, undefined, "exact");
        }
        if (builtinBrandNoEnumKeys(a0)) {
          // Bug 308 口径分离：此处是「**可枚举**自有值」视图——RegExp 的
          // `lastIndex` 非可枚举 ⇒ 不入（原生 Object.values(/x/) = []）。
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        // Bug 84：用户类实例——公有可枚举自有值（私有槽 internal 剔除）
        const ciVals = classInstanceEnumEntries(a0);
        if (ciVals) {
          return abs({ k: "tuple", elements: ciVals.map(([, v]) => v) }, undefined, undefined, "exact");
        }
      }
      // Bug 61：同 keys——抽象接收者 may ToObject 抛
      noteRecvMayNullish(a0, "Object.values receiver ToObject");
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "entries": {
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0?.shape.k === "obj") {
        // Bug 326：自有键集不完备 ⇒ 诚实 partial（此前 exact 空元组 =
        // 自信的确切错值，native entries = [["[object Object]",[1,2]]]）
        if (keySetIncomplete(a0)) {
          return abs(
            {
              k: "arr",
              element: abs(
                { k: "tuple", elements: [str("path"), unknown] },
                undefined,
                undefined,
                "partial",
              ),
            },
            undefined,
            undefined,
            "partial",
          );
        }
        const os = a0.shape as { slots: Record<string, { value: Abs }> };
        const slots = os.slots;
        // Bug 57：[[Get]] 语义——访问器 getter 求值
        const entries = enumKeys(slots, a0).map((k) =>
          abs({ k: "tuple", elements: [strLit(k), readProperty(a0, k)] }, undefined, undefined, "exact"),
        );
        return abs({ k: "tuple", elements: entries }, undefined, undefined, "exact");
      }
      if (a0?.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        // Bug 86：enumerable:false 下标键剔除（与 keys 同口径）
        const entries = a0.shape.elements
          .map((el, i) => ({ el, i }))
          .filter(({ i }) => !holes.includes(i) && isEnumerableView(a0, String(i)))
          .map(({ el, i }) =>
            abs({ k: "tuple", elements: [strLit(String(i)), el] }, undefined, undefined, "exact"),
          );
        return abs({ k: "tuple", elements: entries }, undefined, undefined, "exact");
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "string") {
        // code unit 下标（与 Object.keys 同口径），不是 code point 序号
        const s = a0.term.value;
        return abs(
          {
            k: "tuple",
            elements: Array.from({ length: s.length }, (_, i) =>
              abs({ k: "tuple", elements: [strLit(String(i)), strLit(s[i]!)] }, undefined, undefined, "exact"),
            ),
          },
          undefined,
          undefined,
          "exact",
        );
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "number") {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      }
      // Bug 43：非字符串 prim → []；抽象 string prim → [string, string][]
      if (a0?.shape.k === "prim") {
        if ((a0.shape as { type?: string }).type !== "string") {
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        return abs(
          {
            k: "arr",
            element: abs(
              { k: "tuple", elements: [str("path"), str("path")] },
              undefined,
              undefined,
              "path",
            ),
          },
          undefined,
          undefined,
          "partial",
        );
      }
      // Bug 43：内建 brand 分类（同 keys/values）
      {
        // Bug 125：TA brand——["i", 元素域] 键值对（键集与 keys 同口径）；
        // 此前整族折 []，entries[0] 下标读被证 always-throw（false-throw）
        const ta = taEnumInfo(a0);
        if (ta) {
          const entry = (i: number): Abs =>
            abs({ k: "tuple", elements: [strLit(String(i)), ta.elem] }, undefined, undefined, "exact");
          return ta.view.k === "exact"
            ? abs(
                { k: "tuple", elements: Array.from({ length: ta.view.count }, (_, i) => entry(i)) },
                undefined,
                undefined,
                "exact",
              )
            : abs({ k: "arr", element: entry(0) }, undefined, undefined, "partial");
        }
        const brandEntries = boxedStringEnumEntries(a0);
        if (brandEntries) {
          return abs(
            {
              k: "tuple",
              elements: brandEntries.map(([k, v]) =>
                abs({ k: "tuple", elements: [strLit(k), v] }, undefined, undefined, "exact"),
              ),
            },
            undefined,
            undefined,
            "exact",
          );
        }
        if (builtinBrandNoEnumKeys(a0)) {
          // Bug 308 口径分离：此处是「**可枚举**自有键值对」视图——RegExp 的
          // `lastIndex` 非可枚举 ⇒ 不入（原生 Object.entries(/x/) = []）。
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        // Bug 84：用户类实例——公有可枚举自有键值对（私有槽 internal 剔除）
        const ciEntries = classInstanceEnumEntries(a0);
        if (ciEntries) {
          return abs(
            {
              k: "tuple",
              elements: ciEntries.map(([k, v]) =>
                abs({ k: "tuple", elements: [strLit(k), v] }, undefined, undefined, "exact"),
              ),
            },
            undefined,
            undefined,
            "exact",
          );
        }
      }
      // Bug 61：同 keys——抽象接收者 may ToObject 抛
      noteRecvMayNullish(a0, "Object.entries receiver ToObject");
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "hasOwn": {
      if (!a0) return boolPrim();
      if (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 4：抽象接收者（any/unknown/含 nullish 臂 union）may
      // RequireObjectCoercible 抛——接收者效应与键形态无关，同 keys 口径
      noteRecvMayNullish(a0, "Object.hasOwn receiver RequireObjectCoercible");
      const keyR = args[1] ? litValue(args[1]) : undefined;
      const key = keyR?.ok ? keyR.value : undefined;
      if (typeof key !== "string") return boolPrim();
      if (a0.shape.k === "obj") {
        const shape = a0.shape as { slots: Record<string, unknown>; open?: boolean };
        // Bug 84：internal 私有槽非自有属性（内部槽，GetOwnProperty 不可见）；
        // Bug 66：inherited 槽（errorBrandAbs 的 name——原型链解析）同折 false
        const own = shape.slots[key] as { internal?: boolean; inherited?: boolean } | undefined;
        if (own?.internal === true || own?.inherited === true) {
          return boolLit(false);
        }
        if (Object.prototype.hasOwnProperty.call(shape.slots, key)) return boolLit(true);
        // 闭 exact 对象确定无槽 → false；open/非 exact conf → 保守
        if (!shape.open && a0.conf === "exact") return boolLit(false);
        return boolPrim();
      }
      // Bug 84：用户类实例——internal 私有槽 → false；公有槽自有 → true；
      // 闭 inner 缺席键 → false（与 obj 臂同口径）
      {
        const inner = classInstanceInnerOf(a0);
        if (inner) {
          const slots = (inner.shape as ObjShape).slots;
          const slot = getSlot(slots, key);
          if (slot?.internal || slot?.inherited) return boolLit(false);
          if (slot && !slot.optional) return boolLit(true);
          if (slot?.optional) return boolPrim();
          return boolLit(false);
        }
      }
      // 族 58 · Bug 321：原型 brand（`X.prototype`）的**自有**成员判定——
      // 引擎已建模成员的原型的自有键集可精确列举（Error 家族：name/message
      // 是原型对象的自有数据属性；用户类：constructor + 自有方法/访问器）⇒
      // 折确定 boolean（原生 Object.hasOwn(Error.prototype,"name") === true，
      // 此前折保守 partial boolean）。未建模原型的键集仍开放 ⇒ 沿既有保守
      // boolean。判定单一事实源：exec/runtime/members.ts 的
      // protoBrandOwnStringKeys。
      if (a0.shape.k === "brand") {
        const ownKeys = protoBrandOwnStringKeys((a0.shape as { name?: string }).name ?? "");
        if (ownKeys) return boolLit(ownKeys.includes(key));
      }
      // R4a：Error 家族 brand——自有槽 presence 精确折（message/stack（/
      // errors/cause）自有 → true；name 是 inherited 原型链槽 → false；
      // 闭内层缺席键 → false——自有键集构造期静态可知；$set 公有覆写
      // inherited 槽已落地转自有不受影响）。其余内建 brand（URL/Map/…
      // 内层槽是建模槽非原生自有属性）保持保守不折。
      if (a0.shape.k === "brand" && isErrorCtorName((a0.shape as { name?: string }).name)) {
        const inner = a0.shape.shape;
        if (inner.shape.k === "obj" && !inner.shape.open) {
          const slot = getSlot(inner.shape.slots, key);
          if (slot?.internal || slot?.inherited) return boolLit(false);
          if (slot && !slot.optional) return boolLit(true);
          if (slot?.optional) return boolPrim();
          return boolLit(false);
        }
      }
      return boolPrim();
    }
    case "getPrototypeOf": {
      if (!a0) return unknown;
      if (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 4：抽象接收者 may ToObject 抛（prim 装箱合法，note 的
      // any/unknown/sum 过滤保持可靠）——同 keys 口径
      noteRecvMayNullish(a0, "Object.getPrototypeOf receiver ToObject");
      // Bug 76：symbol prim 接收者（无 lit 项——Symbol() 调用产物）→ 宿主
      // ToObject 特例定抛（node 实测：Symbol.prototype [ @@toPrimitive ]
      // requires that 'this' be a Symbol）；number/string/boolean/bigint
      // 装箱合法（protoOfRecv 投影）
      if (isSymbolAbs(a0)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 124：getPrototypeOf 陷阱优先——返回陷阱结果（Object/null，非对象
      // 非 null 字面量定抛 TypeError）；absent → protoOfRecv 靶原型
      {
        const trapR = proxyGetProtoTrap(a0!);
        if (trapR === "opaque") return unknown;
        if (trapR !== undefined) return trapR;
      }
      // 具体原型带 constructor 槽（.constructor.name 链可解）；不可判保持 unknown
      return protoOfRecv(a0);
    }
    case "setPrototypeOf": {
      // Object.setPrototypeOf(o, proto) → 返回 o；proto 为 object/null 时改原型
      // （分析侧：null → nullProto 标记；object → open，继承读不折 exact）。
      // proto 为 primitive 或缺参：原生 TypeError 硬抛
      if (!args.length) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const t0 = args[0];
      const p0 = args[1];
      // 缺 proto 实参（args[1] 为 JS undefined）≡ proto=undefined → TypeError
      if (!t0 || !p0) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 27：target nullish 字面量 → RequireObjectCoercible 定抛（此前
      // 只验 proto 侧，null/undefined target 原样返回）。prim target 原生
      // **合法**（步骤「Type(O) 非 Object → 返回原值」，node 实测
      // setPrototypeOf(1, {}) → 1）——维持返回 t0。
      if (t0.term?.op === "lit" && (t0.term.value === null || t0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // 抽象 target（any/unknown/含 nullish 臂 union）may nullish → may TypeError
      noteRecvMayNullish(t0, "Object.setPrototypeOf target may be nullish (RequireObjectCoercible)");
      const pvR = litValue(p0);
      const pv = pvR.ok ? pvR.value : undefined;
      if (p0.term?.op === "lit" && (pv === undefined || (pv !== null && typeof pv !== "object"))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 27：proto 为 prim 形态（symbol prim 无 lit 项；抽象
      // number/string/bool/bigint prim 同非对象）→ 定抛（Object prototype
      // may only be an Object or null）
      if (p0.shape.k === "prim") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // 抽象 proto（any/unknown/sum，无 lit 项——null-lit shape 是 unknown
      // 但已合法放行）→ may
      if (
        p0.term?.op !== "lit" &&
        (p0.shape.k === "any" || p0.shape.k === "unknown" || p0.shape.k === "sum")
      ) {
        recordMayThrow({ kind: "TypeError", cause: "Object.setPrototypeOf proto must be an object or null" });
      }
      // Bug 124：setPrototypeOf 陷阱优先（Object 口径）——falsy 字面量结果
      // 定抛 TypeError、truthy 返回 target（原型设定责任在陷阱，不落侧表）；
      // opaque handler 保守返回 target 不落标记
      {
        const trapR = proxyBooleanTrap(t0!, "setPrototypeOf", (t) => [t, p0]);
        if (trapR === "opaque") {
          recordMayThrow({ kind: "TypeError", cause: "Proxy setPrototypeOf trap may return falsy" });
          return t0;
        }
        if (trapR !== undefined) {
          if (trapR.term?.op === "lit" && trapR.term.value === false) {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          return t0;
        }
      }
      // Bug 120：不可扩展目标（freeze/seal/preventExtensions 标记）改原型
      // → TypeError（OrdinarySetPrototypeOf step 4）；SameValue 同原型豁免
      // 在先（step 3——frozen 重设同原型不抛）。判定与 Reflect.setPrototypeOf
      // 共享 protoChangeAllowed（Reflect 返 boolean、Object 抛——单一事实源）。
      if (!protoChangeAllowed(t0, p0)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return setProtoAbs(t0, p0);
    }
    case "assign": {
      // 单一实现（descriptor.ts 的 performObjectAssign）：obj/tuple/brand
      // 目标就地写（引用语义——别名与语句位可见）；prim/boxed 目标口径不变。
      return performObjectAssign(args);
    }
    case "is": {
      // SameValue：±0 区分、NaN 自等（与 -0 语义同族入口）
      const a0 = args[0];
      const a1 = args[1];
      if (a0 && a1 && isExactLit(a0) && isExactLit(a1)) {
        const va = (a0.term as { op: "lit"; value: unknown }).value;
        const vb = (a1.term as { op: "lit"; value: unknown }).value;
        return boolLit(Object.is(va, vb));
      }
      return boolPrim();
    }
    case "freeze": {
      // Bug 129：非空 TypedArray 冻结定抛（SetIntegrityLevel 对整数索引
      // 异质对象不可行——「Cannot freeze array buffer views with elements」）
      if (a0) {
        taSetIntegrityGuard(a0, "freeze");
        // Bug 301：Proxy 走陷阱派发（原生 SetIntegrityLevel：preventExtensions
        // + 逐键 defineProperty；falsy ⇒ TypeError）
        if (isProxyAbs(a0)) {
          proxySetIntegrity(a0, "frozen");
          return markExtState(a0, "frozen");
        }
        // Bug 291：键级标志落地（writable:false / configurable:false）
        applyIntegrityFlags(a0, "frozen");
        return markExtState(a0, "frozen");
      }
      return undefined;
    }
    case "seal": {
      // Bug 129：非空 TypedArray 密封同款定抛（length>0 可证 → 硬抛；
      // 抽象长度 → may）；preventExtensions/isFrozen/isSealed 原生对 TA
      // 不抛（V8 允许 preventExt）——不走守卫
      if (a0) {
        taSetIntegrityGuard(a0, "seal");
        // Bug 301：Proxy 走陷阱派发（同 freeze）
        if (isProxyAbs(a0)) {
          proxySetIntegrity(a0, "sealed");
          return markExtState(a0, "sealed");
        }
        // Bug 291：键级标志落地（configurable:false；writable 保持）
        applyIntegrityFlags(a0, "sealed");
        return markExtState(a0, "sealed");
      }
      return undefined;
    }
    case "preventExtensions": {
      // Bug 124：preventExtensions 陷阱优先（Object 口径）——falsy 字面量结果
      // 定抛 TypeError、truthy 返回 target（不落 nonext 标记）；opaque 保守
      // 返回 target 不落标记（陷阱可能在/可能 falsy → may）
      if (a0) {
        const trapR = proxyBooleanTrap(a0, "preventExtensions", (t) => [t]);
        if (trapR === "opaque") {
          recordMayThrow({ kind: "TypeError", cause: "Proxy preventExtensions trap may return falsy" });
          return a0;
        }
        if (trapR !== undefined) {
          if (trapR.term?.op === "lit" && trapR.term.value === false) {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          return a0;
        }
        return markExtState(a0, "nonext");
      }
      return undefined;
    }
    case "isFrozen": {
      const t = args[0];
      // ES：非对象（prim/null/undefined，含无实参）恒 frozen——不抛
      if (isPrimLike(t)) return boolLit(true);
      if (!t) return boolLit(false);
      // Bug 291：平凡真判定（不可扩展 + 每个自有属性不可配置 + 数据属性
      // 不可写）——此前只认 extState 标签
      return boolLit(integrityTruth(t, true));
    }
    case "isSealed": {
      const t = args[0];
      if (isPrimLike(t)) return boolLit(true);
      if (!t) return boolLit(false);
      // Bug 291：平凡真判定（不可扩展 + 每个自有属性不可配置）
      return boolLit(integrityTruth(t, false));
    }
    case "isExtensible": {
      const t = args[0];
      // ES：非对象恒不可扩展——不抛
      if (isPrimLike(t)) return boolLit(false);
      // Bug 284：Proxy 走 [[IsExtensible]]（派发 isExtensible 陷阱 + 可扩展性
      // 不变量校验）——此前无派发点 ⇒ 恒折 true（假绿 + 陷阱副作用丢失）。
      if (isProxyAbs(t!)) {
        const r = proxyIsExtensible(t!);
        if (r !== undefined) return r;
      }
      return boolLit(extStateOf(t!) === undefined);
    }
    case "defineProperty": {
      // Bug 8/39：target IsObject + 描述符校验抽共享 helper（defineProperties
      // 复用）；安装机器在 applyPropertyDescriptor（单一实现）
      validateDefineTarget(a0, "Object.defineProperty");
      // Bug 39：描述符校验先于 key 保守回退——原生 ToPropertyDescriptor 对
      // key 值不敏感，desc 定抛/may 抛都要记
      validateDescriptorObject(args[2], "Object.defineProperty");
      // Bug 124：defineProperty 陷阱优先（Object 口径）——falsy 字面量结果
      // 定抛 TypeError、truthy 返回 target（属性安装责任在陷阱，引擎不装
      // 槽/flags）；opaque 保守返回 target 不装
      if (a0) {
        const trapR = proxyBooleanTrap(
          a0,
          "defineProperty",
          (t) => [t, args[1] ?? undefAbs(), args[2] ?? undefAbs()],
        );
        if (trapR === "opaque") {
          recordMayThrow({ kind: "TypeError", cause: "Proxy defineProperty trap may return falsy" });
          return a0;
        }
        if (trapR !== undefined) {
          if (trapR.term?.op === "lit" && trapR.term.value === false) {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          return a0;
        }
      }
      // Bug 117：键走 ToPropertyKey 投影（propertyKeyOf：number/bigint/bool/
      // null/undefined/缺省 → 字符串键）。此前 typeof 门（string/number 才
      // 装）把 symbol/bool/null/undefined 键静默丢弃——无槽无 may-throw，
      // 后续成员读折 exact undefined。symbol 键 → 写路径同款 "@@X" 投影 +
      // symbolKey 标记（读路径 $get(o,"@@X") 同键）；Symbol("k") 等无名
      // symbol / 抽象键无可投影槽键——目标 open 化（读不折 exact
      // undefined），不装精确面。
      const kAbs = args[1] ?? undefAbs();
      const kStr = propertyKeyOf(kAbs);
      if (kStr !== undefined) {
        return applyPropertyDescriptor(a0!, kStr, args[2]!);
      }
      if (isSymbolAbs(kAbs)) {
        const sk = wellKnownSymbolSlotKey(kAbs);
        if (sk !== undefined) {
          return applyPropertyDescriptor(a0!, sk, args[2]!, { symbolKey: true });
        }
        if (a0 && a0.shape.k === "obj") {
          return abs({ ...(a0.shape as ObjShape), open: true } as ObjShape, undefined, undefined, a0.conf);
        }
        return a0;
      }
      return a0; // 抽象键：保守 no-op（现状）
    }
    case "defineProperties": {
      // Bug 8：defineProperties(target, props) —— 返回值恒为 target（原生
      // 语义）；逐（可枚举字符串键）描述符复用 defineProperty 机器。
      // props 缺省/nullish/prim → ToObject 定抛；any/unknown/sum → may；
      // tuple/arr/fn/brand 是对象（无字符串键槽 → 无操作）
      validateDefineTarget(a0, "Object.defineProperties");
      const props = args[1];
      // Bug 324：第二实参走 **ToObject** —— null/undefined ⇒ 定抛 TypeError；
      // 其它**原始值** ⇒ 装箱成零自有可枚举属性的包装器 ⇒ **不定义任何
      // 属性、不抛**（node 实测 defineProperties(o, 5/true/1n) OK）；非空
      // 字符串装箱后有下标键（"0"/"1"…）⇒ 每个「描述符」是字符（非对象）
      // ⇒ ToPropertyDescriptor 定抛；空串零键 ⇒ 无操作不抛。
      if (
        !props ||
        (props.term?.op === "lit" &&
          (props.term.value === null || props.term.value === undefined))
      ) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (props.shape.k === "prim") {
        const isStringProps =
          props.term?.op === "lit"
            ? typeof props.term.value === "string"
            : (props.shape as { type?: string }).type === "string";
        if (isStringProps) {
          if (props.term?.op === "lit") {
            if ((props.term.value as string).length > 0) {
              throw new NudoThrow(errorTypeAbs("TypeError"));
            }
          } else {
            // 抽象 string prim：长度未知 ⇒ 可能非空 ⇒ may TypeError
            recordMayThrow({
              kind: "TypeError",
              cause: "Object.defineProperties props must be an object",
            });
          }
        }
        // 其它 prim（number/boolean/bigint/symbol）⇒ 零自有可枚举属性 ⇒
        // 无操作（返回 target 原样，不装任何属性）
        return a0!;
      }
      if (props.shape.k === "any" || props.shape.k === "unknown" || props.shape.k === "sum") {
        recordMayThrow({
          kind: "TypeError",
          cause: "Object.defineProperties props must be an object",
        });
        return a0!;
      }
      let out = a0!;
      if (props.shape.k === "obj") {
        const ps = props.shape as unknown as {
          slots: Record<string, { value: Abs }>;
          open?: boolean;
          index?: unknown;
        };
        // 原生只取自有**可枚举**键（EnumerableTrue 过滤；含 symbol 键——
        // 经 "@@X" 投影槽，Bug 117 标记随安装传递）
        for (const key of ps.open || ps.index ? [] : enumKeys(ps.slots, props, true)) {
          const slot = ps.slots[key]! as { value: Abs; symbolKey?: boolean };
          validateDescriptorObject(slot.value, "Object.defineProperties");
          out = applyPropertyDescriptor(
            out,
            key,
            slot.value,
            slot.symbolKey ? { symbolKey: true } : undefined,
          );
        }
      }
      return out;
    }
    case "getOwnPropertyDescriptors": {
      // Bug 8：nullish 接收者定抛（gOPD 同口径）；closed obj → 逐自有键
      // exact 描述符对象（mkPropDescAbs / flags 与 gOPD 同口径）；
      // tuple → 索引 + length 描述符；字符串装箱 → 字符 + length（不可写）；
      // 其余 prim 装箱 → {}；open/抽象 → 开放 obj（槽值 descriptor|undefined）
      // Bug 1075：自有键面走 [[OwnPropertyKeys]]——**含 symbol 键**（原生
      // gOPDs 的结果对象带真 symbol 键；symbol 投影槽保留 + symbolKey 标记）
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      noteRecvMayNullish(a0, "Object.getOwnPropertyDescriptors receiver ToObject");
      const descSlotsOf = (
        entries: Array<[string, Abs]>,
        flagsOf: (key: string) => { writable: boolean; enumerable: boolean; configurable: boolean },
      ): Abs => {
        const slots: Record<string, { value: Abs }> = {};
        for (const [key, value] of entries) {
          const f = flagsOf(key);
          slots[key] = { value: mkPropDescAbs(value, f.writable, f.enumerable, f.configurable) };
        }
        return abs({ k: "obj", slots }, undefined, undefined, "exact");
      };
      /**
       * Bug 291：gOPDs 的**访问器**描述符——原生
       * `Object.getOwnPropertyDescriptors({get a(){}}).a` 是
       * `{get: ƒ, set: undefined, enumerable, configurable}`（**无**
       * value / writable 键）。此前 gOPDs 一律落数据描述符（value/
       * writable/enumerable/configurable）⇒ `.a.get` 折 undefined
       * （原生是函数）。与 gOPD 同口径（accessorPropDescAbs 单一实现）。
       */
      const descSlotsOfWithAccessors = (
        target: Abs,
        entries: Array<[string, Abs]>,
        flagsOf: (key: string) => { writable: boolean; enumerable: boolean; configurable: boolean },
        symbolKeyOf?: (key: string) => boolean,
      ): Abs => {
        const slots: Record<string, { value: Abs; symbolKey?: boolean }> = {};
        for (const [key, value] of entries) {
          const accDesc = accessorPropDescAbs(target, key);
          const f = flagsOf(key);
          const desc =
            accDesc ?? mkPropDescAbs(value, f.writable, f.enumerable, f.configurable);
          slots[key] = symbolKeyOf?.(key) ? { value: desc, symbolKey: true } : { value: desc };
        }
        return abs({ k: "obj", slots }, undefined, undefined, "exact");
      };
      if (a0.shape.k === "obj") {
        const os = a0.shape as {
          slots: Record<string, { value: Abs; symbolKey?: boolean }>;
          open?: boolean;
          index?: unknown;
        };
        if (os.open || os.index) {
          // 槽开放：可能有未知自有键 → 开放 obj（已知键精确，未知键按
          // open 语义折 descriptor|undefined 保守域）
          const slots: Record<string, { value: Abs; symbolKey?: boolean }> = {};
          for (const key of Object.keys(os.slots)) {
            // Bug 84：internal 私有槽非自有属性，不产 descriptor
            if ((os.slots[key] as { internal?: boolean })?.internal === true) continue;
            // Bug 1075：symbol 键**保留**（原生 gOPDs 走 [[OwnPropertyKeys]]
            // ——含 symbol 键；结果对象带该 symbol 键 ⇒ gOPS 看得到、
            // Object.keys / gOPN 看不到——靠 symbolKey 标记分流）
            const isSym = (os.slots[key] as { symbolKey?: boolean })?.symbolKey === true;
            const value = os.slots[key]!.value;
            const flags = getPropFlags(a0)?.get(key);
            // Bug 291：访问器描述符（get/set 键，无 value/writable）
            const accDesc = accessorPropDescAbs(a0, key);
            const desc =
              accDesc ??
              mkPropDescAbs(
                value,
                flags?.writable !== false,
                flags?.enumerable !== false,
                flags?.configurable !== false,
              );
            slots[key] = isSym ? { value: desc, symbolKey: true } : { value: desc };
          }
          return abs({ k: "obj", slots, open: true }, undefined, undefined, "partial");
        }
        // Bug 84：internal 私有槽非自有属性，不产 descriptor
        // Bug 1075：gOPDs 走 [[OwnPropertyKeys]]——**含 symbol 键**（原生
        // `Object.getOwnPropertyDescriptors({[Symbol.toStringTag]:1})` 的结果
        // 对象带该 symbol 键；此前按 symbolKey 过滤掉 ⇒ 结果对象少一个
        // 自有属性、键数少 1——自信的错值）
        const entries = Object.keys(os.slots)
          .filter((key) => (os.slots[key] as { internal?: boolean })?.internal !== true)
          .map((key) => [key, os.slots[key]!.value] as [string, Abs]);
        const flagsMap = getPropFlags(a0);
        return descSlotsOfWithAccessors(
          a0,
          entries,
          (key) => {
            const f = flagsMap?.get(key);
            return {
              writable: f?.writable !== false,
              enumerable: f?.enumerable !== false,
              configurable: f?.configurable !== false,
            };
          },
          (key) => (os.slots[key] as { symbolKey?: boolean })?.symbolKey === true,
        );
      }
      if (a0.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const entries: Array<[string, Abs]> = a0.shape.elements.map(
          (el, i) => [String(i), holes.includes(i) ? undefAbs() : el] as [string, Abs],
        );
        entries.push(["length", numLit(a0.shape.elements.length)]);
        // 数组 length：writable:true、不可枚举、不可配置（node 实测）；
        // 索引元素全自有可写可枚举可配置（gOPD tuple 分支同口径）
        // Bug 291：冻结/密封后的键级标志（flags 表记在 tuple 自身）
        const tFlags = getPropFlags(a0);
        return descSlotsOf(entries, (key) => {
          const f = tFlags?.get(key);
          return key === "length"
            ? {
                writable: f?.writable !== false,
                enumerable: false,
                configurable: false,
              }
            : {
                writable: f?.writable !== false,
                enumerable: true,
                configurable: f?.configurable !== false,
              };
        });
      }
      if (a0.term?.op === "lit" && typeof a0.term.value === "string") {
        // 字符串装箱：字符下标（不可写、可枚举、不可配置）+ length（全 false）
        const s = a0.term.value;
        const entries: Array<[string, Abs]> = Array.from({ length: s.length }, (_, i) => [
          String(i),
          strLit(s[i]!),
        ] as [string, Abs]);
        entries.push(["length", numLit(s.length)]);
        return descSlotsOf(entries, (key) =>
          key === "length"
            ? { writable: false, enumerable: false, configurable: false }
            : { writable: false, enumerable: true, configurable: false },
        );
      }
      if (a0.shape.k === "prim" && (a0.shape as { type?: string }).type !== "string") {
        // number/boolean/bigint/symbol 装箱：无自有字符串键
        return abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
      }
      // arr/brand/fn/sum/any/unknown：键集不可判 → 开放 obj
      return abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial");
    }
    case "getOwnPropertyNames": {
      // Bug 35：ToObject 接收者校验 + 自有**字符串**键投影（含不可枚举键
      // 与数组 length；symbol 键不在返回域——node 实测 gOPN([,1]) →
      // ["1","length"]、gOPN('ab') → ["0","1","length"]、gOPN(1) → []）
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0.term?.op === "lit" && typeof a0.term.value === "string") {
        // 字符串装箱：code unit 下标 + length
        const s = a0.term.value;
        const names = Array.from({ length: s.length }, (_, i) => String(i));
        names.push("length");
        return abs({ k: "tuple", elements: names.map((n) => strLit(n)) }, undefined, undefined, "exact");
      }
      if (a0.shape.k === "prim" && (a0.shape as { type?: string }).type !== "string") {
        // number/boolean/bigint/symbol 装箱：无自有字符串键（装箱 total 不抛）
        return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      }
      // Bug 43：brand 接收者——boxed String → 下标 + length（不可枚举也含）；
      // Error 家族 → message/stack 等自有槽；其余内建 brand → []
      /**
       * Bug 210：Proxy ownKeys 陷阱优先（[[OwnPropertyKeys]]）——原生
       * Object.getOwnPropertyNames(proxy) 走 handler 的 "ownKeys" 陷阱并只
       * 取其中的**字符串**键；陷阱结果过规范不变量（重复名 / 漏不可扩展靶的
       * 自有键 / 多余键 / 非字符串键 → 定抛 TypeError）。
       * 无陷阱 → 规范 step 6 转发**靶**的自有键面。
       */
      {
        const outcome = proxyOwnKeysTrapKeys(a0!);
        if (outcome.k === "keys") {
          return abs(
            {
              k: "tuple",
              elements: outcome.keys.filter((k) => {
                const v = k.term?.op === "lit" ? k.term.value : undefined;
                return typeof v === "string";
              }),
            },
            undefined,
            undefined,
            "exact",
          );
        }
        if (outcome.k === "opaque") {
          return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
        }
        // absent（无 ownKeys 陷阱）→ 靶的自有字符串键（原生转发 target 面）
        if (outcome.target) {
          const ownKeys = proxyTargetOwnStringKeys(outcome.target);
          if (ownKeys === undefined) {
            return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
          }
          return abs(
            { k: "tuple", elements: ownKeys.map((n) => strLit(n)) },
            undefined,
            undefined,
            "exact",
          );
        }
      }
      if (a0.shape.k === "brand") {
        // Bug 125：TA brand——与 keys 同键集（整数索引自有键；gOPN 原生
        // 不含 length——它是 %TypedArray%.prototype 访问器非自有键，node
        // 实测 gOPN(new Uint8Array(3)) → ["0","1","2"]）；长度开放 →
        // partial string[]
        {
          const ta = taEnumInfo(a0);
          if (ta) {
            return ta.view.k === "exact"
              ? abs(
                  {
                    k: "tuple",
                    elements: Array.from({ length: ta.view.count }, (_, i) => strLit(String(i))),
                  },
                  undefined,
                  undefined,
                  "exact",
                )
              : abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
          }
        }
        const brandName = (a0.shape as { name?: string }).name ?? "";
        const inner = (a0.shape as { shape?: Abs }).shape;
        if (brandName === "String" && inner && inner.shape.k === "obj") {
          const os = inner.shape as unknown as { slots: Record<string, unknown>; open?: boolean };
          if (!os.open) {
            const names = Object.keys(os.slots)
              .filter((k) => isEnumerableView(inner, k))
              .sort((a, b) => Number(a) - Number(b))
              // 下标升序在前、length 收尾（与原生 gOPN(new String) 序一致）
              .sort((a, b) => (a === "length" ? 1 : b === "length" ? -1 : 0));
            return abs({ k: "tuple", elements: names.map((n) => strLit(n)) }, undefined, undefined, "exact");
          }
        }
        if (isErrorCtorName(brandName) && inner && inner.shape.k === "obj") {
          const os = inner.shape as unknown as { slots: Record<string, unknown>; open?: boolean };
          if (!os.open) {
            // Bug 66：inherited 槽（name——原生经 X.prototype 原型链解析，
            // 非实例自有）不在 gOPN 面；message/stack（/errors/cause）自有
            // 不可枚举照列
            // 族 62 · 第 3 条：optional 槽（cause 的「键不可判」槽——装
            // unknown 值）不证明键存在 ⇒ 不入自有键清单（原生该情形下
            // gOPN 不可判；不得折出确定的 "cause" 键）。
            return abs(
              {
                k: "tuple",
                elements: Object.keys(os.slots)
                  .filter(
                    (n) =>
                      (os.slots[n] as { inherited?: boolean; optional?: boolean } | undefined)?.inherited !==
                        true &&
                      (os.slots[n] as { optional?: boolean } | undefined)?.optional !== true,
                  )
                  .map((n) => strLit(n)),
              },
              undefined,
              undefined,
              "exact",
            );
          }
        }
        // 族 58 · Bug 321/3：原型 brand（`X.prototype`）的 gOPN 面——自有键集
        // 可精确列举时（引擎已建模成员的原型）折精确元组；键集不可判（其余
        // 原型）⇒ 保守 partial string[]（**不**折空——空是自信的确切错值：
        // 原生 gOPN(Array.prototype) 有 41 个键）。
        {
          const protoOwn = builtinBrandOwnKeyNames(a0);
          if (protoOwn) {
            return abs(
              { k: "tuple", elements: protoOwn.map((n) => strLit(n)) },
              undefined,
              undefined,
              "exact",
            );
          }
          if (brandName.endsWith(".prototype")) {
            return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
          }
        }
        if (builtinBrandNoEnumKeys(a0)) {
          // Bug 308：gOPN 语义是「**全部**自有键」——RegExp 实例有自有的
          // `lastIndex`（ECMA-262 §22.2.6，非可枚举）⇒ 原生
          // gOPN(/x/) = ["lastIndex"]；此前与「零**可枚举**键」表共用 →
          // 折 exact 空元组（自信的确切错值）。source/flags/global 是原型
          // 访问器（非自有键）⇒ 不入。
          const brandOwn = builtinBrandOwnKeyNames(a0);
          if (brandOwn) {
            return abs(
              { k: "tuple", elements: brandOwn.map((n) => strLit(n)) },
              undefined,
              undefined,
              "exact",
            );
          }
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        // Bug 84：用户类实例——自有字符串键投影（含不可枚举；私有槽
        // Slot.internal 剔除——原生私有字段对 gOPN 不可见；此前整 brand
        // 保守 partial string[]）；Bug 66 inherited 槽（error 家族 name）同剔
        {
          const inner = classInstanceInnerOf(a0);
          if (inner) {
            const os = inner.shape as unknown as {
              slots: Record<string, { internal?: boolean; inherited?: boolean; symbolKey?: boolean }>;
            };
            const names = Object.keys(os.slots).filter(
              (k) =>
                os.slots[k]!.internal !== true &&
                os.slots[k]!.inherited !== true &&
                os.slots[k]!.symbolKey !== true,
            );
            return abs(
              { k: "tuple", elements: names.map((n) => strLit(n)) },
              undefined,
              undefined,
              "exact",
            );
          }
        }
      }
      if (a0.shape.k === "obj") {
        const os = a0.shape as { slots: Record<string, unknown>; open?: boolean; index?: unknown };
        if (!os.open && !os.index) {
          // 含不可枚举（defineProperty enumerable:false）——不过滤；
          // internal 私有槽剔除（Bug 84——内部槽对 gOPN 不可见）；
          // symbol 投影槽（"@@X"）剔除——原生 gOPN 只返回**字符串**键
          // （Bug 213 顺带：宿主对象自有 symbol 键投影后也不进 gOPN 面）
          return abs(
            {
              k: "tuple",
              elements: Object.keys(os.slots)
                .filter(
                  (n) =>
                    (os.slots[n] as { internal?: boolean })?.internal !== true &&
                    (os.slots[n] as { symbolKey?: boolean })?.symbolKey !== true,
                )
                .map((n) => strLit(n)),
            },
            undefined,
            undefined,
            "exact",
          );
        }
      } else if (a0.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const names = a0.shape.elements
          .map((_, i) => i)
          .filter((i) => !holes.includes(i))
          .map(String);
        names.push("length");
        return abs({ k: "tuple", elements: names.map((n) => strLit(n)) }, undefined, undefined, "exact");
      }
      // 抽象/开放面：may ToObject + 保守 string[]
      noteRecvMayNullish(a0, "Object.getOwnPropertyNames receiver ToObject");
      return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
    }
    case "getOwnPropertySymbols": {
      // Bug 35：nullish 接收者定抛
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      noteRecvMayNullish(a0, "Object.getOwnPropertySymbols receiver ToObject");
      // 族 65 · Bug 240：原生返回**自有 symbol 键数组**——键集可判时折精确
      // 元组（此前恒折保守 symbol[] ⇒ 生成器对象等「确定无自有 symbol 键」
      // 的目标被折成「可能有任意符号」的保守域）。键集不可判（开放 obj /
      // 抽象 brand / arr / any / unknown / sum / Proxy）⇒ 保守 symbol[]。
      const ownSyms = ownSymbolKeysAbs(a0);
      if (ownSyms) return ownSyms;
      return abs(
        { k: "arr", element: abs({ k: "prim", type: "symbol" }, undefined, undefined, "path") },
        undefined,
        undefined,
        "partial",
      );
    }
    case "getOwnPropertyDescriptor": {
      // Bug 35：nullish 接收者定抛；描述符 obj 或 undefined 投影
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      noteRecvMayNullish(a0, "Object.getOwnPropertyDescriptor receiver ToObject");
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      const key = typeof kv === "string" || typeof kv === "number" ? String(kv) : undefined;
      // Bug 8：与 getOwnPropertyDescriptors 共用的模块级 helper
      const mkDesc = mkPropDescAbs;
      // 键不可判 / 槽开放：可能有也可能没有 → descriptor | undefined 联合
      const maybeDesc = maybePropDescAbs;
      /**
       * Bug 57/84：访问器属性描述符（get/set thunk 包成 fn Abs；
       * 调用经 apply 钩子求值）——与 gOPDs 共用（单一实现）。
       */
      const accessorDescOf = (target: Abs, key: string): Abs | undefined =>
        accessorPropDescAbs(target, key);
      // Bug 300：Proxy 的 getOwnPropertyDescriptor 陷阱此前**从不派发**
      // （Proxy brand 落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒
      // 读 .value 定抛 TypeError）。与 Reflect 面同款实现（descriptor.ts 的
      // proxyGetOwnPropDescTrap：陷阱派发 + ToPropertyDescriptor 非对象定抛 +
      // 描述符补全）。非 Proxy 接收者返回 absent ⇒ 既有分支不受影响。
      const proxyDesc = proxyGetOwnPropDescTrap(a0, args[1]);
      if (proxyDesc.k === "desc") return proxyDesc.desc;
      if (proxyDesc.k === "opaque") return unknown;
      if (proxyDesc.k === "absent") {
        // Bug 300 顺带：Proxy **无** getOwnPropertyDescriptor 陷阱 ⇒ 原生
        // 转发**靶**的 [[GetOwnProperty]]（规范 Proxy [[GetOwnProperty]] 的
        // 陷阱缺席分支）。此前落「descriptor | undefined」并集 ⇒ 读 `.value`
        // 定抛 TypeError（wrong-exact：原生恒有描述符）。
        // 转发到靶走同函数的普通分支（靶不是 Proxy ⇒ 不会再次进入本段）。
        const parts = proxyPartsOf(a0);
        if (parts) {
          return evalObjectMethod("getOwnPropertyDescriptor", [
            parts.target,
            ...args.slice(1),
          ]);
        }
      }
      if (a0.shape.k === "obj") {
        const os = a0.shape as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
        if (os.open || os.index || key === undefined) return maybeDesc();
        // Bug 84：internal 私有槽非自有属性——GetOwnProperty 折 undefined
        if ((os.slots[key] as { internal?: boolean } | undefined)?.internal === true) {
          return undefAbs();
        }
        if (Object.prototype.hasOwnProperty.call(os.slots, key)) {
          // Bug 57：访问器侧表优先——访问器描述符 { get: ƒ|undefined,
          // set: ƒ|undefined, enumerable, configurable }（无 value/writable）
          const accDesc = accessorDescOf(a0, key);
          if (accDesc) return accDesc;
          const flags = getPropFlags(a0)?.get(key);
          return mkDesc(
            readProperty(a0, key),
            flags?.writable !== false,
            flags?.enumerable !== false,
            flags?.configurable !== false,
          );
        }
        if (a0.conf === "exact") return undefAbs();
        return maybeDesc();
      }
      /**
       * Bug 192 衍生：`A.prototype` 上 owner 类的**自有**实例方法 / 访问器是
       * A.prototype 的**自有属性**（原生 gOPD 折精确描述符：方法 →
       * {value: ƒ, writable:true, enumerable:false, configurable:true}；访问器 →
       * {get, set, enumerable:false, configurable:true}）。此前整族落
       * 「descriptor | undefined」并 ⇒ 读 .value / .enumerable 即定抛
       * （wrong-exact：原生恒有描述符）。
       */
      if (a0.shape.k === "brand" && key !== undefined) {
        const bname = (a0.shape as { name?: string }).name ?? "";
        const isProtoBrand = bname.endsWith(".prototype");
        const isClassValue = !isProtoBrand && classNameOfValue(a0 as object) === bname;
        const spec = getEvalClass(isProtoBrand ? bname.slice(0, -".prototype".length) : bname);
        // proto brand：owner 的**自有**实例方法 / 访问器（判定单一事实源在
        // members.ts 的 protoBrandOwnMember）；类值：owner 的**自有**静态
        // 方法 / 访问器（spec 表——静态面不沿原型链）。
        const ownAcc = isProtoBrand
          ? protoBrandOwnMember(bname, key)
            ? spec?.accessors?.[key]
            : undefined
          : isClassValue
            ? spec?.staticAccessors?.[key]
            : undefined;
        const ownMethod = isProtoBrand
          ? protoBrandOwnMember(bname, key)
            ? spec?.methods?.[key]
            : undefined
          : isClassValue
            ? spec?.staticMethods?.[key]
            : undefined;
        if (ownMethod !== undefined || ownAcc !== undefined) {
          if (ownAcc) {
            // 访问器描述符（无 value/writable 字段——原生同款）
            const wrapGet = (thunk: (t: Abs) => Abs): Abs =>
              absFunction(["_this"], {
                body: noBody,
                apply: (_args, thisVal) => thunk(thisVal ?? a0),
              });
            const wrapSet = (thunk: (t: Abs, v: Abs) => Abs): Abs =>
              absFunction(["_this", "value"], {
                body: noBody,
                apply: (a2, thisVal) => {
                  thunk(thisVal ?? a0, a2[0] ?? undefAbs());
                  return undefAbs();
                },
              });
            return abs(
              {
                k: "obj",
                slots: {
                  get: { value: ownAcc.get ? wrapGet(ownAcc.get) : undefAbs() },
                  set: { value: ownAcc.set ? wrapSet(ownAcc.set) : undefAbs() },
                  enumerable: { value: boolLit(false) },
                  configurable: { value: boolLit(true) },
                },
              },
              undefined,
              undefined,
              "exact",
            );
          }
          // 方法：value = 与成员读面**同一函数对象**（$get 复用同一驻留
          // ——A.prototype.m === new A().m 恒 true）
          return mkDesc($get(a0, key), true, false, true);
        }
      }
      // 族 58 · Bug 321/3：原型 brand（`X.prototype`）上 defineProperty 安装的
      // **自有数据槽**（内层 obj 槽 + 标志表）——原生 gOPD 折**精确描述符**
      // （原型对象上的自有属性）；此前整族落「descriptor | undefined」并 ⇒
      // 读 `.writable` / `.value` 即**定抛 TypeError**（wrong-**throw**：原生
      // 恒有描述符——含「writable:true 重定义后读出新的 writable」这条）。
      // 缺席键沿既有保守并（不折 undefined——内层 obj 闭但键集面另有归属）。
      if (a0.shape.k === "brand" && key !== undefined) {
        const pname = (a0.shape as { name?: string }).name ?? "";
        if (pname.endsWith(".prototype")) {
          const pInner = a0.shape.shape;
          if (pInner.shape.k === "obj" && !pInner.shape.open) {
            const pSlots = (pInner.shape as ObjShape)
              .slots as Record<string, { value: Abs; internal?: boolean; inherited?: boolean }>;
            if (Object.prototype.hasOwnProperty.call(pSlots, key)) {
              if (pSlots[key]!.internal === true || pSlots[key]!.inherited === true) {
                return undefAbs();
              }
              const accDesc = accessorDescOf(pInner, key);
              if (accDesc) return accDesc;
              // flags 表记在接收者 brand 上（applyPropertyDescriptor 的
              // setPropFlags(out, …)——out 为 brand）；原型槽的原地安装口径
              // （putProtoSlotsInPlace）把 flags 记在内层 obj 上——两者并查。
              const pFlags = getPropFlags(a0)?.get(key) ?? getPropFlags(pInner)?.get(key);
              return mkDesc(
                pSlots[key]!.value,
                pFlags?.writable !== false,
                pFlags?.enumerable !== false,
                pFlags?.configurable !== false,
              );
            }
          }
        }
      }
      // Bug 84：用户类实例——内层闭 obj 自有槽精确描述符（此前整
      // brand 保守 descriptor|undefined）。类字段原生描述符
      // writable/enumerable/configurable 全 true（defineProperty
      // 收紧的 flags 经 getPropFlags——flags 表记在内层 Abs 上）；
      // 动态 defineProperty 安装的访问器经内层侧表派发（同 obj 臂
      // Bug 57 口径——安装机器把侧表注册在新内层 obj Abs）；
      // internal 私有槽非自有属性 → undefined；闭内层缺席键 → undefined
      {
        const inner = classInstanceInnerOf(a0);
        if (inner && key !== undefined) {
          const slots = (inner.shape as ObjShape)
            .slots as Record<string, { value: Abs; internal?: boolean }>;
          if ((slots[key] as { internal?: boolean } | undefined)?.internal === true) {
            return undefAbs();
          }
          if (Object.prototype.hasOwnProperty.call(slots, key)) {
            const accDesc = accessorDescOf(inner, key);
            if (accDesc) return accDesc;
            // flags 表记在接收者 brand 上（applyPropertyDescriptor
            // setPropFlags(out, …)——out 为 brand）；构造期装的 flags
            // （extends Error 内层复用 errorBrandAbs 内层 obj）记在内层
            const flags = getPropFlags(a0)?.get(key) ?? getPropFlags(inner)?.get(key);
            return mkDesc(
              slots[key]!.value,
              flags?.writable !== false,
              flags?.enumerable !== false,
              flags?.configurable !== false,
            );
          }
          return undefAbs();
        }
      }
      // R4a：Error 家族 brand——内层闭 obj 自有槽带 flags 侧表
      // （errorBrandAbs 的 enumerable:false 记在内层；后续 defineProperty
      // 的 flags 记在外层 brand——brand 优先）折精确数据描述符；
      // inherited 槽（name——原生经 X.prototype 原型链解析非自有）与
      // internal 私有槽 → undefined；闭内层缺席键 → undefined（自有键集
      // 构造期静态可知）。动态 defineProperty 安装的访问器经内层侧表
      // 派发（同上臂 Bug 57 口径）。
      // Bug 308：RegExp 实例的**自有** `lastIndex` 数据属性（ECMA-262
      // §22.2.6）——可写、非可枚举、不可配置（node 实测
      // gOPD(/x/,"lastIndex").writable === true）；此前整 brand 落
      // 「descriptor | undefined」⇒ 读 .writable 即定抛 TypeError。
      // source/flags/global 等是**原型访问器**（非自有键）⇒ 不在此臂。
      if (key === "lastIndex" && isRegExpBrandAbs(a0)) {
        const rInner = a0.shape.shape;
        if (rInner.shape.k === "obj" && !rInner.shape.open) {
          const rSlots = (rInner.shape as ObjShape)
            .slots as Record<string, { value: Abs }>;
          if (Object.prototype.hasOwnProperty.call(rSlots, key)) {
            return mkDesc(rSlots[key]!.value, true, false, false);
          }
        }
        return undefAbs();
      }
      if (key !== undefined && a0.shape.k === "brand" && isErrorCtorName((a0.shape as { name?: string }).name)) {
        const inner = a0.shape.shape;
        if (inner.shape.k === "obj" && !inner.shape.open) {
          const slots = (inner.shape as ObjShape)
            .slots as Record<string, { value: Abs; internal?: boolean; inherited?: boolean }>;
          if (Object.prototype.hasOwnProperty.call(slots, key)) {
            if (slots[key]!.internal === true || slots[key]!.inherited === true) {
              return undefAbs();
            }
            const accDesc = accessorDescOf(inner, key);
            if (accDesc) return accDesc;
            const flags = getPropFlags(a0)?.get(key) ?? getPropFlags(inner)?.get(key);
            return mkDesc(
              slots[key]!.value,
              flags?.writable !== false,
              flags?.enumerable !== false,
              flags?.configurable !== false,
            );
          }
          return undefAbs();
        }
      }
      if (a0.shape.k === "tuple" && key !== undefined) {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        // Bug 291：冻结/密封后的键级标志（flags 表记在 tuple 自身）
        const tFlags = getPropFlags(a0)?.get(key);
        if (key === "length") {
          // 数组 length：writable:true、不可枚举、不可配置（node 实测）
          return mkDesc(
            numLit(a0.shape.elements.length),
            tFlags?.writable !== false,
            false,
            false,
          );
        }
        const idx = canonicalArrayIndex(key);
        if (idx !== undefined) {
          if (idx < a0.shape.elements.length && !holes.includes(idx)) {
            return mkDesc(
              a0.shape.elements[idx]!,
              tFlags?.writable !== false,
              true,
              tFlags?.configurable !== false,
            );
          }
          return undefAbs();
        }
        return maybeDesc();
      }
      if (a0.term?.op === "lit" && typeof a0.term.value === "string" && key !== undefined) {
        // 字符串装箱下标：writable:false、enumerable:true、configurable:false
        const s = a0.term.value;
        if (key === "length") return mkDesc(numLit(s.length), false, false, false);
        const idx = canonicalArrayIndex(key);
        if (idx !== undefined && idx < s.length) {
          return mkDesc(strLit(s[idx]!), false, true, false);
        }
        return undefAbs();
      }
      if (a0.shape.k === "prim" && (a0.shape as { type?: string }).type !== "string" && key !== undefined) {
        // number/boolean/bigint/symbol 装箱：无自有键（原型键非自有）
        return undefAbs();
      }
      return maybeDesc();
    }
    case "fromEntries": {
      // Bug 44：可迭代性 + 条目对象校验与投影（node v26 实测）：
      // - 缺省/nullish/非字符串 prim 接收者 → 定抛（not iterable）
      // - 字符串接收者可迭代，但条目是字符（非对象）：空串 → {}，非空 →
      //   定抛「Iterator value … is not an entry object」
      // - 条目非对象（nullish/prim/hole）→ 定抛；symbol 键**不** ToString
      //   ——直接作键保留（ES2024+ CreateDataProperty；引擎槽域字符串键
      //   → 开放对象）
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const slots: Record<string, { value: Abs }> = {};
      let open = false;
      let conf: Abs["conf"] = "exact";
      const putEntry = (k0: Abs | undefined, v1: Abs | undefined): void => {
        const value = v1 ?? undefAbs();
        conf = confJoin(conf, value.conf);
        if (!k0) {
          // Get(entry,"0") = undefined → 键 ToString(undefined) = "undefined"
          slots["undefined"] = { value };
          return;
        }
        const t = k0.term;
        if (t?.op === "lit") {
          slots[String(t.value)] = { value };
          return;
        }
        // symbol prim 键保留（不建模）或抽象键 → 键集不完备
        open = true;
      };
      const noteEntry = (el: Abs): void => {
        const ev = el.term?.op === "lit" ? el.term.value : undefined;
        if (el.term?.op === "lit" && (ev === null || ev === undefined || typeof ev !== "object")) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        const es = el.shape;
        if (es.k === "prim") {
          // 无 lit 项 prim（symbol/抽象 refined prim/字符串 prim 条目）：非对象
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        if (es.k === "never") return;
        if (es.k === "tuple") {
          if ((es as { rest?: Abs }).rest) open = true;
          putEntry(es.elements[0], es.elements[1]);
          return;
        }
        if (es.k === "obj") {
          const os = es as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
          if (os.open || os.index) open = true;
          putEntry(os.slots["0"]?.value, os.slots["1"]?.value);
          return;
        }
        // any/unknown/sum/fn/brand/eff/arr：条目性不可判 → may
        recordMayThrow({ kind: "TypeError", cause: "Object.fromEntries entry may not be an object" });
        open = true;
      };
      if (a0.shape.k === "prim") {
        if ((a0.shape as { type?: string }).type === "string") {
          const sv = litValue(a0);
          if (sv.ok) {
            if (sv.value === "") return abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          recordMayThrow({
            kind: "TypeError",
            cause: "Object.fromEntries string receiver yields non-object entries",
          });
          return abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial");
        }
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const rest = (a0.shape as { rest?: Abs }).rest;
        if (rest) {
          recordMayThrow({ kind: "TypeError", cause: "Object.fromEntries entries may not be objects" });
          open = true;
        }
        for (let i = 0; i < a0.shape.elements.length; i++) {
          if (holes.includes(i)) {
            // hole 迭代产出 undefined 条目 → 原生定抛（node 实测）
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          noteEntry(a0.shape.elements[i]!);
        }
        return open
          ? abs({ k: "obj", slots, open: true }, undefined, undefined, "partial")
          : abs({ k: "obj", slots }, undefined, undefined, conf);
      }
      if (a0.shape.k === "brand" && (a0.shape as { name?: string }).name === "Map") {
        // Map 条目即 [k,v]：键值表投影（shadow 键 → 开放）
        for (const entry of mapEntriesAbs(a0)) {
          if (entry.shape.k === "tuple") {
            putEntry(entry.shape.elements[0], entry.shape.elements[1]);
          } else {
            open = true;
          }
        }
        return open
          ? abs({ k: "obj", slots, open: true }, undefined, undefined, "partial")
          : abs({ k: "obj", slots }, undefined, undefined, conf);
      }
      // arr/obj/fn/brand/eff/any/unknown/sum：迭代性·条目性不可判 →
      // may + 开放 obj（含 {} —— 原生不可迭代抛，但 symbol 计算键迭代器
      // 不可见，不硬抛）
      recordMayThrow({
        kind: "TypeError",
        cause: "Object.fromEntries receiver may not be iterable or entries not objects",
      });
      return abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial");
    }
    case "groupBy": {
      // Bug 5：ES2024 Object.groupBy —— 校验面 + null 原型分组投影：
      // 键 ToPropertyKey 字符串槽 → 值元组（保序物化）；键集不可判 → 开放
      // null 原型 obj（未知键读 unknown，不假 undefined）
      const fold = foldGroupBy(a0, args[1], "Object.groupBy", "property");
      if (fold.status === "unknown") {
        // Bug 326：键集不可判 ⇒ 自有键集不完备（键家族折 partial，不得折
        // exact 空元组——native keys = ["[object Object]"]）
        return markKeySetOpen(
          markNullProtoObj(
            abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial"),
          ),
        );
      }
      const slots: Record<string, { value: Abs }> = {};
      let conf: Abs["conf"] = "exact";
      for (const g of fold.groups) {
        let vc: Abs["conf"] = "exact";
        for (const v of g.values) vc = confJoin(vc, v.conf);
        conf = confJoin(conf, vc);
        slots[g.slotKey] = {
          value: abs({ k: "tuple", elements: g.values }, undefined, undefined, vc),
        };
      }
      if (fold.open) {
        // Bug 326：组键集不可判（回调返回值非字面量 → 运行时 ToPropertyKey）
        // ⇒ 自有键集不完备 ⇒ 键家族折 partial（此前折 exact 空元组 = 自信
        // 的确切错值 ⇒ dts/zod/guard 三个产物面判「只接受空数组」）
        return markKeySetOpen(
          markNullProtoObj(
            abs({ k: "obj", slots, open: true }, undefined, undefined, "partial"),
          ),
        );
      }
      return markNullProtoObj(abs({ k: "obj", slots }, undefined, undefined, conf));
    }
    default:
      return undefined;
  }
}

