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
  joinAbs,
  markNullProtoObj,
  canonicalArrayIndex,
  setProtoAbs,
  getSlot,
  setSlot,
  propertyKeyOf,
  type ObjShape,
} from "../../objects.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import { mapEntriesAbs } from "../../collections.ts";
import { undefAbs } from "../../hof.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { lookupObjAccessor } from "../../accessors.ts";
import { absFunction } from "../../abs-fn.ts";
import { isSymbolAbs } from "../symbol.ts";
import { boolPrim, str, isPrimLike, noBody } from "../shared.ts";
import {
  getPropFlags,
  markExtState,
  extStateOf,
  setPropFlags,
  isEnumerableView,
  enumOwnKeys,
} from "../invariants.ts";
import { classInstanceInnerOf } from "../../exec/class-registry.ts";
import { protoOfRecv } from "../ctor.ts";
import { isErrorCtorName } from "../error.ts";

import {
  applyPropertyDescriptor,
  assignSourceSlots,
  classifyAssignSet,
  maybePropDescAbs,
  mkPropDescAbs,
  primTargetAssignThrows,
  readProperty,
  validateDefineTarget,
  validateDescriptorObject,
  wellKnownSymbolSlotKey,
} from "./descriptor.ts";
import { boxedStringEnumEntries, builtinBrandNoEnumKeys, foldGroupBy } from "./enum-entries.ts";

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
   *  剔除）；非类实例面 → undefined（调用方保持既有保守口径） */
  const classInstanceEnumEntries = (a0: Abs | undefined): Array<[string, Abs]> | undefined => {
    const inner = a0 ? classInstanceInnerOf(a0) : undefined;
    if (!inner) return undefined;
    const slots = (inner.shape as ObjShape).slots as Record<string, { value: Abs }>;
    return enumOwnKeys(inner, slots).map((k) => [k, getSlot(slots, k)!.value] as [string, Abs]);
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
      if (a0?.shape.k === "obj") {
        const keys = enumKeys(
          (a0.shape as { slots: Record<string, unknown> }).slots,
          a0,
        ).map((k) => strLit(k));
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
        const brandKeys = boxedStringEnumEntries(a0);
        if (brandKeys) {
          return abs({ k: "tuple", elements: brandKeys.map(([k]) => strLit(k)) }, undefined, undefined, "exact");
        }
        if (builtinBrandNoEnumKeys(a0)) {
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
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
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
        const brandVals = boxedStringEnumEntries(a0);
        if (brandVals) {
          return abs({ k: "tuple", elements: brandVals.map(([, v]) => v) }, undefined, undefined, "exact");
        }
        if (builtinBrandNoEnumKeys(a0)) {
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
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
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
      // target 字面量：null/undefined → TypeError 硬抛；装箱 prim → M5
      // 抛错域判定（bigint 恒抛 / string 下标写定抛 / number·bool 安全返原值）
      const t0 = args[0];
      if (t0 && t0.term?.op === "lit") {
        if (t0.term.value === null || t0.term.value === undefined) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        const dom = primTargetAssignThrows(t0, args.slice(1));
        if (dom === "definite") throw new NudoThrow(errorTypeAbs("TypeError"));
        if (dom === "may") {
          recordMayThrow({
            kind: "TypeError",
            cause: "Object.assign boxed target index write may be read-only",
          });
          return t0;
        }
        if (dom === "never") {
          // string → 原生返回 String wrapper（expando 键不进 JSON 序列化面，
          // 序列化同原始串）→ 折原始串；number/bool → 原生返回带 expando 的
          // Number/Boolean wrapper（值域 ≠ 原始值）→ 有源时降级
          const type = (t0.shape as { k: "prim"; type: string }).type;
          if (args.length === 1 || type === "string") return t0;
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
        const pre = acc; // Bug 128：accessorTable/protoTable 按 Abs 身份注册——拷贝丢身份，分类用拷贝前原 Abs
        acc = { ...acc }; // 保持结构；细粒度 spread 在 evalCall 侧
        const src = args[i]!;
        if (acc.shape.k === "obj" && src.shape.k === "obj") {
          const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
          const over = (src.shape as { slots: Record<string, { value: Abs }> }).slots;
          // enumerable:false 自有键不拷贝（EnumerableOwnProperties）；symbol
          // 投影槽随拷（@@X 标记保留——原生 assign 复制可枚举 symbol 键）
          const filtered: Record<string, { value: Abs }> = { ...base };
          let opened = false;
          let protoSet: Abs | undefined;
          for (const k of enumKeys(over as Record<string, unknown>, src, true)) {
            // Bug 128：逐键 [[Set]]（OrdinarySet）语义——此前直写自有槽：
            // __proto__ 继承访问器不触发（原型污染面：JSON.parse 源键被折
            // 成自有数据键）、自有访问器 setter 被数据覆写、继承非可写数据
            // 属性不拦截不抛。分类共享 classifyAssignSet（evaluator 的
            // mergeObj 就地同源）。源值走 [[Get]]（readProperty——getter
            // 求值，不再拷访问器占位槽）。
            const v = readProperty(src, k);
            const plan = classifyAssignSet(pre, k, v);
            if (plan.act === "throw") {
              throw new NudoThrow(errorTypeAbs("TypeError"));
            } else if (plan.act === "write") {
              setSlot(filtered, k, { value: v }); // "__proto__" 自有键经 setSlot（普通赋值触发宿主原型 setter）
            } else if (plan.act === "open") {
              opened = true;
            } else if (plan.act === "proto") {
              protoSet = plan.proto;
            } else if (plan.act === "setter") {
              plan.set(acc, v);
            }
          }
          acc = abs(
            { k: "obj", slots: filtered, ...(opened ? { open: true } : {}) },
            undefined,
            undefined,
            confJoin(acc.conf, src.conf),
          );
          if (protoSet !== undefined) setProtoAbs(acc, protoSet);
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
            // Bug 128：非 obj 源（tuple/字符串——下标键）同样逐键 [[Set]]
            //（目标自有访问器 setter / 非可写拦截；下标键不会是 __proto__）
            const filtered: Record<string, { value: Abs }> = { ...base };
            let opened = false;
            for (const [k, s] of Object.entries(srcSlots)) {
              const plan = classifyAssignSet(pre, k, s.value);
              if (plan.act === "throw") {
                throw new NudoThrow(errorTypeAbs("TypeError"));
              } else if (plan.act === "write") {
                setSlot(filtered, k, { value: s.value }); // "__proto__" 自有键经 setSlot
              } else if (plan.act === "open") {
                opened = true;
              } else if (plan.act === "setter") {
                plan.set(acc, s.value);
              }
            }
            acc = abs(
              { k: "obj", slots: filtered, ...(opened ? { open: true } : {}) },
              undefined,
              undefined,
              confJoin(acc.conf, src.conf),
            );
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
      // Bug 39：描述符校验先于 key 保守回退——原生 ToPropertyDescriptor 对
      // key 值不敏感，desc 定抛/may 抛都要记
      validateDescriptorObject(args[2], "Object.defineProperty");
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
            // Bug 84：internal 私有槽非自有属性，不产 descriptor
            if ((os.slots[key] as { internal?: boolean })?.internal === true) continue;
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
        // Bug 84：internal 私有槽非自有属性，不产 descriptor
        const entries = Object.keys(os.slots)
          .filter((key) => (os.slots[key] as { internal?: boolean })?.internal !== true)
          .map((key) => [key, os.slots[key]!.value] as [string, Abs]);
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
            // Bug 66：inherited 槽（name——原生经 X.prototype 原型链解析，
            // 非实例自有）不在 gOPN 面；message/stack（/errors/cause）自有
            // 不可枚举照列
            return abs(
              {
                k: "tuple",
                elements: Object.keys(os.slots)
                  .filter((n) => (os.slots[n] as { inherited?: boolean } | undefined)?.inherited !== true)
                  .map((n) => strLit(n)),
              },
              undefined,
              undefined,
              "exact",
            );
          }
        }
        if (builtinBrandNoEnumKeys(a0)) {
          return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        }
        // Bug 84：用户类实例——自有字符串键投影（含不可枚举；私有槽
        // Slot.internal 剔除——原生私有字段对 gOPN 不可见；此前整 brand
        // 保守 partial string[]）；Bug 66 inherited 槽（error 家族 name）同剔
        {
          const inner = classInstanceInnerOf(a0);
          if (inner) {
            const os = inner.shape as unknown as {
              slots: Record<string, { internal?: boolean; inherited?: boolean }>;
            };
            const names = Object.keys(os.slots).filter(
              (k) => os.slots[k]!.internal !== true && os.slots[k]!.inherited !== true,
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
          // internal 私有槽剔除（Bug 84——内部槽对 gOPN 不可见）
          return abs(
            {
              k: "tuple",
              elements: Object.keys(os.slots)
                .filter((n) => (os.slots[n] as { internal?: boolean })?.internal !== true)
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
      /**
       * Bug 57/84：访问器属性描述符（get/set thunk 包成 fn Abs；
       * 调用经 apply 钩子求值）。this 回退 target——gOPD 返回的
       * 描述符 getter 被调用时 this 为接收者（obj 臂为本体 a0、
       * 类实例臂为承载槽的内层 inner，但原生 this 是 brand 实例，
       * 侧表 thunk 闭包已绑定接收者语义）。
       */
      const accessorDescOf = (target: Abs, key: string): Abs | undefined => {
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
      };
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
    case "groupBy": {
      // Bug 5：ES2024 Object.groupBy —— 校验面 + null 原型分组投影：
      // 键 ToPropertyKey 字符串槽 → 值元组（保序物化）；键集不可判 → 开放
      // null 原型 obj（未知键读 unknown，不假 undefined）
      const fold = foldGroupBy(a0, args[1], "Object.groupBy", "property");
      if (fold.status === "unknown") {
        return markNullProtoObj(
          abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "partial"),
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
        return markNullProtoObj(
          abs({ k: "obj", slots, open: true }, undefined, undefined, "partial"),
        );
      }
      return markNullProtoObj(abs({ k: "obj", slots }, undefined, undefined, conf));
    }
    default:
      return undefined;
  }
}

