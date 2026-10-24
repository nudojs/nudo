/**
 * Object 静态面的 assign/描述符机器：assignSourceSlots（assign 源键投影）、
 * primTargetAssignThrows（装箱 prim target 抛错域）、ToPropertyDescriptor
 * 与安装（validateDefineTarget/validateDescriptorObject/
 * applyPropertyDescriptor）、描述符形态（mkPropDescAbs/maybePropDescAbs）
 * 与 [[Get]] 收口（readProperty）。
 *
 * Invariants:
 * - 键投影只取自有可枚举字符串键（enumerable:false / Slot.internal 槽剔除；
 *   boxed String 的 length 不复制、[[PrimitiveValue]] 内部槽已标不可枚举）；
 *   键集未知（open 空箱/arr/brand/sum/fn）→ undefined 保守降级。
 * - prim target 抛错域三档（M5 node 实测）：bigint 恒定抛；string 字面量
 *  （长 L）遇 canonical 下标 < L 的源键定抛、下标 ≥ L/非下标键安全、键集
 *   未知 → may；number/boolean wrapper expando 合法恒安全。
 * - applyPropertyDescriptor 是 DefineOwnProperty 单一实现（create/
 *   defineProperty/defineProperties 共用，不复制）：get/set 非函数且非
 *   undefined → 定抛；value × 访问器共存 → 定抛；访问器经 accessorTable
 *   侧表派发（getter 读折返回体、setter 写走侧表不误抛 writable:false）；
 *   描述符字段语义 = 新建属性缺省 false、已有属性仅显式 false 收紧；
 *   open/index 标记与 invariants/accessor 侧表随不可变更新迁移。
 * - Bug 292：描述符字段语义改按 ES2024 10.4.5 ToPropertyDescriptor 的
 *   **字段存在性**（HasProperty）——`get: undefined` 仍是「有 get 字段」
 *   （⇒ 与 value/writable 共存 → 定抛）、`writable/enumerable/configurable:
 *   undefined` ⇒ ToBoolean → false（收紧，不是「缺省保持原状」）。
 *   安装机器实现 ValidateAndApplyPropertyDescriptor（10.4.9）：目标已有键
 *   且**不可配置**时，标志/值/访问机制不可变（不可配置 / 枚举改 / 写门改 /
 *   值改 / 数据↔访问器互转 → 重定义失败）；目标为**新键**且不可扩展 → 失败。
 *   已有属性的标志**双向**应用描述符显式字段（未指定字段保持当前值）——
 *   enumerable:false → enumerable:true 可恢复（此前只单向收紧，永不恢复）。
 *   失败信号分两面：Object 口径定抛 TypeError（applyPropertyDescriptor）、
 *   Reflect 口径返 false 不抛（applyPropertyDescriptorVerdict）。
 * - Bug 300：Proxy [[GetOwnProperty]] 陷阱的单一实现
 *   （proxyGetOwnPropDescTrap：派发 + ToPropertyDescriptor 非对象 → 定抛 +
 *   completePropDescAbs 补全描述符）——Reflect 面在 builtins/reflect.ts
 *   调用；Object 面需在 builtins/object/methods.ts 接线（越界诉求见报告）。
 * - Bug 1074：Proxy [[GetOwnProperty]] 的**靶一致性不变量**（ES2024 10.5.5
 *   step 12.f）——靶自有 + 不可配置 + 不可写的数据属性，陷阱描述符的
 *   [[Value]] 必须 SameValue 靶上的实际值，否则原生定抛 TypeError
 *   （enforceProxyGetOwnPropDescInvariant；口径与 [[Get]] 面的
 *   exec/runtime/state.ts enforceProxyGetInvariant 同源）。
 * - Bug 86：tuple 接收者不再静默丢弃——下标键逐位装（增长段 hole、
 *   空描述符清 hole）、length 键截断/延长（非法 RangeError）、
 *   {writable:false} length 以 sealed 近似、frozen 相同值重定义放行。
 * - Bug 117：opts.symbolKey 沿用键的 symbol 投影标记（"@@X"）；
 *   wellKnownSymbolSlotKey 供 defineProperty/defineProperties 实参投影。
 * - Bug 118：value 字段直取槽中 Abs 落槽（不经 litValue 往返——
 *   fn/obj/tuple/bigint/symbol 值不再丢成「无 value 描述符」）。
 * - readProperty 是反射/枚举内建 [[Get]] 统一入口：accessorTable thunk
 *   优先（getter 求值）、数据槽兜底、setter-only 读 undefined。
 * - classifyAssignSet（Bug 128）是 Object.assign 逐键 [[Set]] 单一分类：
 *   自有访问器 setter / __proto__ 原型 setter（null|对象设原型、原始值
 *   忽略、抽象 open）/ 自有·继承非可写定抛 / 其余建自有键。
 * - Bug 210：Proxy [[OwnPropertyKeys]] 的单一实现（proxyOwnKeysTrapKeys
 *   派发 + enforceProxyOwnKeysInvariant 校验）——重复名 / 非字符串键 /
 *   漏靶的不可配置自有键 / 不可扩展靶的多余键 → 原生定抛 TypeError；
 *   不可判面（抽象键 / 抽象靶键集）→ 不抛（sound 保守）。
 *   proxyTargetOwnStringKeys / proxyTargetEnumerableStringKeys 给出靶的
 *   自有字符串键面（gOPN / Object.keys 用；internal·inherited·"@@X" 槽剔除）。
 *
 * 兄弟模块边界：methods.ts（evalObjectMethod）经导出复用安装机器；
 * readProperty 供 json.ts（stringify 读值）。
 */

import type { Abs } from "../../abs.ts";
import { abs, litValue, strLit, boolLit, numLit, unknown } from "../../abs.ts";
import {
  joinAbs,
  objOf,
  canonicalArrayIndex,
  setSlot,
  getSlot,
  setProtoAbs,
  getProtoAbs,
  isNullProtoObj,
  type ObjShape,
} from "../../objects.ts";
import { undefAbs } from "../../hof.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { $call } from "../../exec/call.ts";
import { $objAccessor, migrateAccessors, lookupObjAccessor, accessorTable } from "../../accessors.ts";
import { boolPrim, TYPED_ARRAY_ELEMENT } from "../shared.ts";
import {
  type PropFlags,
  getPropFlags,
  setPropFlags,
  markExtState,
  extStateOf,
  migrateInvariants,
  isEnumerableView,
  enumOwnKeys,
} from "../invariants.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import { classInstanceInnerOf } from "../../exec/class-registry.ts";
import { typedArrayEnumKeyView } from "./enum-entries.ts";
import { proxyPartsOf, proxyTrapOf } from "../../exec/match-iter.ts";
import { proxyTargetInnerObj } from "../../exec/runtime/state.ts";
import { isNullishLitAbs } from "../../surface.ts";

export function assignSourceSlots(src: Abs): Record<string, { value: Abs }> | undefined {
  const s = src.shape;
  if (s.k === "tuple") {
    const holes = s.holes ?? [];
    const slots: Record<string, { value: Abs }> = {};
    for (let i = 0; i < s.elements.length; i++) {
      if (!holes.includes(i)) slots[String(i)] = { value: s.elements[i]! };
    }
    return slots;
  }
  if (src.term?.op === "lit" && typeof src.term.value === "string") {
    const v = src.term.value;
    const slots: Record<string, { value: Abs }> = {};
    for (let i = 0; i < v.length; i++) slots[String(i)] = { value: strLit(v[i]!) };
    return slots;
  }
  if (s.k === "brand" && s.name === "String") {
    // String 包装（new String / Object('ab')）：下标槽可枚举、length 不可枚举
    //（原生 assign 不复制 length）；内部槽（[[PrimitiveValue]]，Bug 22）记
    // enumerable:false——枚举视图剔除；open 空箱键集未知 → undefined。
    // brand.shape 是内层 Abs（objOf 产物），槽在 inner.shape.slots。
    const inner = s.shape;
    if (inner.shape.k === "obj") {
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(inner.shape.slots)) {
        if (k === "length") continue;
        if (!isEnumerableView(inner, k)) continue;
        setSlot(slots, k, v);
      }
      if (Object.keys(slots).length > 0 || !inner.shape.open) return slots;
    }
    return undefined;
  }
  // Bug 125 残余：TypedArray 源——索引键是自有可枚举（ECMA-262 §10.4.5），
  // assign 按长度槽投影 "0".."n-1"（值 = 元素域）；长度不可判（from/of 产
  // 物无槽）→ undefined 保守降级，不再折 wrong-exact 空。
  if (s.k === "brand" && TYPED_ARRAY_ELEMENT[s.name] !== undefined) {
    const view = typedArrayEnumKeyView(src);
    if (view?.k === "exact") {
      const elem = TYPED_ARRAY_ELEMENT[s.name]!;
      const slots: Record<string, { value: Abs }> = {};
      for (let i = 0; i < view.count; i++) {
        slots[String(i)] = { value: abs({ k: "prim", type: elem }, undefined, undefined, "exact") };
      }
      return slots;
    }
    return undefined;
  }
  // Bug 84：用户类实例源（Object.assign({}, new A())）——拷贝公有可枚举自有
  // 槽（私有 Slot.internal / enumerable:false 剔除；此前 brand 源键集不可判
  // → undefined 保守降级，公有字段全丢）。evaluator runtimeAssignObject 与
  // evalObjectMethod("assign") 共用此处。
  {
    const inner = classInstanceInnerOf(src);
    if (inner) {
      const slots: Record<string, { value: Abs }> = {};
      for (const k of enumOwnKeys(inner, (inner.shape as ObjShape).slots)) {
        setSlot(slots, k, getSlot((inner.shape as ObjShape).slots as Record<string, { value: Abs }>, k)!);
      }
      return slots;
    }
  }
  if (s.k === "prim") return s.type === "string" ? undefined : {};
  if (s.k === "eff" || s.k === "never") return {}; // Promise 无自有可枚举键
  return undefined; // arr/brand/sum/fn/any/unknown…：键集未知
}

