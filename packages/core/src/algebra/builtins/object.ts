/**
 * Object.assign 非 obj 源键投影 + Object.* 静态方法
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, confJoin, isExactLit } from "../abs.ts";
import { joinAbs, objOf, markNullProtoObj, canonicalArrayIndex, setSlot, setProtoAbs, type ObjShape } from "../objects.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import { mapEntriesAbs } from "../collections.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { $call } from "../exec/call.ts";
import { $objAccessor, migrateAccessors, lookupObjAccessor } from "../exec/runtime/members.ts";
import { getFnImpl, absFunction } from "../abs-fn.ts";
import { isSymbolAbs } from "./symbol.ts";
import { boolPrim, numPrim, str, isPrimLike, mayCoerceThrowOperand, noBody } from "./shared.ts";
import { type PropFlags, getPropFlags, markExtState, extStateOf, setPropFlags, migrateInvariants, isEnumerableView } from "./invariants.ts";
import { protoOfRecv } from "./ctor.ts";
import { isErrorCtorName } from "./error.ts";

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
  if (s.k === "prim") return s.type === "string" ? undefined : {};
  if (s.k === "eff" || s.k === "never") return {}; // Promise 无自有可枚举键
  return undefined; // arr/brand/sum/fn/any/unknown…：键集未知
}

/**
 * Bug 8：defineProperty / defineProperties 共用的 target IsObject 校验——
 * 缺省 / nullish·prim 字面量 / prim 形态（symbol prim / 抽象 refined prim）
 * → 定抛；any/unknown/含 prim 臂 union → may（IsObject 一切 prim 均抛）。
 */
