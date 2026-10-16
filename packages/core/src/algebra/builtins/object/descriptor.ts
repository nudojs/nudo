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
 * - readProperty 是反射/枚举内建 [[Get]] 统一入口：accessorTable thunk
 *   优先（getter 求值）、数据槽兜底、setter-only 读 undefined。
 *
 * 兄弟模块边界：methods.ts（evalObjectMethod）经导出复用安装机器；
 * readProperty 供 json.ts（stringify 读值）。
 */

import type { Abs } from "../../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../../abs.ts";
import {
  joinAbs,
  objOf,
  canonicalArrayIndex,
  setSlot,
  getSlot,
  type ObjShape,
} from "../../objects.ts";
import { undefAbs } from "../../hof.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { $call } from "../../exec/call.ts";
import { $objAccessor, migrateAccessors, lookupObjAccessor } from "../../accessors.ts";
import { boolPrim } from "../shared.ts";
import {
  type PropFlags,
  getPropFlags,
  setPropFlags,
  migrateInvariants,
  isEnumerableView,
  enumOwnKeys,
} from "../invariants.ts";
import { classInstanceInnerOf } from "../../exec/class-registry.ts";

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
 */
export function applyPropertyDescriptor(a0: Abs, key: string, descAbs: Abs): Abs {
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
  const dv = (k: string): unknown => {
    const s = dslots[k]?.value;
    if (!s) return undefined;
    const r = litValue(s);
    return r.ok ? r.value : undefined;
  };
  const value = dv("value");
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
  const flags: PropFlags = {};
  if (exists) {
    if (writable === false && !accessorPresent) flags.writable = false;
    if (enumerable === false) flags.enumerable = false;
    if (configurable === false) flags.configurable = false;
  } else {
    if (writable !== true && !accessorPresent) flags.writable = false;
    if (enumerable !== true) flags.enumerable = false;
    if (configurable !== true) flags.configurable = false;
  }
  // value 进 slots（defineProperty 返回接收者本身；语句级写回由 transpile 负责）
  const litOf = (v: unknown): Abs | undefined => {
    if (v === undefined) return undefined; // 无 value 描述符：不动槽
    if (typeof v === "number") return numLit(v);
    if (typeof v === "string") return strLit(v);
    if (typeof v === "boolean") return boolLit(v);
    if (v === null) return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
    return undefined;
  };
  let out = a0;
  const putSlots = (inner: Abs): Abs => {
    if (inner.shape.k !== "obj") return inner;
    const lit = litOf(value);
    let slots = { ...inner.shape.slots };
    if (lit) {
      slots = { ...slots, [key]: { value: lit } };
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
    // （$get/$set 派发——写路径走 setter，不再按 writable:false 误抛）
    migrateAccessors(inner, next);
    if (getThunk || setThunk) {
      $objAccessor(next, key, getThunk ?? null, setThunk ?? null);
    }
    return next;
  };
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