/**
 * M5：装箱 prim target 的 Object.assign 键写抛错域（node 实测）：
 * - bigint → 恒定抛 TypeError（`assign(1n)` 无源也抛）；
 * - string 字面量（长 L）→ 任一源的可枚举自有键含 canonical 数组下标
 *   k < L → String wrapper 下标属性只读 → strict 定抛 TypeError
 *   （`{0:'x'}` / `['x']` / `'cd'` 源）；下标 ≥ L（`{2:'x'}` 对 `'ab'`）/
 *   非下标键（`{a:1}`）→ 原生安全返回原始串；键集未知（open obj / arr /
 *   抽象）→ may；
 * - number / boolean → wrapper expando 合法 → 恒安全（原生返回原始值）。
 * symbol target 走既有 Bug 76 定抛路径，不进本判定（返回 "unhandled"）。
 * 非可枚举 / internal 键不写（与 mergeObj/enumKeys 同口径）不计入。
 */
export function primTargetAssignThrows(
  target: Abs,
  sources: Abs[],
): "definite" | "may" | "never" | "unhandled" {
  const shape = target.shape;
  if (shape.k !== "prim") return "unhandled";
  const t = shape.type;
  if (t === "bigint") return "definite";
  if (t === "number" || t === "boolean") return "never";
  if (t !== "string") return "unhandled";
  const tvR = litValue(target);
  if (!tvR.ok || typeof tvR.value !== "string") return "unhandled"; // 抽象 string 长度未知
  const L = tvR.value.length;
  if (L === 0) return "never";
  let may = false;
  for (const src of sources) {
    if (!src || typeof src !== "object" || !("shape" in src)) {
      may = true;
      break;
    }
    const s = src.shape;
    let keys: Iterable<string> | undefined;
    if (s.k === "obj") {
      if (s.open) {
        may = true;
        break;
      }
      const flags = getPropFlags(src);
      keys = Object.keys(s.slots).filter(
        (k) =>
          flags?.get(k)?.enumerable !== false &&
          ((s.slots as Record<string, { internal?: boolean }>)[k]?.internal !== true),
      );
    } else {
      const slots = assignSourceSlots(src);
      if (slots === undefined) {
        may = true;
        break;
      }
      keys = Object.keys(slots);
    }
    for (const k of keys) {
      const idx = canonicalArrayIndex(k);
      if (idx !== undefined && idx < L) return "definite";
    }
  }
  return may ? "may" : "never";
}

/**
 * Bug 8：defineProperty / defineProperties 共用的 target IsObject 校验——
 * 缺省 / nullish·prim 字面量 / prim 形态（symbol prim / 抽象 refined prim）
 * → 定抛；any/unknown/含 prim 臂 union → may（IsObject 一切 prim 均抛）。
 */
export function validateDefineTarget(target: Abs | undefined, what: string): void {
  if (!target || target.term?.op === "lit") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (target.shape.k === "prim") {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const mayNonObject = (m: Abs): boolean =>
    m.shape.k === "prim" ||
    m.shape.k === "any" ||
    m.shape.k === "unknown" ||
    (m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined));
  const k = target.shape.k;
  if (
    k === "any" ||
    k === "unknown" ||
    (k === "sum" && (target.shape as unknown as { members: Abs[] }).members.some(mayNonObject))
  ) {
    recordMayThrow({ kind: "TypeError", cause: `${what} target must be an object` });
  }
}

/**
 * Bug 8/39：ToPropertyDescriptor 的 IsObject 校验（defineProperty /
 * defineProperties 逐描述符共用）：缺省 / nullish 字面量 / prim 形态（含
 * symbol prim）→ 定抛「Property description must be an object」；any/
 * unknown/sum → may；tuple/arr/fn/brand/eff 是对象（原生合法）。
 */
export function validateDescriptorObject(descAbs: Abs | undefined, what: string): void {
  if (
    !descAbs ||
    (descAbs.term?.op === "lit" &&
      (descAbs.term.value === null || descAbs.term.value === undefined)) ||
    descAbs.shape.k === "prim"
  ) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (descAbs.shape.k === "any" || descAbs.shape.k === "unknown" || descAbs.shape.k === "sum") {
    recordMayThrow({ kind: "TypeError", cause: `${what} descriptor must be an object` });
  }
}

/**
 * Bug 292：目标的**当前**自有属性描述符（ValidateAndApplyPropertyDescriptor
 * 的 current 面）——obj / brand 内层 obj / tuple 三类。
 *
 * - exists：自有键存在（obj 走槽表自有判定；tuple 走「下标在界内且非 hole」
 *   或 "length"）；
 * - isAccessor：访问器侧表命中（访问器真身住侧表，槽里只留占位）；
 * - value：数据属性的当前值（Abs 原样，供 SameValue 比对）；
 * - writable/enumerable/configurable：当前标志——**缺省**取原生默认
 *   （数据属性可写/可枚举/可配置；数组 length 不可枚举/不可配置），
 *   标志表有记录则以其为准；**不可扩展等级**（frozen/sealed）额外强制
 *   不可写/不可配置（freeze/seal 的逐键落地由对象面负责，此处按等级兜底）；
 * - extensible：目标是否仍可扩展（seal/freeze/preventExtensions → 否）。
 */
type CurrentPropDesc = {
  exists: boolean;
  isAccessor: boolean;
  value: Abs | undefined;
  writable: boolean;
  enumerable: boolean;
  configurable: boolean;
  extensible: boolean;
};

function currentPropDesc(a0: Abs, key: string): CurrentPropDesc {
  const st = extStateOf(a0);
  const holder = a0.shape.k === "brand" ? a0.shape.shape : a0;
  const hst = holder !== a0 ? extStateOf(holder) : undefined;
  const frozen = st === "frozen" || hst === "frozen";
  const sealed = st === "sealed" || hst === "sealed";
  const nonext = st === "nonext" || hst === "nonext";
  if (holder.shape.k === "obj") {
    const slots = (holder.shape as ObjShape).slots as Record<string, { value: Abs }>;
    const own = Object.prototype.hasOwnProperty.call(slots, key);
    // 标志表：defineProperty 把 flags 记在**接收者**上（brand → brand；
    // obj → obj）；内层 obj 的表作为兜底（原型对象的原地安装口径）。
    const f =
      getPropFlags(a0)?.get(key) ??
      (holder !== a0 ? getPropFlags(holder)?.get(key) : undefined);
    return {
      exists: own,
      isAccessor: own && lookupObjAccessor(holder, key) !== undefined,
      value: own ? slots[key]?.value : undefined,
      writable: f?.writable ?? !frozen,
      enumerable: f?.enumerable ?? true,
      configurable: f?.configurable ?? !(frozen || sealed),
      extensible: !frozen && !sealed && !nonext,
    };
  }
  if (a0.shape.k === "tuple") {
    const sh = a0.shape as { k: "tuple"; elements: Abs[]; holes?: number[]; rest?: Abs };
    const holes = sh.holes ?? [];
    const idx = canonicalArrayIndex(key);
    const isLen = key === "length";
    const inRange =
      idx !== undefined && idx < sh.elements.length && !holes.includes(idx);
    const f = getPropFlags(a0)?.get(key);
    return {
      exists: isLen || inRange,
      isAccessor: false,
      value: isLen ? numLit(sh.elements.length) : inRange ? sh.elements[idx!] : undefined,
      writable: f?.writable ?? true,
      enumerable: f?.enumerable ?? (isLen ? false : true),
      configurable: f?.configurable ?? (isLen ? false : true),
      extensible: !frozen && !sealed && !nonext,
    };
  }
  // 其它形态（prim/arr/fn/brand 非 obj 内层/抽象）：自有键集不可判 ⇒ 保守
  // 「不存在且可扩展」（不凭空造抛）。
  return {
    exists: false,
    isAccessor: false,
    value: undefined,
    writable: true,
    enumerable: true,
    configurable: true,
    extensible: true,
  };
}

/**
 * Bug 292：SameValue 比对（描述符 [[Value]] 与当前值的不可变判定）。
 * - 两侧都是字面量 → Object.is；
 * - 一侧字面量一侧确定非字面量（fn/obj/…）→ 必不同（false）；
 * - 任一侧是抽象值（any/unknown/sum）或两侧皆非字面量 → **不可判**
 *   （undefined）——不抛（宁可漏抛不假抛）。
 */