function validateDefineTarget(target: Abs | undefined, what: string): void {
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
function validateDescriptorObject(descAbs: Abs | undefined, what: string): void {
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
function applyPropertyDescriptor(a0: Abs, key: string, descAbs: Abs): Abs {
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
  const getThunk = accessorPresent && getFAbs && getFAbs.shape.k === "fn"
    ? (getFnImpl(getFAbs)?.bindThis
        ? (t: Abs) => $call(getFAbs, [t])
        : (t: Abs) => $call(getFAbs, [], t))
    : undefined;
  const setThunk = accessorPresent && setFAbs && setFAbs.shape.k === "fn"
    ? (getFnImpl(setFAbs)?.bindThis
        ? (t: Abs, v: Abs): Abs => {
            $call(setFAbs, [t, v]);
            return t; // setter 返回值原生丢弃；目标重绑约定同字面量访问器（返 receiver）
          }
        : (t: Abs, v: Abs): Abs => {
            $call(setFAbs, [v], t);
            return t;
          })
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

/**
 * Bug 43：boxed String brand（new String("ab") / Object('ab') 字面量箱）的
 * 可枚举自有键值对——下标字符槽（"0".."n-1"；length 不可枚举、
 * [[PrimitiveValue]] 内部槽已标 enumerable:false）。open 空箱键集未知 →
 * undefined（调用方落 generic 保守域）。
 */
function boxedStringEnumEntries(a0: Abs | undefined): Array<[string, Abs]> | undefined {
  if (!a0 || a0.shape.k !== "brand" || (a0.shape as { name?: string }).name !== "String") {
    return undefined;
  }
  const inner = (a0.shape as { shape?: Abs }).shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const os = inner.shape as unknown as {
    slots: Record<string, { value: Abs }>;
    open?: boolean;
  };
  if (os.open) return undefined;
  const out: Array<[string, Abs]> = [];
  for (const [k, v] of Object.entries(os.slots)) {
    if (k === "length") continue;
    if (!isEnumerableView(inner, k)) continue;
    out.push([k, v.value]);
  }
  out.sort((a, b) => Number(a[0]) - Number(b[0]));
  return out;
}

/** Bug 43：零可枚举自有字符串键的内建 brand（Map/Set/Date/Error 家族/…；
 *  Number/Boolean 是装箱 brand（Object(1)/new Boolean）——内建构造器本身
 *  不是 brand 形态，无混淆） */
const BUILTIN_BRAND_NO_ENUM_KEYS = new Set([
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "Date", "RegExp", "Promise", "Number", "Boolean",
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
  "EvalError", "URIError", "AggregateError",
  "URL", "URLSearchParams", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "RegExpMatchIterator", "RegExpStringIterator",
]);

function builtinBrandNoEnumKeys(a0: Abs | undefined): boolean {
  if (!a0 || a0.shape.k !== "brand") return false;
  const name = (a0.shape as { name?: string }).name ?? "";
  return BUILTIN_BRAND_NO_ENUM_KEYS.has(name);
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

/** enumerable:false（defineProperty 记录）的键从枚举视图剔除 */
  const enumKeys = (slots: Record<string, unknown>, target: Abs): string[] => {
    const flags = getPropFlags(target);
    return Object.keys(slots).filter(
      (k) => flags?.get(k)?.enumerable !== false,
    );
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
      }
      // Bug 32：第二实参 propertiesObject——逐（可枚举字符串键）描述符经
      // ToPropertyDescriptor + DefineOwnProperty 安装为**自有属性**（此前
      // 整体忽略：createDescNull 静默 undefined / obj-proto 变体假 unknown）。
      const props = args[1];
      if (props !== undefined) {
        if (
          !props ||
          (props.term?.op === "lit" &&
            (props.term.value === null || props.term.value === undefined))
        ) {
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
          // 原生只取自有**可枚举**键（EnumerableTrue 过滤）
          for (const key of ps.open || ps.index ? [] : enumKeys(ps.slots, props)) {
            const descAbs = ps.slots[key]!.value;
            validateDescriptorObject(descAbs, "Object.create");
            base = applyPropertyDescriptor(base, key, descAbs);
          }
        }
        // prim propertiesObject：ToObject 装箱零可枚举自有键 → 无属性安装
        //（node 实测 Object.create(null, 5) 不抛）；tuple/arr/fn/brand 同理
        // 无字符串键槽
      }
      if (base !== undefined && nullProto) return markNullProtoObj(base);
      return base; // 抽象 proto 臂：保守 unknown（值域与前一致）
    }
    case "keys": {
      // Bug 61：缺省 ≡ undefined → ToObject 定抛；nullish 字面量同（原仅字面量臂）
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0?.shape.k === "obj") {
        const keys = enumKeys(
          (a0.shape as { slots: Record<string, unknown> }).slots,
          a0,
        ).map((k) => strLit(k));
        return abs({ k: "tuple", elements: keys }, undefined, undefined, "exact");
      }
      if (a0?.shape.k === "tuple") {
        // 数组：索引键（hole 槽无键）
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const keys = a0.shape.elements
          .map((_, i) => i)
          .filter((i) => !holes.includes(i))
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
        const brandKeys = boxedStringEnumEntries(a0);
        if (brandKeys) {
          return abs({ k: "tuple", elements: brandKeys.map(([k]) => strLit(k)) }, undefined, undefined, "exact");
        }
        if (builtinBrandNoEnumKeys(a0)) {
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
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
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        // Bug 57：[[Get]] 语义——访问器 getter 求值（直接读占位槽会折
        // undefined/unknown）
        const vals = enumKeys(slots, a0).map((k) => readProperty(a0, k));
        return abs({ k: "tuple", elements: vals }, undefined, undefined, "exact");
      }
      if (a0?.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        return abs(
          {
            k: "tuple",
            elements: a0.shape.elements.filter((_, i) => !holes.includes(i)),
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
        const brandVals = boxedStringEnumEntries(a0);
        if (brandVals) {
          return abs({ k: "tuple", elements: brandVals.map(([, v]) => v) }, undefined, undefined, "exact");
        }
        if (builtinBrandNoEnumKeys(a0)) {
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
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
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        // Bug 57：[[Get]] 语义——访问器 getter 求值
        const entries = enumKeys(slots, a0).map((k) =>
          abs({ k: "tuple", elements: [strLit(k), readProperty(a0, k)] }, undefined, undefined, "exact"),
        );
        return abs({ k: "tuple", elements: entries }, undefined, undefined, "exact");
      }
      if (a0?.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const entries = a0.shape.elements
          .map((el, i) => ({ el, i }))
          .filter(({ i }) => !holes.includes(i))
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
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
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
      const keyR = args[1] ? litValue(args[1]) : undefined;
      const key = keyR?.ok ? keyR.value : undefined;
      if (typeof key !== "string") return boolPrim();
      if (a0.shape.k === "obj") {
        const shape = a0.shape as { slots: Record<string, unknown>; open?: boolean };
        if (Object.prototype.hasOwnProperty.call(shape.slots, key)) return boolLit(true);
        // 闭 exact 对象确定无槽 → false；open/非 exact conf → 保守
        if (!shape.open && a0.conf === "exact") return boolLit(false);
        return boolPrim();
      }
      return boolPrim();
    }
    case "getPrototypeOf": {
      if (!a0) return unknown;
      if (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 76：symbol prim 接收者（无 lit 项——Symbol() 调用产物）→ 宿主
      // ToObject 特例定抛（node 实测：Symbol.prototype [ @@toPrimitive ]
      // requires that 'this' be a Symbol）；number/string/boolean/bigint
      // 装箱合法（protoOfRecv 投影）
      if (isSymbolAbs(a0)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
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
      return setProtoAbs(t0, p0);
    }
    case "assign": {
      // Object.assign(a, b) ≈ spread
      if (!args.length) return unknown;
      // target 字面量：null/undefined → TypeError 硬抛；prim → 装箱语义未建模
      const t0 = args[0];
      if (t0 && t0.term?.op === "lit") {
        if (t0.term.value === null || t0.term.value === undefined) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        return unknown;
      }
      // Bug 76：symbol prim target（无 lit 项——Symbol() 调用产物）→ 宿主
      // ToObject 定抛「Cannot convert a Symbol value to a string」（node
      // 实测 assign(Symbol()) 无源也抛）；number/string/boolean/bigint
      // target 装箱合法——维持既有装箱 bail（return unknown）
      if (isSymbolAbs(t0)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 50：抽象 target（无 lit 项）可能 nullish → ToObject may TypeError
      //（仅补 throws 效果，值域不变；对象形态 target 原生全定）
      noteRecvMayNullish(t0, "Object.assign target may be nullish (ToObject throws)");
      let acc = args[0]!;
      for (let i = 1; i < args.length; i++) {
        acc = { ...acc }; // 保持结构；细粒度 spread 在 evalCall 侧
        const src = args[i]!;
        if (acc.shape.k === "obj" && src.shape.k === "obj") {
          const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
          const over = (src.shape as { slots: Record<string, { value: Abs }> }).slots;
          // enumerable:false 自有键不拷贝（EnumerableOwnProperties）
          const filtered: Record<string, { value: Abs }> = { ...base };
          for (const k of enumKeys(over as Record<string, unknown>, src)) {
            filtered[k] = over[k]!;
          }
          acc = abs({ k: "obj", slots: filtered }, undefined, undefined, confJoin(acc.conf, src.conf));
        } else if (src.shape.k !== "obj") {
          // 非 obj 源：tuple（下标键、hole 跳过）/字符串字面量（码元键）/
          // number/boolean/nullish（无键忽略）；键集未知 → 保守降级（与
          // evaluator runtimeAssignObject 同口径——此前整体忽略折假精确）
          const srcSlots = assignSourceSlots(src);
          if (srcSlots === undefined) {
            if (acc.shape.k === "obj") {
              const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
              acc = abs({ k: "obj", slots: { ...base }, open: true }, undefined, undefined, acc.conf);
            } else if (acc.shape.k === "tuple") {
              const els = acc.shape.elements;
              const joined = els.length ? els.reduce((x, y) => joinAbs(x, y)) : str();
              acc = abs(
                { k: "arr", element: joinAbs(joined, str()) },
                undefined,
                undefined,
                "partial",
              );
            }
          } else if (acc.shape.k === "obj") {
            const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
            acc = abs({ k: "obj", slots: { ...base, ...srcSlots } }, undefined, undefined, confJoin(acc.conf, src.conf));
          } else if (acc.shape.k === "tuple") {
            // 数组 target × tuple/字符串源：下标键按下标写（与 obj 源分支同口径；
            // 无 length 键/getter，直接逐位写）
            let elements = [...acc.shape.elements];
            let holes = [...(acc.shape.holes ?? [])];
            let len = elements.length;
            for (const [k, s] of Object.entries(srcSlots)) {
              const idx = canonicalArrayIndex(k);
              if (idx === undefined) continue;
              if (idx >= len) len = idx + 1;
              if (idx >= elements.length) elements.length = idx + 1;
              elements[idx] = s.value;
              holes = holes.filter((h) => h !== idx);
            }
            elements.length = len;
            acc = abs(
              { k: "tuple", elements, holes: holes.length > 0 ? holes : undefined },
              undefined,
              undefined,
              confJoin(acc.conf, src.conf),
            );
          }
        } else if (acc.shape.k === "tuple" && src.shape.k === "obj") {
          // 数组 target：与 evaluator runtimeAssignObject 同口径——数字键按下标写
          // （扩展 length）、length 键截断/延长（延长段 hole、非法原生
          // RangeError）、非规范键 expando 忽略；源键序 = 原生属性序
          const slots = (src.shape as { slots: Record<string, { value: Abs }> }).slots;
          let elements = [...acc.shape.elements];
          let holes = [...(acc.shape.holes ?? [])];
          let len = elements.length;
          for (const [k, s] of Object.entries(slots)) {
            if (k === "length") {
              const lv = s.value.term?.op === "lit" ? s.value.term.value : undefined;
              if (typeof lv !== "number" || !Number.isInteger(lv) || lv < 0) {
                throw new NudoThrow(errorTypeAbs("RangeError"));
              }
              if (lv > TUPLE_MATERIALIZE_CAP) {
                return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
              }
              if (lv < len) {
                elements.length = lv;
                holes = holes.filter((h) => h < lv);
              } else {
                for (let j = len; j < lv; j++) holes.push(j);
              }
              len = lv;
              continue;
            }
            const idx = canonicalArrayIndex(k);
            if (idx === undefined) continue;
            if (idx >= len) len = idx + 1;
            if (idx >= elements.length) elements.length = idx + 1;
            elements[idx] = s.value;
            holes = holes.filter((h) => h !== idx);
          }
          elements.length = len;
          acc = abs(
            { k: "tuple", elements, holes: holes.length > 0 ? holes : undefined },
            undefined,
            undefined,
            confJoin(acc.conf, src.conf),
          );
        }
      }
      return acc;
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
      if (a0) return markExtState(a0, "frozen");
      return undefined;
    }
    case "seal": {
      if (a0) return markExtState(a0, "sealed");
      return undefined;
    }
    case "preventExtensions": {
      if (a0) return markExtState(a0, "nonext");
      return undefined;
    }
    case "isFrozen": {
      const t = args[0];
      // ES：非对象（prim/null/undefined，含无实参）恒 frozen——不抛
      if (isPrimLike(t)) return boolLit(true);
      return boolLit(extStateOf(t!) === "frozen");
    }
    case "isSealed": {
      const t = args[0];
      if (isPrimLike(t)) return boolLit(true);
      const s = extStateOf(t!);
      return boolLit(s === "sealed" || s === "frozen");
    }
    case "isExtensible": {
      const t = args[0];
      // ES：非对象恒不可扩展——不抛
      if (isPrimLike(t)) return boolLit(false);
      return boolLit(extStateOf(t!) === undefined);
    }
    case "defineProperty": {
      // Bug 8/39：target IsObject + 描述符校验抽共享 helper（defineProperties
      // 复用）；安装机器在 applyPropertyDescriptor（单一实现）
      validateDefineTarget(a0, "Object.defineProperty");
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      // Bug 39：描述符校验先于 key 保守回退——原生 ToPropertyDescriptor 对
      // key 值不敏感，desc 定抛/may 抛都要记
      validateDescriptorObject(args[2], "Object.defineProperty");
      if (typeof kv !== "string" && typeof kv !== "number") return a0;
      return applyPropertyDescriptor(a0!, String(kv), args[2]!);
    }
    case "defineProperties": {
      // Bug 8：defineProperties(target, props) —— 返回值恒为 target（原生
      // 语义）；逐（可枚举字符串键）描述符复用 defineProperty 机器。
      // props 缺省/nullish/prim → ToObject 定抛；any/unknown/sum → may；
      // tuple/arr/fn/brand 是对象（无字符串键槽 → 无操作）
      validateDefineTarget(a0, "Object.defineProperties");
      const props = args[1];
      if (
        !props ||
        (props.term?.op === "lit" &&
          (props.term.value === null || props.term.value === undefined)) ||
        props.shape.k === "prim"
      ) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
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
        // 原生只取自有**可枚举**键（EnumerableTrue 过滤）
        for (const key of ps.open || ps.index ? [] : enumKeys(ps.slots, props)) {
          const descAbs = ps.slots[key]!.value;
          validateDescriptorObject(descAbs, "Object.defineProperties");
          out = applyPropertyDescriptor(out, key, descAbs);
        }
      }
      return out;
    }
    case "getOwnPropertyDescriptors": {
      // Bug 8：nullish 接收者定抛（gOPD 同口径）；closed obj → 逐自有键
      // exact 描述符对象（mkPropDescAbs / flags 与 gOPD 同口径）；
      // tuple → 索引 + length 描述符；字符串装箱 → 字符 + length（不可写）；
      // 其余 prim 装箱 → {}；open/抽象 → 开放 obj（槽值 descriptor|undefined）
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
      if (a0.shape.k === "obj") {
        const os = a0.shape as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
        if (os.open || os.index) {
          // 槽开放：可能有未知自有键 → 开放 obj（已知键精确，未知键按
          // open 语义折 descriptor|undefined 保守域）
          const slots: Record<string, { value: Abs }> = {};
          for (const key of Object.keys(os.slots)) {
            const value = os.slots[key]!.value;
            const flags = getPropFlags(a0)?.get(key);
            slots[key] = {
              value: mkPropDescAbs(
                value,
                flags?.writable !== false,
                flags?.enumerable !== false,
                flags?.configurable !== false,
              ),
            };
          }
          return abs({ k: "obj", slots, open: true }, undefined, undefined, "partial");
        }
        const entries = Object.keys(os.slots).map(
          (key) => [key, os.slots[key]!.value] as [string, Abs],
        );
        const flagsMap = getPropFlags(a0);
        return descSlotsOf(entries, (key) => {
          const f = flagsMap?.get(key);
          return {
            writable: f?.writable !== false,
            enumerable: f?.enumerable !== false,
            configurable: f?.configurable !== false,
          };
        });
      }
      if (a0.shape.k === "tuple") {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        const entries: Array<[string, Abs]> = a0.shape.elements.map(
          (el, i) => [String(i), holes.includes(i) ? undefAbs() : el] as [string, Abs],
        );
        entries.push(["length", numLit(a0.shape.elements.length)]);
        // 数组 length：writable:true、不可枚举、不可配置（node 实测）；
        // 索引元素全自有可写可枚举可配置（gOPD tuple 分支同口径）
        return descSlotsOf(entries, (key) =>
          key === "length"
            ? { writable: true, enumerable: false, configurable: false }
            : { writable: true, enumerable: true, configurable: true },
        );
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
      if (a0.shape.k === "brand") {
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
            return abs(
              { k: "tuple", elements: Object.keys(os.slots).map((n) => strLit(n)) },
              undefined,
              undefined,
              "exact",
            );
          }
        }
        if (builtinBrandNoEnumKeys(a0)) {
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
      }
      if (a0.shape.k === "obj") {
        const os = a0.shape as { slots: Record<string, unknown>; open?: boolean; index?: unknown };
        if (!os.open && !os.index) {
          // 含不可枚举（defineProperty enumerable:false）——不过滤
          return abs(
            { k: "tuple", elements: Object.keys(os.slots).map((n) => strLit(n)) },
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
      // Bug 35：nullish 接收者定抛；symbol 键不在 Abs 槽域——保守 symbol[]
      //（不假造空精确：源侧 symbol 计算键写不建模，但也不排除）
      if (!a0 || (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      noteRecvMayNullish(a0, "Object.getOwnPropertySymbols receiver ToObject");
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
      if (a0.shape.k === "obj") {
        const os = a0.shape as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
        if (os.open || os.index || key === undefined) return maybeDesc();
        if (Object.prototype.hasOwnProperty.call(os.slots, key)) {
          // Bug 57：访问器侧表优先——访问器描述符 { get: ƒ|undefined,
          // set: ƒ|undefined, enumerable, configurable }（无 value/writable；
          // thunk 包成 fn Abs，调用经 apply 钩子求值）
          const acc = lookupObjAccessor(a0, key);
          if (acc) {
            const flags = getPropFlags(a0)?.get(key);
            const wrapGet = (thunk: (t: Abs) => Abs): Abs =>
              absFunction(["_this"], {
                body: noBody,
                apply: (_args, thisVal) => thunk(thisVal ?? a0),
              });
            const wrapSet = (thunk: (t: Abs, v: Abs) => Abs): Abs =>
              absFunction(["_this", "value"], {
                body: noBody,
                apply: (args2, thisVal) => {
                  thunk(thisVal ?? a0, args2[0] ?? undefAbs());
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
      if (a0.shape.k === "tuple" && key !== undefined) {
        const holes = (a0.shape as { holes?: number[] }).holes ?? [];
        if (key === "length") {
          // 数组 length：writable:true、不可枚举、不可配置（node 实测）
          return mkDesc(numLit(a0.shape.elements.length), true, false, false);
        }
        const idx = canonicalArrayIndex(key);
        if (idx !== undefined) {
          if (idx < a0.shape.elements.length && !holes.includes(idx)) {
            return mkDesc(a0.shape.elements[idx]!, true, true, true);
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
    default:
      return undefined;
  }
}

