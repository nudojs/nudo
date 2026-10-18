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
 *
 * 兄弟模块边界：methods.ts（evalObjectMethod）经导出复用安装机器；
 * readProperty 供 json.ts（stringify 读值）。
 */

import type { Abs } from "../../abs.ts";
import { abs, litValue, strLit, boolLit, unknown } from "../../abs.ts";
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
 * Bug 8：defineProperty 的描述符读取 / 冲突校验 / 访问器侧表安装 /
 * 槽位与 flags 落地——defineProperties 逐键复用（单一机器，不复制）。
 * 返回应用描述符后的 target（不可变更新）。
 *
 * Bug 117：opts.symbolKey——键来自 symbol 投影（"@@iterator" 等，读写路径
 * symbolKeyOf 同口径）时，安装槽沿用该标记（JSON.stringify/枚举面跳过）。
 */
export function applyPropertyDescriptor(
  a0: Abs,
  key: string,
  descAbs: Abs,
  opts?: { symbolKey?: boolean },
): Abs {
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
  // get/set 非函数且非 undefined → TypeError（Getter must be a function）
  const invalidAccessor = (f: { present: boolean; v: unknown }): boolean =>
    f.present && f.v !== undefined && f.v !== "fn-or-abstract";
  // Bug 20：原生 ToPropertyDescriptor 确定 TypeError——硬抛（catch 可
  // 吸收），不再 return unknown 吞掉 throws 面
  if (invalidAccessor(getF) || invalidAccessor(setF)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // value 与访问器共存 → TypeError（Invalid property. 'value' present on …）
  const accessorPresent =
    (getF.present && getF.v !== undefined) || (setF.present && setF.v !== undefined);
  if (accessorPresent && valueF.present && valueF.v !== undefined) {
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
  /** ToBoolean：非 undefined 描述符值按 truthiness（writable: 5 → true）；
   *  抽象值保守不收紧 */
  const toBool = (k: string): boolean | undefined => {
    const f = field(k);
    if (!f.present || f.v === undefined || f.v === "fn-or-abstract") return undefined;
    return Boolean(f.v);
  };
  const writable = toBool("writable");
  const enumerable = toBool("enumerable");
  const configurable = toBool("configurable");
  // 描述符字段语义：**新建属性**未指定字段默认 false；**已有属性**
  // （对象字面量属性默认可写/可枚举/可配置）未指定字段保持原状，
  // 仅显式 false 才收紧。原生对已有 configurable:false 属性改描述符
  // 抛 TypeError 的形态不建模。
  const innerForExists =
    a0.shape.k === "brand" ? a0.shape.shape : a0;
  const exists =
    innerForExists.shape.k === "obj" &&
    Object.prototype.hasOwnProperty.call(innerForExists.shape.slots, key);
  // Bug 84：机制变化判定（accessor→data）——旧 getter/setter 须随键从
  // 侧表删除（putSlots 的 migrateAccessors omitKey），且已有 flags 作为
  // 基底合并（此前 setPropFlags 整条覆写，把 accessor 安装期记下的
  // enumerable:false 抹掉——Object.keys 假多键）。
  const wasAccessor = exists && lookupObjAccessor(innerForExists, key) !== undefined;
  // Bug 84：已有属性机制变化（data↔accessor）且 configurable:false → 原生
  // ValidateAndApplyPropertyDescriptor 定抛（"Attempting to change access
  // mechanism for an unconfigurable property"）；此前静默安装（data→accessor
  // 假 getter 值 / accessor→data 侧表残留）
  if (exists && wasAccessor !== accessorPresent) {
    if (getPropFlags(innerForExists)?.get(key)?.configurable === false) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  const flags: PropFlags = exists
    ? { ...(getPropFlags(innerForExists)?.get(key) ?? {}) }
    : {};
  if (exists) {
    if (wasAccessor && !accessorPresent) {
      // 机制变化 accessor→data（spec ValidateAndApplyPropertyDescriptor）：
      // [[Writable]] 缺省 false；[[Enumerable]]/[[Configurable]] 沿 current
      flags.writable = writable ?? false;
    } else if (writable === false && !accessorPresent) {
      flags.writable = false;
    }
    if (enumerable === false) flags.enumerable = false;
    if (configurable === false) flags.configurable = false;
  } else {
    if (writable !== true && !accessorPresent) flags.writable = false;
    if (enumerable !== true) flags.enumerable = false;
    if (configurable !== true) flags.configurable = false;
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
    // 紧显式 false；此前沿用 obj 臂的「新键全 false」→ entries/keys 假剔除）
    const idxOf = canonicalArrayIndex(key);
    const tExists =
      key === "length" || (idxOf !== undefined && idxOf < sh.elements.length && !sh.holes?.includes(idxOf));
    const tFlags: PropFlags = tExists ? { ...(getPropFlags(t)?.get(key) ?? {}) } : {};
    if (tExists) {
      if (key === "length") {
        if (writable === false) tFlags.writable = false;
        tFlags.enumerable = false;
        tFlags.configurable = false;
      } else {
        if (writable === false && !accessorPresent) tFlags.writable = false;
        if (enumerable === false) tFlags.enumerable = false;
        if (configurable === false) tFlags.configurable = false;
      }
    } else {
      if (writable !== true && !accessorPresent) tFlags.writable = false;
      if (enumerable !== true) tFlags.enumerable = false;
      if (configurable !== true) tFlags.configurable = false;
    }
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
      if (accessorPresent) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (!valueF.present) {
        // partial redefine（如 {writable:false}）：无值变化
        if (st === "frozen" && (writable === false || enumerable === false || configurable === false)) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
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
        if (!frozenIdentical()) throw new NudoThrow(errorTypeAbs("TypeError"));
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
    if ((st === "sealed" || st === "nonext") && !existsHere) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (st === "frozen") {
      if (accessorPresent || !frozenIdentical()) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
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
    return out;
  }
  if (out.shape.k === "obj") {
    out = putSlots(out);
  } else if (out.shape.k === "brand") {
    const inner = putSlots(out.shape.shape);
    if (inner !== out.shape.shape) {
      out = abs({ k: "brand", name: out.shape.name, shape: inner }, out.term, out.pred, out.conf);
    }
  }
  setPropFlags(out, key, flags);
  return out;
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