function sameAbsValue(a: Abs | undefined, b: Abs | undefined): boolean | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (a === b) return true;
  const abstract = (x: Abs): boolean =>
    x.shape.k === "any" || x.shape.k === "unknown" || x.shape.k === "sum";
  if (abstract(a) || abstract(b)) return undefined;
  const ra = litValue(a);
  const rb = litValue(b);
  if (ra.ok && rb.ok) return Object.is(ra.value, rb.value);
  if (ra.ok !== rb.ok) return false; // 一侧字面量一侧确定非字面量 → 必不同
  return undefined; // 两侧皆非字面量（fn/obj…）→ 不可判
}

/**
 * Bug 8：defineProperty 的描述符读取 / 冲突校验 / 访问器侧表安装 /
 * 槽位与 flags 落地——defineProperties 逐键复用（单一机器，不复制）。
 * 返回应用描述符后的 target（不可变更新）。
 *
 * Bug 117：opts.symbolKey——键来自 symbol 投影（"@@iterator" 等，读写路径
 * symbolKeyOf 同口径）时，安装槽沿用该标记（JSON.stringify/枚举面跳过）。
 *
 * Bug 302：Object 口径（重定义失败 → **定抛 TypeError**）与 Reflect 口径
 * （重定义失败 → **返 false 不抛**，ES2024 10.4.9 ValidateAndApplyProperty-
 * Descriptor 返 false 的两种消费方式）分面——同一台机器，失败信号由
 * applyPropertyDescriptorVerdict 暴露（描述符**非法**（ToPropertyDescriptor
 * 错：非对象 / get-set 与 value-writable 共存 / get-set 不可调用）在两种
 * 口径下都定抛）。
 */
export function applyPropertyDescriptor(
  a0: Abs,
  key: string,
  descAbs: Abs,
  opts?: { symbolKey?: boolean },
): Abs {
  const r = applyPropertyDescriptorCore(a0, key, descAbs, opts);
  if (!r.ok) throw new NudoThrow(errorTypeAbs("TypeError"));
  return r.next;
}

/**
 * Bug 302：Reflect 口径的 [[DefineOwnProperty]]——重定义失败（不可配置属性
 * 改标志/值、不可扩展目标建新键、机制变化、冻结属性改值）返 ok:false
 * （原生 Reflect.defineProperty 返 false **不抛**）；描述符非法仍定抛。
 */
export function applyPropertyDescriptorVerdict(
  a0: Abs,
  key: string,
  descAbs: Abs,
  opts?: { symbolKey?: boolean },
): { ok: boolean; next: Abs } {
  return applyPropertyDescriptorCore(a0, key, descAbs, opts);
}

function applyPropertyDescriptorCore(
  a0: Abs,
  key: string,
  descAbs: Abs,
  opts?: { symbolKey?: boolean },
): { ok: boolean; next: Abs } {
  /** 重定义失败信号（Object 口径由外层包装成 TypeError；Reflect 口径返 false） */
  let rejected = false;
  /** 重定义失败（内层安装机器用：返回原 target 不落地） */
  const reject = (): Abs => {
    rejected = true;
    return a0;
  };
  /** 重定义失败（外层判定用：ok:false —— Reflect 口径返 false） */
  const rejectResult = (): { ok: boolean; next: Abs } => {
    rejected = true;
    return { ok: false, next: a0 };
  };
  const dslots = descAbs.shape.k === "obj" ? descAbs.shape.slots : {};
  /**
   * 描述符字段读取：区分「缺省」「显式 undefined」「字面量值」「函数/抽象」。
   * litValue 看不到函数字段（term 非 lit），但 get/set 字段存在性决定
   * 数据/访问器冲突判定，必须读 slot 本身。
   */
  const field = (k: string): { present: boolean; v: unknown } => {
    const s = dslots[k]?.value;
    if (!s) return { present: false, v: undefined };
    const lvR = litValue(s);
    if (lvR.ok) return { present: true, v: lvR.value };
    return { present: true, v: "fn-or-abstract" };
  };
  const getF = field("get");
  const setF = field("set");
  const valueF = field("value");
  const writableF = field("writable");
  const enumerableF = field("enumerable");
  const configurableF = field("configurable");
  // get/set 非函数且非 undefined → TypeError（Getter must be a function）
  const invalidAccessor = (f: { present: boolean; v: unknown }): boolean =>
    f.present && f.v !== undefined && f.v !== "fn-or-abstract";
  // Bug 20：原生 ToPropertyDescriptor 确定 TypeError——硬抛（catch 可
  // 吸收），不再 return unknown 吞掉 throws 面
  if (invalidAccessor(getF) || invalidAccessor(setF)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  /**
   * Bug 292：ToPropertyDescriptor 的**字段存在性**语义（ES2024 10.4.5）——
   * 源描述符**有**该属性才置对应字段（HasProperty 口径）：
   * - `get: undefined` 仍是「有 get 字段」⇒ 与 value/writable 共存 →
   *   TypeError（原生 Invalid property descriptor）；此前把「值 === undefined」
   *   当「字段缺省」⇒ `{get:undefined,value:1}` 静默折 1。
   * - `writable/enumerable/configurable: undefined` ⇒ ToBoolean → false
   *   （**收紧**，不是「缺省保持原状」）。
   * 访问器描述符 = 有 get 或 set 字段；数据描述符 = 有 value 或 writable 字段。
   */
  const hasGet = getF.present;
  const hasSet = setF.present;
  const hasValue = valueF.present;
  const hasWritable = writableF.present;
  const hasEnumerable = enumerableF.present;
  const hasConfigurable = configurableF.present;
  const accessorPresent = hasGet || hasSet;
  const genericPresent = hasValue || hasWritable;
  // 访问器字段与 value/writable 共存 → TypeError（Invalid property）
  if (accessorPresent && genericPresent) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // Bug 20：访问器描述符安装（此前只校验不安装——成员读折裸 undefined、
  // 写按新建数据属性 writable:false 误抛）。get/set 为 fn 形态 → 经
  // accessorTable 侧表派发（$get/$set 原型语义）；非 fn 抽象形态可调用
  // 性不可判定 → may TypeError，槽占位 unknown。
  const getFAbs = dslots["get"]?.value;
  const setFAbs = dslots["set"]?.value;
  // Bug 46：receiver 统一经 $call 第三参（bindThis impl 由派发注入首参）
  const getThunk = accessorPresent && getFAbs && getFAbs.shape.k === "fn"
    ? (t: Abs) => $call(getFAbs, [], t)
    : undefined;
  const setThunk = accessorPresent && setFAbs && setFAbs.shape.k === "fn"
    ? (t: Abs, v: Abs): Abs => {
        $call(setFAbs, [v], t);
        return t; // setter 返回值原生丢弃；目标重绑约定同字面量访问器（返 receiver）
      }
    : undefined;
  if (
    accessorPresent &&
    !getThunk &&
    !setThunk &&
    ((getF.present && getF.v !== undefined) || (setF.present && setF.v !== undefined))
  ) {
    recordMayThrow({
      kind: "TypeError",
      cause: "Object.defineProperty accessor must be callable",
    });
  }
  // Bug 118：value 字段直取槽中 Abs——此前经 litValue → JS 值 → litOf 往返，
  // fn/obj/tuple/brand/bigint/symbol 值全部丢成「无 value 描述符」（新键走
  // Bug 23 臂折 undefined、已有键保留旧值），后续成员读/调用折 exact
  // undefined 与幻影 TypeError。字段存在性由 valueF（上方）判定。
  const valueAbs = getSlot(dslots as Record<string, { value: Abs }>, "value")?.value;
  /**
   * ToBoolean（ES2024 10.4.5：显式 undefined → false）：
   * - 缺省（无该属性）→ undefined（**不**出现在返回的描述符里）；
   * - 字面量 → Boolean(v)（undefined → false）；
   * - 函数 → true（truthy）；抽象值 → undefined（不可判，不收紧）。
   * 此前把「值 === undefined」当「字段缺省」⇒ 显式 undefined 的布尔字段被
   * 当缺省（不收紧）——与原生不符。
   */
  const toBool = (k: string): boolean | undefined => {
    const s = dslots[k]?.value;
    if (s === undefined) return undefined; // 缺省
    const lvR = litValue(s);
    if (lvR.ok) return Boolean(lvR.value);
    if (s.shape.k === "fn") return true; // 函数 truthy
    return undefined; // 抽象 → 不可判
  };
  const writable = toBool("writable");
  const enumerable = toBool("enumerable");
  const configurable = toBool("configurable");
  /**
   * Bug 292：ValidateAndApplyPropertyDescriptor（ES2024 10.4.9）——
   * 目标是**已有键**时校验「不可配置 ⇒ 标志/值不可变」；目标是新键时补
   * **非可扩展门**（原生：不可扩展对象上建新键 → TypeError）。此前两者皆无
   * ⇒ ① writable:false 属性被 `{value:2}` 重定义（值真被改写）；② 不可配置
   * 属性的 writable/configurable/enumerable 被改（且 enumerable:true 永不
   * 恢复——标志表只单向置 false）；③ seal/freeze/preventExtensions 之后
   * defineProperty 新键静默建键。
   *
   * 校验口径（node v26 实测 + ES2024 10.4.9 step 4-5）：
   * - current.[[Configurable]] === false 时：
   *   ① Desc.[[Configurable]] 显式 true → 拒；
   *   ② Desc.[[Enumerable]] 显式且 ≠ current → 拒；
   *   ③ 机制变化（数据 ↔ 访问器）→ 拒（native 两种方向都拒）；
   *   ④ current 是访问器：Desc.[[Getter]]/[[Setter]] 显式且 ≠ current → 拒
   *      （引擎的访问器侧表只存 thunk、不存原函数值 ⇒ SameValue 不可判，
   *      **不抛**——宁可漏抛也不假抛，见报告「遗留」）；
   *   ⑤ current 是数据且 [[Writable]] === false：Desc.[[Writable]] 显式
   *      true → 拒；Desc.[[Value]] 显式且 ≠ current → 拒（SameValue）。
   * - current.[[Writable]] === true 时：值/可写随 Desc 改（可写 true→false
   *   收紧、值可换）——原生同款。
   */
  const cur = currentPropDesc(a0, key);
  // 旧局部名的等价物（安装机器用）：自有键存在 / 当前是访问器属性
  const exists = cur.exists;
  const wasAccessor = cur.isAccessor;
  if (!cur.exists) {
    // 新键：不可扩展目标 → TypeError（Cannot define property … not extensible）
    if (!cur.extensible) {
      return rejectResult();
    }
  } else if (cur.configurable === false) {
    if (hasConfigurable && configurable === true) {
      return rejectResult();
    }
    if (hasEnumerable && enumerable !== undefined && enumerable !== cur.enumerable) {
      return rejectResult();
    }
    // 机制变化（数据 ↔ 访问器）——不可配置属性上原生定抛
    if (genericPresent && cur.isAccessor) {
      return rejectResult();
    }
    if (accessorPresent && !cur.isAccessor) {
      return rejectResult();
    }
    if (!cur.isAccessor && cur.writable === false) {
      if (hasWritable && writable === true) {
        return rejectResult();
      }
      if (hasValue) {
        const same = sameAbsValue(valueAbs, cur.value);
        if (same === false) return rejectResult();
      }
    }
  }
  /**
   * 标志表（PropFlags）——**双向**应用描述符的显式字段：
   * - 新建属性：未指定字段默认 false（原生：新建属性的 enumerable/
   *   configurable/writable 缺省皆 false）；
   * - 已有属性：未指定字段保持当前值（原生 partial 语义），显式字段
   *   **覆盖**当前值（双向——此前只单向置 false ⇒ enumerable:true 永不
   *   恢复、configurable 不可回收）。
   */
  const flags: PropFlags = cur.exists
    ? cur.isAccessor
      ? { enumerable: cur.enumerable, configurable: cur.configurable }
      : { writable: cur.writable, enumerable: cur.enumerable, configurable: cur.configurable }
    : {};
  if (!cur.exists) {
    if (genericPresent) {
      flags.writable = hasWritable && writable !== undefined ? writable : false;
    }
    flags.enumerable = hasEnumerable && enumerable !== undefined ? enumerable : false;
    flags.configurable = hasConfigurable && configurable !== undefined ? configurable : false;
  } else {
    if (genericPresent && cur.isAccessor) {
      // 机制变化 accessor→data：[[Writable]] = 显式值或缺省 false
      flags.writable = hasWritable && writable !== undefined ? writable : false;
    } else if (hasWritable && writable !== undefined && !accessorPresent) {
      flags.writable = writable;
    }
    if (accessorPresent && !cur.isAccessor) {
      // 机制变化 data→accessor：[[Writable]] 不适用（访问器属性由侧表派发）
      delete flags.writable;
    }
    if (hasEnumerable && enumerable !== undefined) flags.enumerable = enumerable;
    if (hasConfigurable && configurable !== undefined) flags.configurable = configurable;
  }
  let out = a0;
  // Bug 86：tuple 接收者——此前只装 obj/brand，tuple/arr 上的描述符被静默
  // 丢弃（value 槽 / length 截断延长 / enumerable 标记全丢，只留无人读的
  // propFlags）。按容器写机制路由：下标键逐位装（越界增长段记 hole）、
  // length 键重塑（截断 / 延长段 hole）、访问器下标占位（arr-index 的
  // $idx 读不查侧表——getter 有则占位 unknown，不折 wrong-exact）。
  const putTuple = (t: Abs): Abs => {
    const sh = t.shape as { k: "tuple"; elements: Abs[]; holes?: number[]; rest?: Abs };
    const st = extStateOf(t);
    // Bug 86：flags 按元组存在性重导——length 恒自有（enumerable:false /
    // configurable:false）；已有下标元素默认可写可枚举可配置（重定义只收
    // 紧显式 false；此前沿用 obj 臂的「新键全 false」→ entries/keys 假剔除）。
    // Bug 292：改用**共享**的标志推导（currentPropDesc + 描述符显式字段
    // 双向覆盖）——tuple 的 length/下标与 obj 臂同口径（length 不可枚举/
    // 不可配置；下标可配置）。
    const tFlags: PropFlags = { ...flags };
    const frozenIdentical = (): boolean => {
      // frozen 上完全相同的数据重定义原生允许；可证不同 → TypeError
      if (valueF.present && valueF.v !== "fn-or-abstract") {
        const idxOf = canonicalArrayIndex(key);
        if (idxOf !== undefined && idxOf < sh.elements.length && !sh.holes?.includes(idxOf)) {
          const oldR = litValue(sh.elements[idxOf]!);
          if (oldR.ok && Object.is(oldR.value, valueF.v)) return true;
        }
        if (key === "length" && valueF.v === sh.elements.length) return true;
      }
      return false;
    };
    if (key === "length") {
      // length 上的访问器描述符：原生 TypeError（数组 length 不可改访问机制）
      // —— 重定义失败（Reflect 口径返 false 不抛）
      if (accessorPresent) return reject();
      if (!valueF.present) {
        // partial redefine（如 {writable:false}）：无值变化
        if (st === "frozen" && (writable === false || enumerable === false || configurable === false)) {
          return reject();
        }
        if (writable === false) {
          // Bug 86：length 不可写——以 sealed 近似（$arrMutContainer/
          // $idxSet 既有 sealed 臂：push/unshift/splice 与越界下标写定抛）
          markExtState(t, "sealed");
          setPropFlags(t, key, tFlags);
        }
        return t;
      }
      if (st === "frozen") {
        if (!frozenIdentical()) return reject();
        return t;
      }
      if (typeof valueF.v !== "number" || !Number.isInteger(valueF.v) || valueF.v < 0 || valueF.v > 4294967295) {
        // 非法 length 字面量（含 fn/obj 值经 ToNumber NaN）→ 原生 RangeError
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      const v = valueF.v as number;
      if (v > TUPLE_MATERIALIZE_CAP) {
        // 合法但巨大：不物化巨 tuple，降 arr（长度不可判）
        const joined = sh.elements.length
          ? sh.elements.reduce((x, y) => joinAbs(x, y))
          : unknown;
        const next = abs({ k: "arr", element: joinAbs(joined, undefAbs()) }, undefined, undefined, "partial");
        migrateInvariants(t, next);
        return next;
      }
      const els = sh.elements.slice(0, v);
      while (els.length < v) els.push(undefAbs());
      const holes: number[] = [];
      for (let h = sh.elements.length; h < v; h++) holes.push(h);
      const next = abs(
        { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined },
        undefined,
        undefined,
        t.conf,
      );
      migrateInvariants(t, next);
      if (writable === false) markExtState(next, "sealed");
      setPropFlags(next, key, tFlags);
      return next;
    }
    const idx = canonicalArrayIndex(key);
    if (idx === undefined) {
      // 非下标字符串键（expando）：tuple 无槽模型——维持现状 no-op（范围外）
      return t;
    }
    const existsHere = idx < sh.elements.length && !sh.holes?.includes(idx);
    // 不可扩展语义：新下标（≥ length 或 hole 位）→ TypeError
    // （重定义失败——Reflect 口径返 false 不抛）
    if ((st === "sealed" || st === "nonext") && !existsHere) {
      return reject();
    }
    if (st === "frozen") {
      if (accessorPresent || !frozenIdentical()) {
        return reject();
      }
      return t;
    }
    if (idx >= 4294967295 || idx + 1 > TUPLE_MATERIALIZE_CAP || (sh.rest !== undefined && idx >= sh.elements.length)) {
      // 非规范下标 / 巨大合法下标（原生稀疏数组）/ rest 尾覆盖域：不物化，
      // 降 arr（读/keys/in 保守）
      const joined = sh.elements.length
        ? sh.elements.reduce((x, y) => joinAbs(x, y))
        : unknown;
      const next = abs(
        { k: "arr", element: joinAbs(joinAbs(joined, undefAbs()), valueAbs ?? unknown) },
        undefined,
        undefined,
        "partial",
      );
      migrateInvariants(t, next);
      return next;
    }
    const els = [...sh.elements];
    const holes = [...(sh.holes ?? [])];
    while (els.length < idx) {
      holes.push(els.length); // 增长段中间槽不存在（hole）
      els.push(undefAbs());
    }
    // 装载：value 字段（Bug 118 直取 Abs）；访问器占位 unknown/undefined
    //（$idx 元组读不查 accessorTable——不折 wrong-exact）；空描述符按
    // Bug 23 落 undefined 键（清 hole——`"i" in a` 为 true）
    els[idx] = valueF.present
      ? (valueAbs ?? undefAbs())
      : accessorPresent
        ? (getF.present && getF.v !== undefined ? unknown : undefAbs())
        : undefAbs();
    const hi = holes.indexOf(idx);
    if (hi >= 0) holes.splice(hi, 1);
    const next = abs(
      { k: "tuple", elements: els, holes: holes.length > 0 ? holes : undefined },
      undefined,
      undefined,
      t.conf,
    );
    migrateInvariants(t, next);
    setPropFlags(next, key, tFlags);
    return next;
  };
  /**
   * 原型对象（`X.prototype`）的描述符**原地**安装——落进注册表持有的原型
   * 对象本体（内层 obj 的槽记录 + 访问器侧表 + 标志表）：
   * - 槽记录：内层 obj 的 slots 记录是**同一引用**（原型槽的既有约定——
   *   `A.prototype.x = 1` 落同一 memo 对象，见 members.ts chainProtoSlotOf
   *   注释），原地增删键 ⇒ 类注册表 / 实例原型链立即可见；
   * - 访问器侧表：装在**内层 obj Abs** 上——写门
   *   （exec/runtime/proto-set.ts 的 protoChainSetVerdict 经
   *   lookupObjAccessor(holder, key) 查得到 ⇒ getter-only → 拒写 /
   *   带 setter → 派发 setter）；
   * - 标志表：writable/enumerable/configurable 落在同一 Abs（写门读
   *   getPropFlags(holder).get(key).writable）。
   */
  const putProtoSlotsInPlace = (inner: Abs): void => {
    if (inner.shape.k !== "obj") return;
    const slots = inner.shape.slots as Record<
      string,
      { value: Abs; internal?: boolean; symbolKey?: boolean }
    >;
    if (!accessorPresent && valueF.present) {
      const prev = getSlot(slots, key);
      setSlot(slots, key, {
        value: valueAbs ?? undefAbs(),
        ...(prev?.internal ? { internal: true } : {}),
        ...(prev?.symbolKey || opts?.symbolKey ? { symbolKey: true } : {}),
      });
    } else if (accessorPresent) {
      // 访问器槽占位——真 getter 住侧表（读经侧表派发）
      setSlot(slots, key, {
        value: getF.present && getF.v !== undefined ? unknown : undefAbs(),
      });
    } else if (!exists) {
      // 空描述符也定义键（值 undefined）
      setSlot(slots, key, { value: undefAbs() });
    }
    // 机制变化（accessor→data）：旧 getter/setter 随键删除（否则写门仍见
    // 旧 setter、读仍走旧 getter）
    if (wasAccessor && !accessorPresent) {
      accessorTable.get(inner)?.delete(key);
    }
    if (getThunk || setThunk) {
      $objAccessor(inner, key, getThunk ?? null, setThunk ?? null);
    }
    setPropFlags(inner, key, flags);
  };
  const putSlots = (inner: Abs): Abs => {
    if (inner.shape.k !== "obj") return inner;
    let slots = { ...inner.shape.slots };
    // Bug 118：value 字段存在即落槽中 Abs（原 litOf 只认原语——fn/obj/
    // bigint/symbol 值丢弃）；覆写保留既有 internal/symbolKey 键标记
    //（$set 同款纪律）。accessor/空描述符分支不变（Bug 20/23）。
    if (!accessorPresent && valueF.present) {
      const prev = getSlot(slots as Record<string, { value: Abs }>, key) as {
        value: Abs;
        internal?: boolean;
        symbolKey?: boolean;
      } | undefined;
      slots = {
        ...slots,
        [key]: {
          value: valueAbs ?? undefAbs(),
          ...(prev?.internal ? { internal: true } : {}),
          ...(prev?.symbolKey || opts?.symbolKey ? { symbolKey: true } : {}),
        },
      };
    } else if (accessorPresent) {
      // Bug 20：访问器槽占位——读取经侧表派发折精确值（字面量返回体可
      // 折），直接槽读面不折裸 undefined；仅 setter（无 getter）原生读
      // undefined。
      slots = {
        ...slots,
        [key]: { value: getF.present && getF.v !== undefined ? unknown : undefAbs() },
      };
    } else if (!exists) {
      // Bug 23：ToPropertyDescriptor 成功即定义键——空描述符（无 value/
      // 访问器字段，如 Object.create(null, [{}]) 的元素）也落键（值
      // undefined、flags 全 false），`"0" in o` 不再假 absent；已有属性
      // partial redefine 只改指定字段，原值槽保持
      slots = { ...slots, [key]: { value: undefAbs() } };
    }
    const next = abs(
      // Bug 32：open/index 标记随槽更新保留（Object.create(proto, desc) 的
      // open 基座装描述符后不得闭化——proto 继承读须保持保守 unknown）
      { ...(inner.shape as ObjShape), slots } as ObjShape,
      undefined,
      undefined,
      inner.conf,
    );
    migrateInvariants(inner, next);
    // Bug 20：不可变更新迁移既有访问器；新访问器描述符注册侧表
    // （$get/$set 派发——写路径走 setter，不再按 writable:false 误抛）。
    // Bug 84：accessor→data 机制变化随键删除旧 getter/setter（omitKey），
    // 否则成员读仍走侧表旧 getter 折旧值、gOPD 误报访问器。
    migrateAccessors(inner, next, !accessorPresent && valueF.present ? key : undefined);
    // Bug 84：就地写回路径（Reflect.defineProperty → writeInPlace 复用原
    // Abs 身份）依赖 migrateAccessors(next, t0) 整表替换——omitKey 清空时
    // next 无表可迁（migrateAccessors 早退），原身份的旧 getter/setter 残留。
    // 内层有访问器表而迁移结果为空时，为 next 播种空表（整表替换语义可
    // 清除 t0 侧表项；Object.defineProperty 重绑路径查空表无害）。
    if (
      !accessorPresent &&
      valueF.present &&
      accessorTable.has(inner) &&
      !accessorTable.has(next)
    ) {
      accessorTable.set(next, new Map());
    }
    if (getThunk || setThunk) {
      $objAccessor(next, key, getThunk ?? null, setThunk ?? null);
    }
    return next;
  };
  if (out.shape.k === "tuple") {
    out = putTuple(out);
    return { ok: !rejected, next: out };
  }
  if (out.shape.k === "obj") {
    out = putSlots(out);
  } else if (out.shape.k === "brand") {
    /**
     * Bug 197/S3 越界配合：**原型对象**（`X.prototype`）的 defineProperty
     * 必须落进**注册表持有的那个原型对象**（protoBrandAbs 的内层 obj）——
     * 不可变更新会造出新 brand Abs，而类注册表 / 实例原型链仍持旧 brand ⇒
     * 装上的访问器与槽**无人可见**（写门 protoChainSetVerdict 也查不到）。
     * 原型槽的既有约定即**原地可变** ⇒ 此处照该口径原地装（其它 brand
     * ——类实例等——仍走不可变更新 + 语句位写回）。
     */
    if (out.shape.name.endsWith(".prototype")) {
      putProtoSlotsInPlace(out.shape.shape);
    } else {
      const inner = putSlots(out.shape.shape);
      if (inner !== out.shape.shape) {
        out = abs({ k: "brand", name: out.shape.name, shape: inner }, out.term, out.pred, out.conf);
      }
    }
  }
  setPropFlags(out, key, flags);
  return { ok: !rejected, next: out };
}

/** Bug 8：自有属性描述符对象（getOwnPropertyDescriptor(s) 共用的 exact 形态） */
export function mkPropDescAbs(
  value: Abs,
  writable: boolean,
  enumerable: boolean,
  configurable: boolean,
): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        value: { value },
        writable: { value: boolLit(writable) },
        enumerable: { value: boolLit(enumerable) },
        configurable: { value: boolLit(configurable) },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/** Bug 8：键不可判 / 槽开放时的 descriptor | undefined 保守并（gOPD(s) 共用） */
export function maybePropDescAbs(): Abs {
  return joinAbs(
    abs(
      {
        k: "obj",
        slots: {
          value: { value: unknown },
          writable: { value: boolPrim() },
          enumerable: { value: boolPrim() },
          configurable: { value: boolPrim() },
        },
        open: true,
      },
      undefined,
      undefined,
      "partial",
    ),
    undefAbs(),
  );
}

/**
 * Bug 57 根治：属性读取收口——反射/枚举内建（Object.entries/values/
 * getOwnPropertyDescriptor/JSON.stringify）的 [[Get]] 语义统一入口：
 * 访问器侧表（accessorTable）thunk 优先（getter 求值——引擎函数返回
 * Abs，可直接调用），数据槽兜底；无 getter 的 setter-only 属性原生读
 * undefined（占位口径巧合一致）。消灭「第 N 个忘记查 accessorTable
 * 直接读占位数据槽」的内建面。
 */
export function readProperty(o: Abs, key: string): Abs {
  const acc = lookupObjAccessor(o, key);
  if (acc) return acc.get ? acc.get(o) : undefAbs();
  const slots =
    o.shape.k === "obj"
      ? ((o.shape as ObjShape).slots as Record<string, { value: Abs }>)
      : undefined;
  return slots?.[key] ? slots[key]!.value : undefAbs();
}

/**
 * Bug 300：Proxy [[GetOwnProperty]] 陷阱派发（**Object / Reflect 两面共用**
 * 单一实现——Reflect 面在 builtins/reflect.ts 调本函数；Object 面需在
 * builtins/object/methods.ts 的 "getOwnPropertyDescriptor" 分支接线，
 * 属 A 分片地盘 ⇒ 越界诉求见报告）。
 *
 * - fn：陷阱可调用 → 派发（实参 (target, key)），结果经 ToPropertyDescriptor
 *   **非对象 → TypeError**（原生 TypeError，node v26 实测）；
 * - dead / opaque：陷阱不可调用 / 形态不可判 → opaque（调用方保守 unknown）；
 * - absent：无该陷阱 → 调用方回退靶的 [[GetOwnProperty]]。
 */
export function proxyGetOwnPropDescTrap(
  proxy: Abs,
  keyAbs: Abs | undefined,
): { k: "desc"; desc: Abs } | { k: "opaque" } | { k: "absent" } {
  const parts = proxyPartsOf(proxy);
  if (!parts) return { k: "absent" };
  const trap = proxyTrapOf(parts.handler, "getOwnPropertyDescriptor");
  if (trap.k === "fn") {
    const r = $call(trap.fn, [parts.target, keyAbs ?? undefAbs()], parts.handler);
    // ToPropertyDescriptor：非对象结果 → TypeError（原生同款）
    const s = r.shape;
    if (s.k === "prim" || s.k === "never") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (s.k === "any" || s.k === "unknown" || s.k === "sum") {
      return { k: "opaque" };
    }
    // Bug 1074：靶一致性不变量（[[GetOwnProperty]]）——违者原生定抛 TypeError
    enforceProxyGetOwnPropDescInvariant(parts.target, keyAbs, r);
    return { k: "desc", desc: completePropDescAbs(r) };
  }
  if (trap.k === "dead" || trap.k === "opaque") return { k: "opaque" };
  return { k: "absent" };
}

/**
 * 描述符视图（**ToPropertyDescriptor** 口径：缺省布尔位 = false）。
 *
 * `writable` / `enumerable` / `configurable` 三态：
 * - `true` / `false`：可判（缺省 ⇒ false；字面量 ⇒ 布尔值）；
 * - `undefined`：**不可判**（抽象 prim）⇒ 参与比较时一律**跳过**（sound，
 *   不拿「不可判」当「false」去制造假抛）。
 */
type DescView = {
  isAccessor: boolean;
  get?: Abs;
  set?: Abs;
  value?: Abs;
  writable: boolean | undefined;
  enumerable: boolean | undefined;
  configurable: boolean | undefined;
};

/**
 * Bug 1074：Proxy [[GetOwnProperty]] 的**靶一致性**校验（ES2024 10.5.5
 * step 6.a / 7.a–7.c + node v26 实测的更严档）。
 *
 * **修前**：引擎**照抄陷阱的值**（`Object.getOwnPropertyDescriptor(p,"a").value`
 * 折 exact 2）⇒ 自信的错值（原生抛 TypeError）。
 *
 * **口径来源**：以 **node v26.10.0 实测矩阵**为准（靶 present/absent ×
 * 陷阱 present/absent × configurable/writable/enumerable 全组合 = 82 例；
 * 候选谓词与原生**零偏差**）。规则：
 * 1. 靶**无**该自有键 ⇒ 陷阱描述符必须 `configurable`（否则原生抛）；
 * 2. 靶**有**该自有键而陷阱报的 `configurable` 与靶不一致 ⇒ 原生抛；
 * 3. 靶是不可配置的数据属性 ⇒ 陷阱报的 writable / enumerable 必须与靶
 *    **一致**，且靶不可写时 [[Value]] 必须 SameValue（否则原生抛）；
 * 4. 靶是访问器属性而陷阱报数据描述符 ⇒ 原生抛（反之亦然）。
 *
 * 与 [[Get]] 面 `exec/runtime/state.ts` 的 `enforceProxyGetInvariant` 同源
 * （那处归并行 worker 拥有，故此处按同一口径**就地复刻**，只读参照未改它）。
 *
 * **保守面（不抛，sound）**：抽象键 / symbol 投影键（靶自有 symbol 面不可判）/
 * 靶不是对象 / 陷阱结果不可判 / 标志位或值不可判 / 访问器 get·set 身份不可比。
 */
export function enforceProxyGetOwnPropDescInvariant(
  target: Abs,
  keyAbs: Abs | undefined,
  trapResult: Abs,
): void {
  const kvR = keyAbs ? litValue(keyAbs) : undefined;
  const kv = kvR?.ok ? kvR.value : undefined;
  if (typeof kv !== "string" && typeof kv !== "number") return; // 抽象键 / symbol 键 → 不可判
  const key = String(kv);
  const inner = proxyTargetInnerObj(target);
  if (!inner) return;
  const trapView = descViewOf(trapResult);
  if (!trapView) return; // 陷阱结果不是可判对象 → 不可判（非对象已在调用方定抛）
  const slots = (inner.shape as ObjShape).slots as Record<string, { value: Abs }>;
  const hasSlot = Object.prototype.hasOwnProperty.call(slots, key);
  const acc = lookupObjAccessor(inner, key);
  if (!hasSlot && acc === undefined) {
    // 规则 1：靶无该自有键 ⇒ 陷阱描述符必须可配置
    if (trapView.configurable === false) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    return;
  }
  // 靶侧**有效**标志（默认皆 true；sealed ⇒ configurable=false；
  // frozen ⇒ configurable/writable/enumerable 全 false）
  const st = extStateOf(inner);
  const flags = getPropFlags(inner)?.get(key);
  const targetWritable = flags?.writable !== false && st !== "frozen";
  const targetEnumerable = flags?.enumerable !== false && st !== "frozen";
  const targetConfigurable =
    flags?.configurable !== false && st !== "frozen" && st !== "sealed";
  // 规则 2：可配置性必须一致
  if (trapView.configurable !== undefined && trapView.configurable !== targetConfigurable) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (acc !== undefined) {
    // 规则 4：靶是访问器 ⇒ 陷阱也必须报访问器描述符
    if (!trapView.isAccessor) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    return; // get / set 的**身份**不可比 → 不抛（sound）
  }
  // 靶是数据属性 ⇒ 陷阱不得报访问器描述符
  if (trapView.isAccessor) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 规则 3：靶不可配置 ⇒ writable / enumerable 冻结；靶不可写时值也冻结
  if (targetConfigurable) return;
  if (trapView.writable !== undefined && trapView.writable !== targetWritable) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (trapView.enumerable !== undefined && trapView.enumerable !== targetEnumerable) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (targetWritable) return;
  const a = litValue(slots[key]!.value);
  const b = trapView.value ? litValue(trapView.value) : undefined;
  if (!a.ok || !b || !b.ok) return; // 值不可判 → 不抛
  if (!Object.is(a.value, b.value)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/**
 * 描述符视图（ToPropertyDescriptor 口径）。
 *
 * 数据位（`value` / `writable`）与访问器位（`get` / `set`）**同时**出现 ⇒
 * 原生 ToPropertyDescriptor 定抛 TypeError（"Invalid property descriptor.
 * Cannot both specify accessors and a value or writable attribute"）。
 */
function descViewOf(desc: Abs): DescView | undefined {
  if (desc.shape.k !== "obj") return undefined;
  const slots = (desc.shape as ObjShape).slots as Record<string, { value: Abs }>;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(slots, k);
  const slotVal = (k: string): Abs | undefined => slots[k]?.value;
  const boolOf = (k: string): boolean | undefined => {
    const v = slotVal(k);
    if (v === undefined) return false; // 缺省 → ToPropertyDescriptor 默认 false
    const lvR = litValue(v);
    if (lvR.ok) return Boolean(lvR.value);
    const sh = v.shape.k;
    if (sh === "obj" || sh === "arr" || sh === "tuple" || sh === "fn" || sh === "brand") return true;
    return undefined; // 抽象 prim → 不可判
  };
  const hasGet = has("get");
  const hasSet = has("set");
  const hasValue = has("value");
  const hasWritable = has("writable");
  const isAccessor = hasGet || hasSet;
  if (isAccessor && (hasValue || hasWritable)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  return {
    isAccessor,
    get: slotVal("get"),
    set: slotVal("set"),
    value: slotVal("value"),
    writable: boolOf("writable"),
    enumerable: boolOf("enumerable"),
    configurable: boolOf("configurable"),
  };
}

/**
 * Bug 300：CompletePropertyDescriptor（ES2024 10.4.9）——把陷阱返回的
 * **部分**描述符补全为完整描述符对象（缺省字段取原生默认：数据描述符的
 * writable/enumerable/configurable 缺省 false；访问器描述符的 get/set 缺省
 * undefined）。原生 Reflect/Object.getOwnPropertyDescriptor 返的是补全后的
 * 描述符（不是 handler 的原对象）——两面口径一致。
 */
export function completePropDescAbs(desc: Abs): Abs {
  if (desc.shape.k !== "obj") return desc;
  const slots = (desc.shape as ObjShape).slots as Record<string, { value: Abs }>;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(slots, k);
  const slotVal = (k: string): Abs | undefined => slots[k]?.value;
  const boolOf = (k: string): boolean => {
    const v = slotVal(k);
    if (v === undefined) return false; // 缺省 → 原生默认 false
    const lvR = litValue(v);
    if (lvR.ok) return Boolean(lvR.value);
    // 对象形恒真；其余（抽象 prim）不可判 → 落缺省 false
    const sh = v.shape.k;
    if (sh === "obj" || sh === "arr" || sh === "tuple" || sh === "fn" || sh === "brand") {
      return true;
    }
    return false;
  };
  const accessor = has("get") || has("set");
  if (accessor) {
    return abs(
      {
        k: "obj",
        slots: {
          get: { value: slotVal("get") ?? undefAbs() },
          set: { value: slotVal("set") ?? undefAbs() },
          enumerable: { value: boolLit(boolOf("enumerable")) },
          configurable: { value: boolLit(boolOf("configurable")) },
        },
      },
      undefined,
      undefined,
      "exact",
    );
  }
  return mkPropDescAbs(
    slotVal("value") ?? undefAbs(),
    boolOf("writable"),
    boolOf("enumerable"),
    boolOf("configurable"),
  );
}

/**
 * Bug 117：well-known symbol 实参（Symbol.iterator 等宿主 symbol lit——
 * state.ts litAbsFromJs 保留 term）→ defineProperty 写路径键投影
 * "@@X"（transpile symbolKeyOf 静态投影同口径）。Symbol("k") 等无名
 * symbol / 抽象 symbol → undefined（无可投影槽键）。
 */
export function wellKnownSymbolSlotKey(a: Abs | undefined): string | undefined {
  if (!a || a.term?.op !== "lit" || typeof a.term.value !== "symbol") return undefined;
  const desc = (a.term.value as symbol).description;
  if (typeof desc !== "string" || !desc.startsWith("Symbol.")) return undefined;
  return `@@${desc.slice("Symbol.".length)}`;
}

/**
 * Bug 230：Proxy [[Delete]] 规范不变量（ES2024 10.5.9 step 10）——
 * deleteProperty 陷阱返回 **true** 时，若靶上该键是**不可配置**自有属性 ⇒
 * 原生定抛 TypeError（"'deleteProperty' on proxy: ..."）。此前引擎直接返
 * true（与原生不符——假绿）。
 *
 * 判据：靶上**自有**该键 + 该键不可配置（flags.configurable === false /
 * 靶 frozen / 靶 sealed）⇒ 抛。靶无该自有键 / 该键可配置 / 键不可判
 * （抽象键）→ 不抛（sound 保守）。
 *
 * 消费方：builtins/reflect.ts 的 Reflect.deleteProperty 臂（delete 运算符
 * 路径在 exec/runtime/members.ts 的 $del——该文件归 S14，越界诉求见报告）。
 */
export function enforceProxyDeleteInvariant(proxy: Abs, keyAbs: Abs | undefined): void {
  const parts = proxyPartsOf(proxy);
  if (!parts) return;
  const kvR = keyAbs ? litValue(keyAbs) : undefined;
  const kv = kvR?.ok ? kvR.value : undefined;
  if (typeof kv !== "string" && typeof kv !== "number") return; // 抽象键 → 不可判
  const key = String(kv);
  const inner = proxyTargetInnerObj(parts.target);
  if (!inner) return;
  const slots = (inner.shape as ObjShape).slots as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) return; // 靶无该自有键
  const st = extStateOf(inner);
  const nonConfigurable =
    getPropFlags(inner)?.get(key)?.configurable === false || st === "frozen" || st === "sealed";
  if (!nonConfigurable) return;
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/**
 * Bug 200/S4 接线：**brand 目标**（原型对象 `A.prototype`）——原生
 * `Object.assign(A.prototype, {…})` 写的是原型对象的**自有属性**（for-in
 * 沿原型链可见）。引擎的原型对象 = protoBrandAbs(name) 的**内层 obj** ⇒
 * 逐键写该内层 obj 的槽（**原地**）——读侧
 * （exec/runtime/containers/iterate.ts 的 brandProtoEnumerableKeys）枚举的
 * 正是内层 obj 的可枚举槽，写侧必须落在同一处；不可变更新会造出新 brand，
 * 类注册表 / 实例原型链仍持旧 brand ⇒ 写了也看不见。
 *
 * [[Set]] 语义同 Object.assign 的其它目标（Set(target, key, value,
 * throw=true)）：自有访问器 → setter（无 setter → TypeError）；自有非可写
 * 数据属性 → TypeError；其余 → 建/覆写自有数据槽。
 *
 * 消费方：exec/class/assign.ts 的 runtimeAssignObject（Object.assign 的
 * **运行时**路径——invoke.ts 分派到它，非 builtins/object/methods.ts 的
 * evalObjectMethod("assign")）与 builtins/object/methods.ts 的 assign 臂。
 *
 * @param target 目标（brand——原型对象）
 * @param entries 源的可枚举自有键值对（值已按源 [[Get]] 语义求值——getter
 *   由调用方求值；本函数只做目标侧 [[Set]] 分类与写）
 */
/**
 * 写进 brand 内层 obj 的键值对。
 * Bug 295：条目可选带第三元 `symbolKey`（true = 该键是**真 symbol 键**）。
 * 原生 `Object.assign(A.prototype, {a:1, [Symbol.toStringTag]:2})` 复制的是
 * symbol 键本身——引擎内部把 symbol 键投影成 "@@X" 槽名，若标记在入参处
 * 丢失，symbol 键会退化成普通字符串键（`"@@toStringTag"` 成为可枚举字符串
 * 属性 ⇒ for-in / keys 家族把它当真键发布）。第三元缺席 = 普通字符串键。
 */
export type BrandAssignEntry = [string, Abs] | [string, Abs, boolean];

export function assignIntoBrandInner(target: Abs, entries: BrandAssignEntry[]): void {
  const inner = target.shape.k === "brand" ? target.shape.shape : undefined;
  if (!inner || inner.shape.k !== "obj") return;
  const slots = (inner.shape as ObjShape).slots as Record<string, { value: Abs }>;
  for (const entry of entries) {
    const [k, v] = entry;
    const symbolKey = entry.length > 2 ? entry[2] === true : false;
    const ownAcc = lookupObjAccessor(inner, k);
    if (ownAcc) {
      if (!ownAcc.set) throw new NudoThrow(errorTypeAbs("TypeError"));
      ownAcc.set(target, v);
      continue;
    }
    if (getSlot(slots, k) !== undefined && getPropFlags(inner)?.get(k)?.writable === false) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    setSlot(slots, k, symbolKey ? { value: v, symbolKey: true } : { value: v });
  }
}

/**
 * Bug 128：Object.assign 逐键 [[Set]]（OrdinarySet）分类——evaluator
 * mergeObj（就地）与 evalObjectMethod("assign")（不可变）共用。原生
 * Object.assign 对目标逐键执行 Set(target, key, value, throw=true)：
 * - 自有访问器 → setter 调用（getter-only → TypeError）
 * - "__proto__" 键非自有且目标非 null-proto → Object.prototype 的原型
 *   setter：null / 对象值 → 设原型；原始值 → 静默忽略（原型污染面）
 * - 自有非可写数据属性 → TypeError
 * - 继承访问器（原型链 ≤8 层）→ setter；继承非可写数据 → TypeError；
 *   继承可写 / 链尽头 → 建自有键
 * 此前直写自有槽：继承面全忽略。
 */
export type AssignSetPlan =
  | { act: "write" }
  | { act: "ignore" }
  | { act: "open" }
  | { act: "proto"; proto: Abs }
  | { act: "setter"; set: (receiver: Abs, value: Abs) => Abs }
  | { act: "throw" };

export function classifyAssignSet(target: Abs, key: string, value: Abs): AssignSetPlan {
  // 自有访问器（accessorTable 按目标身份注册）
  const ownAcc = lookupObjAccessor(target, key);
  if (ownAcc) {
    return ownAcc.set ? { act: "setter", set: ownAcc.set } : { act: "throw" };
  }
  const base =
    target.shape.k === "obj"
      ? ((target.shape as ObjShape).slots as Record<string, { value: Abs }> | undefined)
      : undefined;
  const own = base ? getSlot(base, key) !== undefined : false;
  // "__proto__"：Object.prototype 继承访问器（非自有键且非 null-proto 目标）
  if (key === "__proto__" && !own && !isNullProtoObj(target)) {
    if (value.term?.op === "lit" && value.term.value === null) {
      return { act: "proto", proto: value };
    }
    const vk = value.shape.k;
    if (
      vk === "obj" || vk === "tuple" || vk === "arr" || vk === "fn" ||
      vk === "brand" || vk === "eff"
    ) {
      // 引擎内对象值（无 lit term 的 objOf/$obj 产物同此）→ 设原型
      return { act: "proto", proto: value };
    }
    if (value.term?.op === "lit" || vk === "prim") {
      return { act: "ignore" }; // 原始值：setter 静默忽略
    }
    return { act: "open" }; // any/unknown/sum：可能设原型也可能忽略
  }
  // 自有数据属性：非可写 → TypeError（strict set）
  if (own && getPropFlags(target)?.get(key)?.writable === false) return { act: "throw" };
  // 原型链（≤8 层，protoTable 显式注册面；未注册默认 Object.prototype
  // ——其可枚举自有键不可达，继承 toString 等均 writable → write）
  let cur = getProtoAbs(target);
  let depth = 0;
  while (cur && depth++ < 8) {
    const acc = lookupObjAccessor(cur, key);
    if (acc) return acc.set ? { act: "setter", set: acc.set } : { act: "throw" };
    const curSlots =
      cur.shape.k === "obj"
        ? ((cur.shape as ObjShape).slots as Record<string, { value: Abs }> | undefined)
        : undefined;
    if (curSlots && getSlot(curSlots, key) !== undefined) {
      return getPropFlags(cur)?.get(key)?.writable === false
        ? { act: "throw" }
        : { act: "write" };
    }
    cur = getProtoAbs(cur);
  }
  return { act: "write" };
}

// ---------------------------------------------------------------------------
// Bug 210：Proxy [[OwnPropertyKeys]] 陷阱派发 + 规范不变量
//
// 陷阱派发点此前缺失：Reflect.ownKeys / Object.getOwnPropertyNames /
// Object.keys 对 Proxy 接收者直接走靶面或抽象面，handler 的 ownKeys 陷阱
// 从不被调用——原生 [[OwnPropertyKeys]] 先查 handler 的 "ownKeys" 槽。
// ---------------------------------------------------------------------------

/**
 * proxyTrapOf 的名字联合暂未含 "ownKeys"（match-iter.ts 归 S1/S2a 分片——
 * 越界诉求：联合加 "ownKeys"，纯类型面、无行为变化）。运行时 GetMethod
 * 语义与联合内各名字完全一致（同名槽查找 + 三值投影），故此处按同一入口
 * 取槽；联合补齐后本调用无需改动。
 */
type ProxyTrapName = Parameters<typeof proxyTrapOf>[1];

/** Proxy ownKeys 陷阱派发结果 */
export type ProxyOwnKeysOutcome =
  /** 无 ownKeys 陷阱（调用方回退**靶**语义——target 给出靶 Abs）*/
  | { k: "absent"; target: Abs | undefined }
  /** handler 形态不可判 / 陷阱结果元素面不可枚举 → 调用方保守（unknown）*/
  | { k: "opaque"; target: Abs | undefined }
  /** 陷阱结果键表（已过规范不变量校验）+ 靶 Abs（可枚举过滤用）*/
  | { k: "keys"; keys: Abs[]; target: Abs };

/**
 * Bug 210：靶的自有**字符串**键（obj 槽 / brand 内层 obj 槽 / tuple 下标+length）；
 *  键集不可判 → undefined。symbol 投影槽（"@@X"）不计入（原生它们是
 *  symbol 键，不与字符串键同域）；internal 私有槽与 inherited 槽不计（原生
 *  非自有——gOPN 面同口径）。
 */
export function proxyTargetOwnStringKeys(target: Abs): string[] | undefined {
  const inner = proxyTargetInnerObj(target);
  if (inner) {
    const slots = (inner.shape as { slots: Record<string, { internal?: boolean; inherited?: boolean }> })
      .slots;
    return Object.keys(slots).filter(
      (k) =>
        slots[k]?.internal !== true &&
        slots[k]?.inherited !== true &&
        !k.startsWith("@@"),
    );
  }
  if (target.shape.k === "tuple") {
    const holes = (target.shape as { holes?: number[] }).holes ?? [];
    const names = target.shape.elements
      .map((_, i) => i)
      .filter((i) => !holes.includes(i))
      .map(String);
    names.push("length");
    return names;
  }
  return undefined;
}

/**
 * Bug 210：靶的自有**可枚举**字符串键（Object.keys 面）；键集不可判 → undefined。
 * tuple 靶：下标可枚举，**length 不可枚举**（原生数组 length 非可枚举）。
 */
export function proxyTargetEnumerableStringKeys(target: Abs): string[] | undefined {
  const inner = proxyTargetInnerObj(target);
  if (inner) {
    const slots = (inner.shape as { slots: Record<string, { internal?: boolean; inherited?: boolean }> })
      .slots;
    return enumOwnKeys(inner, slots).filter(
      (k) =>
        (slots[k] as { internal?: boolean; inherited?: boolean } | undefined)?.inherited !== true &&
        !k.startsWith("@@"),
    );
  }
  if (target.shape.k === "tuple") {
    const holes = (target.shape as { holes?: number[] }).holes ?? [];
    return target.shape.elements
      .map((_, i) => i)
      .filter((i) => !holes.includes(i))
      .map(String);
  }
  return undefined;
}

/**
 * Bug 210：[[OwnPropertyKeys]] 规范不变量（ES2024 10.5.5 + MDN 口径）——
 * - 陷阱结果含**重复项** → TypeError（原生 "'ownKeys' on proxy: trap
 *   returned duplicate entries"）；
 * - 陷阱结果含非字符串/非 symbol 键 → TypeError（原生 "1 is not a valid
 *   property name"）；
 * - 靶的**不可配置**自有键必须都在陷阱结果里 → 否则 TypeError（原生
 *   "'ownKeys' on proxy: trap result did not include 'a'"）——**与靶是否
 *   可扩展无关**（MDN："must contain the keys of all non-configurable
 *   properties of the target object"）；
 * - 靶**不可扩展**时：陷阱结果须含靶的**全部**自有键，且**不得**含靶没有
 *   的键 → 否则 TypeError（原生 "trap returned extra keys but proxy target
 *   is non-extensible"）。
 *
 * 不可判面（抽象键 / 抽象靶键集 / 靶的 symbol 自有键）→ 不抛（sound 保守：
 * 原生只在确定违规时抛；引擎不得凭空造违规）。
 */
export function enforceProxyOwnKeysInvariant(target: Abs, keys: Abs[]): void {
  const seen = new Set<string | symbol>();
  for (const k of keys) {
    const v: unknown = k.term?.op === "lit" ? k.term.value : undefined;
    if (typeof v === "string" || typeof v === "symbol") {
      if (seen.has(v)) throw new NudoThrow(errorTypeAbs("TypeError"));
      seen.add(v);
      continue;
    }
    // 抽象键（值不可判）→ 跳过（不凭空造抛）
    if (k.term?.op === "lit") {
      // 字面量但既非字符串也非 symbol → 键类型非法 → 定抛
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  const targetKeys = proxyTargetOwnStringKeys(target);
  if (targetKeys === undefined) return; // 靶键集不可判 → 不抛
  const inner = proxyTargetInnerObj(target);
  const st = inner ? extStateOf(inner) : extStateOf(target);
  const flags = inner ? getPropFlags(inner) : getPropFlags(target);
  // (a) 靶的不可配置自有键必须都在陷阱结果里（与靶可扩展性无关）
  for (const tk of targetKeys) {
    const nonConf =
      st === "frozen" ||
      st === "sealed" ||
      flags?.get(tk)?.configurable === false ||
      // 数组 length 恒不可配置（原生数组的 length 是 non-configurable）
      (target.shape.k === "tuple" && tk === "length");
    if (nonConf && !seen.has(tk)) throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // (b) 靶不可扩展 → 陷阱结果须恰为靶的自有键集（不多不少）
  if (st === undefined) return; // 靶可扩展 → 无此约束
  for (const tk of targetKeys) {
    if (!seen.has(tk)) throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  for (const k of seen) {
    if (typeof k !== "string") continue; // symbol 键：靶自有 symbol 面不可判 → 跳过
    if (!targetKeys.includes(k)) throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/**
 * Bug 210：Proxy ownKeys 陷阱派发（单一实现——Reflect.ownKeys 与
 * Object.getOwnPropertyNames / Object.keys 共用，不复制）。
 *
 * 返回：
 * - absent：无 ownKeys 陷阱（调用方回退**靶**语义——规范 step 6）
 * - opaque：handler 形态不可判 / 陷阱结果元素面不可枚举（调用方保守）
 * - keys：陷阱结果键表（已过 enforceProxyOwnKeysInvariant 校验）
 */
export function proxyOwnKeysTrapKeys(o: Abs): ProxyOwnKeysOutcome {
  if (o.shape.k !== "brand" || o.shape.name !== "Proxy") {
    return { k: "absent", target: undefined };
  }
  const parts = proxyPartsOf(o);
  if (!parts) return { k: "absent", target: undefined };
  const trap = proxyTrapOf(parts.handler, "ownKeys" as unknown as ProxyTrapName);
  if (trap.k === "absent") return { k: "absent", target: parts.target };
  if (trap.k === "dead") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (trap.k === "opaque") return { k: "opaque", target: parts.target };
  const r = $call(trap.fn, [parts.target], parts.handler);
  // 非对象结果 → 原生定抛（CreateListFromArrayLike called on non-object）
  if (r.shape.k === "prim" || isNullishLitAbs(r)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (r.shape.k === "tuple") {
    const keys = (r.shape as { elements: Abs[] }).elements;
    enforceProxyOwnKeysInvariant(parts.target, keys);
    return { k: "keys", keys, target: parts.target };
  }
  // arr（元素面不可枚举）/ 普通 obj（length 面不可判）→ 保守（键表不可判）
  return { k: "opaque", target: parts.target };
}
