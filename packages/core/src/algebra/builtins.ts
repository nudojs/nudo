/**
 * Abs 侧常用 builtin：shape 级运算，不依赖 TypeValue host 库。
 * 覆盖 Math / Object / JSON / Number / 全局转换函数的常见面。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, confJoin, isExactLit } from "./abs.ts";
import { joinAbs, objOf, markNullProtoObj, canonicalArrayIndex, getSlot, isNullProtoObj } from "./objects.ts";
import { registerSymbolMeta, symbolIdOf, symbolDescriptionAbs, isSymbolAbs as isSymAbs } from "./symbol-id.ts";
import { TUPLE_MATERIALIZE_CAP } from "./containers.ts";
import {
  isMapAbs,
  isSetAbs,
  makeMapAbs,
  makeSetAbs,
  mapGetEntry,
  mapHasEntry,
  mapSetEntry,
  mapDeleteEntry,
  mapClearEntries,
  mapSizeAbs,
  setAddEntry,
  setHasEntry,
  setDeleteEntry,
  setClearEntries,
  setSizeAbs,
  setElementsAbs,
  mapEntriesAbs,
  ctorArgDefinitelyInvalid,
} from "./collections.ts";
import { applyCallbackValue, undefAbs, asAbs } from "./hof.ts";
import { absFunction, getFnImpl } from "./abs-fn.ts";
import { instantiateReturn } from "./hof.ts";
import { markClassValue } from "./class-mark.ts";

const noBody = { type: "BlockStatement", body: [], directives: [] } as never;
import { matchIterElements } from "./exec/match-iter.ts";
import { NudoThrow } from "./exec/nudo-throw.ts";
import { errorTypeAbs } from "./exec/may-throw.ts";
import { pTrue } from "./pred.ts";
import { defaultLeakBudget } from "./leak.ts";
import { emptyEnv } from "./ast-env.ts";

function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

function str(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, conf);
}

function boolPrim(conf: Abs["conf"] = "partial"): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, conf);
}

// --- 对象不变性侧表（freeze/seal/preventExtensions/defineProperty） ---
// WeakMap 侧表（同 exec accessorTable 模式）：Abs 不可变，写路径（$set/$del/
// $idxSet/$arrMutContainer/runtimeAssignObject）读侧表复现 sloppy 静默失败；
// 产生新副本的写路径负责迁移（$set/$del 里 migrateInvariants）。

export type ExtState = "nonext" | "sealed" | "frozen";
export type PropFlags = {
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
};

const extStateTable = new WeakMap<Abs, ExtState>();
const propFlagsTable = new WeakMap<Abs, Map<string, PropFlags>>();

export function markExtState(o: Abs, s: ExtState): Abs {
  extStateTable.set(o, s);
  return o;
}

export function extStateOf(o: Abs): ExtState | undefined {
  return extStateTable.get(o);
}

export function getPropFlags(o: Abs): Map<string, PropFlags> | undefined {
  return propFlagsTable.get(o);
}

export function setPropFlags(o: Abs, key: string, f: PropFlags): void {
  let m = propFlagsTable.get(o);
  if (!m) {
    m = new Map();
    propFlagsTable.set(o, m);
  }
  m.set(key, f);
}

/** 写路径产生新副本时迁移不变性侧表（同 migrateAccessors 模式）。
 *  propFlags 深拷贝：fork/switch 的 $copy 副本不得与源共享可变 Map
 *  （一臂 defineProperty 不得污染另一臂）。 */
export function migrateInvariants(from: Abs, to: Abs): void {
  if (to === from) return;
  const s = extStateTable.get(from);
  if (s !== undefined) extStateTable.set(to, s);
  const f = propFlagsTable.get(from);
  if (f) propFlagsTable.set(to, new Map(f));
}

/** Math.* — 字面量可折叠的返回精确值，否则 number */
export function evalMathMethod(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  const a1 = args[1] ? litValue(args[1]) : undefined;
  switch (name) {
    case "abs":
      if (typeof a0 === "number") return numLit(Math.abs(a0));
      return numPrim();
    case "floor":
      if (typeof a0 === "number") return numLit(Math.floor(a0));
      return numPrim();
    case "ceil":
      if (typeof a0 === "number") return numLit(Math.ceil(a0));
      return numPrim();
    case "round":
      if (typeof a0 === "number") return numLit(Math.round(a0));
      return numPrim();
    case "random":
      return numPrim("path");
    case "sqrt":
      if (typeof a0 === "number") return numLit(Math.sqrt(a0));
      return numPrim();
    case "min": {
      const lits = args.map(litValue);
      if (lits.length > 0 && lits.every((x) => typeof x === "number")) {
        return numLit(Math.min(...(lits as number[])));
      }
      return numPrim();
    }
    case "max": {
      const lits = args.map(litValue);
      if (lits.length > 0 && lits.every((x) => typeof x === "number")) {
        return numLit(Math.max(...(lits as number[])));
      }
      return numPrim();
    }
    case "pow":
      if (typeof a0 === "number" && typeof a1 === "number") return numLit(Math.pow(a0, a1));
      return numPrim();
    case "sign":
      if (typeof a0 === "number") return numLit(Math.sign(a0));
      return numPrim();
    case "atan2":
      if (typeof a0 === "number" && typeof a1 === "number") {
        return numLit(Math.atan2(a0, a1));
      }
      return numPrim();
    default:
      return undefined;
  }
}

/** Object.assign 非 obj 源的键投影（原生按源 [[OwnPropertyKeys]] 逐键复制
 *  可枚举自有属性）：
 *  - tuple（数组字面量）源：下标键（hole 无自有属性 → 跳过）
 *  - 字符串字面量源：码元下标键（代理对拆两个键——spread 按码点、assign 按码元，勿混）
 *  - number/boolean/bigint/nullish/其它 prim：无自有可枚举键 → 空（忽略，原生不抛）
 *  - strPrim 非字面量 / arr / brand（含 String 包装）/ sum / fn / any：键集未知
 *    → undefined（调用方保守降级，不得折「无变化」假精确）
 */
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
    //（原生 assign 不复制 length）；open 空箱键集未知 → undefined。
    // brand.shape 是内层 Abs（objOf 产物），槽在 inner.shape.slots。
    const inner = s.shape;
    if (inner.shape.k === "obj") {
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(inner.shape.slots)) {
        if (k === "length") continue;
        slots[k] = v;
      }
      if (Object.keys(slots).length > 0 || !inner.shape.open) return slots;
    }
    return undefined;
  }
  if (s.k === "prim") return s.type === "string" ? undefined : {};
  if (s.k === "eff" || s.k === "never") return {}; // Promise 无自有可枚举键
  return undefined; // arr/brand/sum/fn/any/unknown…：键集未知
}

/** Object.keys/values/entries/assign + 不变性方法 */
export function evalObjectMethod(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0];

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
      // 对象原型实参的动态继承不建模，保守空闭对象。
      // create()/create(undefined)/prim 字面量 proto：原生 TypeError 硬抛
      if (a0 === undefined || (a0.term?.op === "lit" && a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const protoV = litValue(a0);
      if (protoV === null) return markNullProtoObj(abs({ k: "obj", slots: {} }, undefined, undefined, "exact"));
      if (typeof protoV === "object") {
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (a0.term?.op === "lit") {
        // number/string/bool/bigint/symbol 字面量 proto：原生 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return undefined; // 抽象实参保守
    }
    case "keys": {
      if (a0 && a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
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
      return abs({ k: "arr", element: str("path") }, undefined, undefined, "partial");
    }
    case "values": {
      if (a0 && a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0?.shape.k === "obj") {
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        const vals = enumKeys(slots, a0).map((k) => slots[k]!.value);
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
        return abs(
          { k: "tuple", elements: Array.from(a0.term.value, (c) => strLit(c)) },
          undefined,
          undefined,
          "exact",
        );
      }
      if (a0?.term?.op === "lit" && typeof a0.term.value === "number") {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "entries": {
      if (a0 && a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (a0?.shape.k === "obj") {
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        const entries = enumKeys(slots, a0).map((k) =>
          abs({ k: "tuple", elements: [strLit(k), slots[k]!.value] }, undefined, undefined, "exact"),
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
        return abs(
          {
            k: "tuple",
            elements: Array.from(a0.term.value, (c, i) =>
              abs({ k: "tuple", elements: [strLit(String(i)), strLit(c)] }, undefined, undefined, "exact"),
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
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "hasOwn": {
      if (!a0) return boolPrim();
      if (a0.term?.op === "lit" && (a0.term.value === null || a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const key = args[1] ? litValue(args[1]) : undefined;
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
      // 具体原型带 constructor 槽（.constructor.name 链可解）；不可判保持 unknown
      return protoOfRecv(a0);
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
      let acc = args[0]!;
      for (let i = 1; i < args.length; i++) {
        acc = { ...acc }; // 保持结构；细粒度 spread 在 evalCall 侧
        const src = args[i]!;
        if (acc.shape.k === "obj" && src.shape.k === "obj") {
          const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
          const over = (src.shape as { slots: Record<string, { value: Abs }> }).slots;
          acc = abs({ k: "obj", slots: { ...base, ...over } }, undefined, undefined, confJoin(acc.conf, src.conf));
        } else if (src.shape.k !== "obj") {
          // 非 obj 源：tuple（下标键、hole 跳过）/字符串字面量（码元键）/
          // number/boolean/nullish（无键忽略）；键集未知 → 保守降级（与
          // B-path runtimeAssignObject 同口径——此前整体忽略折假精确）
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
          // 数组 target：与 B-path runtimeAssignObject 同口径——数字键按下标写
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
      const kv = args[1] ? litValue(args[1]) : undefined;
      if (!a0 || (typeof kv !== "string" && typeof kv !== "number")) return a0;
      // prim/null 字面量 target：原生 TypeError 硬抛（Properties can only be
      // defined on Objects）
      if (a0.term?.op === "lit") throw new NudoThrow(errorTypeAbs("TypeError"));
      const key = String(kv);
      const descAbs = args[2];
      // 缺描述符：原生 TypeError（Property description must be an object）
      if (!descAbs || descAbs.shape.k !== "obj") return unknown;
      const dslots = descAbs.shape.slots;
      /**
       * 描述符字段读取：区分「缺省」「显式 undefined」「字面量值」「函数/抽象」。
       * litValue 看不到函数字段（term 非 lit），但 get/set 字段存在性决定
       * 数据/访问器冲突判定，必须读 slot 本身。
       */
      const field = (k: string): { present: boolean; v: unknown } => {
        const s = dslots[k]?.value;
        if (!s) return { present: false, v: undefined };
        const lv = litValue(s);
        if (lv !== undefined) return { present: true, v: lv };
        if (s.term?.op === "lit" && s.term.value === undefined) return { present: true, v: undefined };
        return { present: true, v: "fn-or-abstract" };
      };
      const getF = field("get");
      const setF = field("set");
      const valueF = field("value");
      // get/set 非函数且非 undefined → TypeError（Getter must be a function）
      const invalidAccessor = (f: { present: boolean; v: unknown }): boolean =>
        f.present && f.v !== undefined && f.v !== "fn-or-abstract";
      if (invalidAccessor(getF) || invalidAccessor(setF)) return unknown;
      // value 与访问器共存 → TypeError（Invalid property. 'value' present on …）
      const accessorPresent =
        (getF.present && getF.v !== undefined) || (setF.present && setF.v !== undefined);
      if (accessorPresent && valueF.present && valueF.v !== undefined) return unknown;
      const dv = (k: string): unknown => {
        const s = dslots[k]?.value;
        return s ? litValue(s) : undefined;
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
        if (writable === false) flags.writable = false;
        if (enumerable === false) flags.enumerable = false;
        if (configurable === false) flags.configurable = false;
      } else {
        if (writable !== true) flags.writable = false;
        if (enumerable !== true) flags.enumerable = false;
        if (configurable !== true) flags.configurable = false;
      }
      // value 进 slots（defineProperty 返回接收者本身；语句级写回由 transpile 负责）
      const litOf = (v: unknown): Abs | undefined => {
        if (v === undefined) return undefined; // 无 value 描述符：不动槽
        if (typeof v === "number") return numLit(v);
        if (typeof v === "string") return strLit(v);
        if (typeof v === "boolean") return boolLit(v);
        if (v === null) return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
        return undefined;
      };
      let out = a0;
      const putSlots = (inner: Abs): Abs => {
        if (inner.shape.k !== "obj") return inner;
        const lit = litOf(value);
        const slots = lit
          ? { ...inner.shape.slots, [key]: { value: lit } }
          : { ...inner.shape.slots };
        const next = abs({ k: "obj", slots }, undefined, undefined, inner.conf);
        migrateInvariants(inner, next);
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
    default:
      return undefined;
  }
}

/** 字面量树提取哨兵：子树非字面量（无法精确序列化） */
const NOT_LITERAL = Symbol("nudo:not-literal");

/** Abs 字面量树 → JS 值（JSON.stringify 折叠输入）；非字面量子树不提取 */
function absToJsonNative(a: Abs, seen: Set<object>): unknown | typeof NOT_LITERAL {
  if (seen.has(a as object)) return NOT_LITERAL; // 防御自引用（Abs 树理论无环）
  const t = a.term;
  if (t?.op === "lit") return t.value; // 含 bigint/symbol/undefined/null
  const s = a.shape;
  if (s.k === "tuple") {
    seen.add(a as object);
    const holes = (a.shape as { holes?: number[] }).holes ?? [];
    const out: unknown[] = [];
    for (let i = 0; i < s.elements.length; i++) {
      // hole 与 undefined 元素提取同为 undefined——JSON.stringify 数组槽都输出 null
      if (holes.includes(i)) {
        out.push(undefined);
        continue;
      }
      const v = absToJsonNative(s.elements[i]!, seen);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      out.push(v);
    }
    return out;
  }
  if (s.k === "obj") {
    // open/带 index 的对象有未知键：序列化结果不确定
    if (s.open || s.index) return NOT_LITERAL;
    seen.add(a as object);
    const out: Record<string, unknown> = {};
    const flags = getPropFlags(a);
    for (const [k, sv] of Object.entries(s.slots as Record<string, { value: Abs }>)) {
      // enumerable:false（defineProperty 描述符）→ JSON.stringify 跳过
      if (flags?.get(k)?.enumerable === false) continue;
      const v = absToJsonNative(sv.value, seen);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      out[k] = v;
    }
    return out;
  }
  return NOT_LITERAL;
}

/** JS 值 → Abs（JSON.parse 字面量折叠；JSON 值域无 bigint/symbol/undefined/function） */
function jsonValueToAbs(v: unknown): Abs {
  if (v === null) return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
  if (typeof v === "number") return numLit(v);
  if (typeof v === "string") return strLit(v);
  if (typeof v === "boolean") return boolLit(v);
  if (Array.isArray(v)) {
    return abs({ k: "tuple", elements: v.map(jsonValueToAbs) }, undefined, undefined, "exact");
  }
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, sv] of Object.entries(v as Record<string, unknown>)) {
    slots[k] = { value: jsonValueToAbs(sv) };
  }
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

/** JSON.parse / stringify：字面量实参真执行折叠；失败硬抛（catch 可吸收） */
export function evalJsonMethod(name: string, args: Abs[]): Abs | undefined {
  if (name === "parse") {
    // 无实参 ≡ 实参 undefined：原生 ToString(undefined)="undefined" → SyntaxError
    const a0Abs = args[0];
    if (!a0Abs) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    // reviver 实参：原生逐键变换——Abs 侧不建模，任何存在性都保守 unknown
    if (args[1]) return unknown;
    const t = a0Abs.term;
    if (t?.op !== "lit") return unknown; // 抽象实参：保守
    const v = t.value;
    if (v === undefined) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    // 原生先 ToString：number/boolean/bigint/null 都走字符串解析；
    // symbol 的 ToString 原生 TypeError
    if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    const src =
      typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean" || typeof v === "bigint"
          ? String(v)
          : v === null
            ? "null"
            : undefined;
    if (src === undefined) return unknown;
    try {
      return jsonValueToAbs(JSON.parse(src));
    } catch {
      throw new NudoThrow(errorTypeAbs("SyntaxError"));
    }
  }
  if (name === "stringify") {
    // 顶层 undefined（无参/显式/函数/symbol）→ 原生返回 undefined 值
    const a0Abs = args[0];
    if (!a0Abs) return undefAbs();
    const v = absToJsonNative(a0Abs, new Set());
    if (v === NOT_LITERAL) return str("partial");
    // replacer：数组字面量 → 白名单键；null/非数组非函数 → 原生忽略；
    // 函数 replacer / 抽象 → 保守（结果串不可判定）
    const replacerArg = args[1];
    let replacer: (string | number)[] | undefined;
    if (replacerArg) {
      const rv = absToJsonNative(replacerArg, new Set());
      if (rv === NOT_LITERAL) return str("partial");
      if (Array.isArray(rv)) {
        replacer = rv.filter(
          (x): x is string | number => typeof x === "string" || typeof x === "number",
        );
      } else if (typeof rv === "function") {
        return str("partial");
      }
      // 其余（null/prim/对象）：原生忽略 replacer，照常序列化
    }
    // space：number（NaN/±Inf→0，负→0，>10→10，截断）/ string（前 10 字符）；
    // 缺省/null/undefined → 紧凑。非字面量 → 保守
    const spaceArg = args[2];
    let space: number | string | undefined;
    if (spaceArg) {
      const t = spaceArg.term;
      if (t?.op !== "lit") return str("partial");
      const sv = t.value;
      if (typeof sv === "number") {
        space = Number.isFinite(sv) ? Math.min(10, Math.max(0, Math.floor(sv))) : 0;
      } else if (typeof sv === "string") {
        space = sv;
      } else if (sv !== undefined && sv !== null) {
        return str("partial");
      }
    }
    try {
      const s = JSON.stringify(v, replacer, space);
      return s === undefined ? undefAbs() : strLit(s);
    } catch {
      // bigint / 循环引用（防御）→ 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  return undefined;
}

/**
 * parseInt(s, radix?)：
 * - 无 radix：遵循 0x/0o/0b 前缀（不可强制 10）
 * - 有 radix 且为 2–36 整数：按显式进制
 * - radix 非法（非整数或越界）：运行时为 NaN
 */
function foldParseInt(s: string | number, radix: number | undefined): Abs {
  const str = String(s);
  if (radix === undefined) return numLit(parseInt(str));
  // 原生对 radix 做 ToInt32 截断：2.9 → 2、NaN → 0；
  // 截断后为 0 视为「未提供」（0x 前缀生效），越界 → NaN
  const r = radix | 0;
  if (r === 0) return numLit(parseInt(str));
  if (r < 2 || r > 36) return numLit(NaN);
  return numLit(parseInt(str, r));
}

/** Number.isInteger / isNaN / parseFloat 等 */
export function evalNumberStatic(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  switch (name) {
    case "isInteger":
      if (typeof a0 === "number") return boolLit(Number.isInteger(a0));
      return boolPrim();
    case "isNaN":
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      return boolPrim();
    case "isFinite":
      if (typeof a0 === "number") return boolLit(Number.isFinite(a0));
      return boolPrim();
    case "parseInt":
      if (typeof a0 === "string" || typeof a0 === "number") {
        const radix = args[1] ? litValue(args[1]) : undefined;
        if (radix === undefined) return foldParseInt(a0, undefined);
        if (typeof radix === "number") return foldParseInt(a0, radix);
        return numPrim();
      }
      return numPrim();
    case "parseFloat":
      if (typeof a0 === "string" || typeof a0 === "number") return numLit(parseFloat(String(a0)));
      return numPrim();
    case "MAX_SAFE_INTEGER":
      return numLit(Number.MAX_SAFE_INTEGER);
    default:
      return undefined;
  }
}

/** 非对象形态（prim/never/null/undefined 字面量）→ ES 不变性自省恒真/假 */
function isPrimLike(a: Abs | undefined): boolean {
  if (!a) return true; // 无实参 → undefined
  if (a.shape.k === "prim" || a.shape.k === "never") return true;
  if (a.term?.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
    return true;
  }
  return false;
}

/** 全局 parseInt / parseFloat / isNaN / Number / String / Boolean / Object / Array */
export function evalGlobalFn(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  switch (name) {
    case "eval":
      // 动态代码语义不可静态建模：保守 unknown。宿主 eval 对非字符串实参
      // 原样返回——直接调用会把 strLit Abs 对象原样传回并折成字符串假精确。
      return unknown;
    case "Array":
      // Array(n)/Array(a,b)/Array() 与 new Array 同语义（共享 makeArrayCtorAbs）
      return makeArrayCtorAbs(args);
    case "parseInt":
      if (typeof a0 === "string" || typeof a0 === "number") {
        const radix = args[1] ? litValue(args[1]) : undefined;
        if (radix === undefined) return foldParseInt(a0, undefined);
        if (typeof radix === "number") return foldParseInt(a0, radix);
        return numPrim();
      }
      return numPrim();
    case "parseFloat":
      if (typeof a0 === "string" || typeof a0 === "number") return numLit(parseFloat(String(a0)));
      return numPrim();
    case "isNaN":
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      return boolPrim();
    case "Number":
      // Number(sym) → TypeError（ToNumber 抛）
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (typeof a0 === "number") return numLit(a0);
      if (typeof a0 === "string") return numLit(Number(a0));
      if (typeof a0 === "boolean") return numLit(a0 ? 1 : 0);
      return numPrim();
    case "String":
      // String(sym) → SymbolDescriptiveString（原生不抛）；其余 ToString
      if (args[0] && isSymbolAbs(args[0])) return stringOfSymbol(args[0]);
      if (a0 !== undefined) return strLit(String(a0));
      return str();
    case "Symbol":
      // Symbol([desc])：非具体 unique symbol
      return makeSymbolAbs(args[0]);
    case "Boolean":
      if (a0 !== undefined) return boolLit(Boolean(a0));
      return boolPrim();
    case "Object": {
      // ToObject：prim 字面量装箱为包装 brand（String 箱带 length/下标槽，
      // 读 .length/[i] 与原生一致）；null/undefined/无参 → 空对象；
      // 对象形态恒等；抽象 prim → open 对象（成员读保持非具体）。
      const arg = args[0];
      if (!arg) return objOf({});
      if (arg.term?.op === "lit" && (arg.term.value === undefined || arg.term.value === null)) {
        return objOf({});
      }
      if (arg.shape.k === "prim") {
        const primType = arg.shape.type;
        if (typeof a0 === "string") {
          const slots: Record<string, { value: Abs }> = {
            length: { value: numLit(a0.length) },
          };
          for (let i = 0; i < a0.length; i++) {
            slots[String(i)] = { value: strLit(a0[i]!) };
          }
          return abs(
            { k: "brand", name: "String", shape: objOf(slots) },
            undefined,
            undefined,
            "exact",
          );
        }
        const boxName =
          primType === "number"
            ? "Number"
            : primType === "boolean"
              ? "Boolean"
              : primType === "bigint"
                ? "BigInt"
                : "Symbol";
        return abs(
          { k: "brand", name: boxName, shape: objOf({}) },
          undefined,
          undefined,
          "path",
        );
      }
      // obj/brand/arr/tuple/fn/eff/sum：ToObject 恒等
      return arg;
    }
    default:
      return undefined;
  }
}

/** brand 是编译期标签，运行时仍是底层值；isArray 须看穿 */
function peelBrand(shape: Abs["shape"]): Abs["shape"] {
  let s = shape;
  while (s.k === "brand") s = s.shape.shape;
  return s;
}

/**
 * new Array(n) / Array(n) 构造语义（B-path $new、evalGlobalFn、ast-eval
 * evalBuiltinNew 共用）：
 * - 无参 → []；
 * - 单 number 字面量整数 0..2^32-1 → n 元空洞 tuple（超物化上限降 arr）、
 *   非法 number（非整数/负数/NaN/超 2^32-1）→ NudoThrow(RangeError)；
 * - 其余字面量单实参（字符串/null/bigint…）→ 单元素 tuple；
 * - 多实参 → 字面量 tuple；抽象实参 → 保守 arr。
 */
export function makeArrayCtorAbs(args: Abs[]): Abs {
  if (args.length === 0) {
    return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
  }
  if (args.length >= 2) {
    return abs(
      { k: "tuple", elements: args.map((a) => asAbs(a) ?? unknown) },
      undefined,
      undefined,
      "exact",
    );
  }
  const a0 = args[0]!;
  if (a0.term?.op !== "lit") {
    return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
  }
  const n = litValue(a0);
  if (typeof n === "number") {
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
    if (n > TUPLE_MATERIALIZE_CAP) {
      // 合法但巨大：不物化巨 tuple
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    const els = Array.from({ length: n }, () => undefAbs());
    const holes = Array.from({ length: n }, (_, i) => i);
    return abs(
      { k: "tuple", elements: els, holes: n > 0 ? holes : undefined },
      undefined,
      undefined,
      "exact",
    );
  }
  return abs({ k: "tuple", elements: [a0] }, undefined, undefined, "exact");
}

/** Array.isArray / Array.from / Array.of */
export function evalArrayStatic(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0];
  switch (name) {
    case "isArray": {
      if (!a0) return boolLit(false);
      const s = peelBrand(a0.shape);
      if (s.k === "arr" || s.k === "tuple") return boolLit(true);
      // any/unknown/sum 可能是数组（sum 成员可含 arr/tuple）。下 `false` 结论
      // 会让 `if (Array.isArray(x))` 错误剪掉真分支（soundness bug）→ 诚实 unknown。
      if (s.k === "any" || s.k === "unknown" || s.k === "sum") return boolPrim();
      return boolLit(false);
    }
    case "of":
      return abs({ k: "arr", element: a0 ?? unknown }, undefined, undefined, "path");
    case "from": {
      // Array.from(iterable[, mapFn])：取可迭代物的元素，不是把实参整个当元素
      //（那是 Array.of 的语义）。mapFn 逐位应用 (el, i)——副作用必须落地：
      // 数组 hole 位置按迭代器 Get 语义 yield undefined（实槽）、字符串按
      // code point、Set/Map 走条目表、array-like 按 length 槽逐位（元素 undefined）。
      const mapFn = args[1];
      const hasMapFn = mapFn !== undefined && mapFn !== null;
      const mapOne = (el: Abs, i: Abs): Abs => {
        if (!hasMapFn) return el;
        return applyCallbackValue(mapFn, [el, i], emptyEnv(), pTrue, defaultLeakBudget);
      };
      if (!a0) return unknown;
      if (isSetAbs(a0) || isMapAbs(a0)) {
        const els = isSetAbs(a0) ? setElementsAbs(a0) : mapEntriesAbs(a0);
        if (els.length === 0) {
          return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
        }
        let el = mapOne(els[0]!, numLit(0));
        for (let i = 1; i < els.length; i++) el = joinAbs(el, mapOne(els[i]!, numLit(i)));
        return abs({ k: "arr", element: el }, undefined, undefined, "path");
      }
      {
        // matchAll 迭代器：逐匹配项展开
        const mi = matchIterElements(a0);
        if (mi) {
          if (mi.length === 0) {
            return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
          }
          let el = mapOne(mi[0]!, numLit(0));
          for (let i = 1; i < mi.length; i++) el = joinAbs(el, mapOne(mi[i]!, numLit(i)));
          return abs({ k: "arr", element: el }, undefined, undefined, "path");
        }
      }
      const k = a0.shape.k;
      if (k === "arr") {
        // 抽象数组：单代表元素（索引未知）
        const el = mapOne(a0.shape.element, numPrim());
        return abs({ k: "arr", element: el }, undefined, undefined, "path");
      }
      if (k === "tuple") {
        const els = a0.shape.elements;
        if (els.length === 0) return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
        let el = mapOne(els[0]!, numLit(0));
        for (let i = 1; i < els.length; i++) el = joinAbs(el, mapOne(els[i]!, numLit(i)));
        return abs({ k: "arr", element: el }, undefined, undefined, "path");
      }
      if (k === "prim" && (a0.shape as { type: string }).type === "string") {
        const sv = litValue(a0);
        if (typeof sv === "string" && hasMapFn && sv.length > 0) {
          const cps = [...sv]; // code points（surrogate pair 合并）
          let el = mapOne(strLit(cps[0]!), numLit(0));
          for (let i = 1; i < cps.length; i++) el = joinAbs(el, mapOne(strLit(cps[i]!), numLit(i)));
          return abs({ k: "arr", element: el }, undefined, undefined, "path");
        }
        return abs(
          { k: "arr", element: abs({ k: "prim", type: "string" }, undefined, undefined, "path") },
          undefined,
          undefined,
          "path",
        );
      }
      if (k === "obj") {
        // array-like：length 槽字面量 n → 逐位调（Get 缺失槽 = undefined）
        const slots = (a0.shape as { slots?: Record<string, { value: Abs }> }).slots ?? {};
        const lenSlot = slots["length"]?.value;
        const n = lenSlot ? litValue(lenSlot) : undefined;
        if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 4096) {
          if (n === 0) return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
          let el = mapOne(undefAbs(), numLit(0));
          for (let i = 1; i < n; i++) el = joinAbs(el, mapOne(undefAbs(), numLit(i)));
          return abs({ k: "arr", element: el }, undefined, undefined, "path");
        }
      }
      return unknown;
    }
    default:
      return undefined;
  }
}

/** new Date() / Date.now / date.getTime */
export function evalDateCtor(args: Abs[]): Abs {
  return abs(
    { k: "brand", name: "Date", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "path",
  );
}

export function evalDateStatic(name: string, _args: Abs[]): Abs | undefined {
  // Date.now() 非编译期常量：每次运行值都变，折叠成具体时间戳既不 sound 又
  // 让分析结果不确定（golden/memo 抖动）。返回 number（未知）。
  if (name === "now") return numPrim("path");
  return undefined;
}

export function evalDateMethod(name: string, _recv: Abs, _args: Abs[]): Abs | undefined {
  switch (name) {
    case "getTime":
    case "valueOf":
      return numPrim("path");
    case "toISOString":
    case "toString":
      return str("path");
    default:
      return undefined;
  }
}

/** new RegExp / regexp.test / exec */
export function evalRegExpCtor(args: Abs[]): Abs {
  // 字面量实参真构造验证（非法 pattern/flags 硬抛）；抽象/RegExp 实例保守
  return tryMakeRegexAbs(args) ?? pathRegExpBrand();
}

function pathRegExpBrand(): Abs {
  return abs(
    { k: "brand", name: "RegExp", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "path",
  );
}

/** RegExp brand：source/flags/lastIndex 进 slots（B-path 与 ast-eval 共用） */
export function regexBrandAbsFrom(pattern: string, flags: string): Abs {
  return abs(
    {
      k: "brand",
      name: "RegExp",
      shape: objOf({
        source: { value: strLit(pattern) },
        flags: { value: strLit(flags) },
        lastIndex: { value: numLit(0) },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * new RegExp(pattern, flags) 字面量真构造验证（$new 与 evalRegExpCtor 共用）：
 * - 无参 → /(?:)/（原生 source 归一）
 * - pattern 非字面量（抽象/RegExp 实例）→ undefined（调用方保守）
 * - symbol pattern / flags → TypeError（ToString 抛）
 * - 非法 pattern / 非法 flags（含 number/null/boolean flags 的 ToString）
 *   → SyntaxError；合法 → 精确 brand（source/flags 取真构造结果）
 */
export function tryMakeRegexAbs(args: Abs[]): Abs | undefined {
  const a0 = args[0];
  if (!a0) return regexBrandAbsFrom("(?:)", "");
  if (a0.term?.op !== "lit") return undefined;
  const pv = a0.term.value;
  if (typeof pv === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
  const fAbs = args[1];
  if (fAbs && fAbs.term?.op !== "lit") return undefined; // 抽象 flags：保守
  const fv = fAbs ? litValue(fAbs) : undefined;
  if (typeof fv === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
  const flags = fv === undefined ? "" : String(fv);
  try {
    const r = new RegExp(String(pv), flags);
    return regexBrandAbsFrom(r.source, r.flags);
  } catch (e) {
    if (e instanceof SyntaxError) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

export function evalRegExpMethod(name: string, recv: Abs, args: Abs[]): Abs | undefined {
  if (name === "test" || name === "exec") {
    // 字面量 brand（source/flags 槽）+ 字面量 subject → 真执行（与 B-path 同轨）
    const inner =
      recv.shape.k === "brand" && recv.shape.name === "RegExp"
        ? recv.shape.shape
        : undefined;
    const slots = inner && inner.shape.k === "obj" ? inner.shape.slots : undefined;
    const pat = slots ? litValue(slots["source"]?.value) : undefined;
    const flagsV = slots ? litValue(slots["flags"]?.value) : undefined;
    const subject = args[0] ? litValue(args[0]) : undefined;
    if (typeof pat === "string" && typeof subject === "string") {
      try {
        const re = new RegExp(pat, typeof flagsV === "string" ? flagsV : "");
        if (name === "test") return boolLit(re.test(subject));
        const m = re.exec(subject);
        if (!m) return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
        return abs(
          { k: "tuple", elements: m.map((g) => (g === undefined ? undefAbs() : strLit(g))) },
          undefined,
          undefined,
          "exact",
        );
      } catch {
        return undefined;
      }
    }
    return name === "test" ? boolPrim() : unknown;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 内建构造器 Abs（`.constructor` / `===` / `.name` 折叠共用）
// ---------------------------------------------------------------------------

const builtinCtorByName = new Map<string, Abs>();
const builtinCtorByAbs = new WeakMap<object, string>();

/**
 * 内建构造器一等值（Number/String/…/Promise）。
 * 与 GLOBAL_FNS 身份同一语义：`.name` 折叠字面量；`===` 与宿主同名构造器折 true。
 * 不是可任意调用的 Function——调用仍走 evalGlobalFn / $new 名派发。
 */
export function builtinCtorAbs(name: string): Abs {
  let a = builtinCtorByName.get(name);
  if (!a) {
    a = abs(
      { k: "brand", name, shape: objOf({ name: { value: strLit(name) } }) },
      undefined,
      undefined,
      "exact",
    );
    markClassValue(a as object, name);
    builtinCtorByName.set(name, a);
    builtinCtorByAbs.set(a as object, name);
  }
  return a;
}

/** Abs 侧内建构造器身份（与宿主构造器名对齐） */
export function builtinCtorNameOf(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  return builtinCtorByAbs.get(v as object);
}

/** 宿主全局构造器身份（Number === (42).constructor 折叠用） */
export function hostBuiltinCtorName(v: unknown): string | undefined {
  if (typeof v !== "function") return undefined;
  if (v === Number) return "Number";
  if (v === String) return "String";
  if (v === Boolean) return "Boolean";
  if (v === BigInt) return "BigInt";
  if (v === Symbol) return "Symbol";
  if (v === Array) return "Array";
  if (v === Object) return "Object";
  if (v === Function) return "Function";
  if (v === Promise) return "Promise";
  if (v === Date) return "Date";
  if (v === RegExp) return "RegExp";
  if (v === Map) return "Map";
  if (v === Set) return "Set";
  if (v === WeakMap) return "WeakMap";
  if (v === WeakSet) return "WeakSet";
  if (v === Error) return "Error";
  if (v === TypeError) return "TypeError";
  if (v === RangeError) return "RangeError";
  if (v === ReferenceError) return "ReferenceError";
  if (v === SyntaxError) return "SyntaxError";
  if (v === URIError) return "URIError";
  if (v === EvalError) return "EvalError";
  if (v === AggregateError) return "AggregateError";
  return undefined;
}

/**
 * 接收者 → 原型链 constructor 名（`.constructor` 折叠）。
 * null-proto 无 Object.prototype.constructor → undefined（读侧走 undef）。
 */
export function ctorNameOfRecv(recv: Abs): string | undefined {
  const s = recv.shape;
  switch (s.k) {
    case "prim":
      return s.type === "number"
        ? "Number"
        : s.type === "string"
          ? "String"
          : s.type === "boolean"
            ? "Boolean"
            : s.type === "bigint"
              ? "BigInt"
              : s.type === "symbol"
                ? "Symbol"
                : undefined;
    case "tuple":
    case "arr":
      return "Array";
    case "obj":
      return isNullProtoObj(recv) ? undefined : "Object";
    case "fn":
      return "Function";
    case "eff":
      return s.eff === "promise" ? "Promise" : "Generator";
    case "brand": {
      if (s.name === "Object.prototype") return "Object";
      if (s.name.endsWith(".prototype")) return s.name.slice(0, -".prototype".length);
      return s.name;
    }
    case "sum": {
      let first: string | undefined;
      for (const m of s.members) {
        const n = ctorNameOfRecv(m);
        if (n === undefined) return undefined;
        if (first === undefined) first = n;
        else if (first !== n) return undefined;
      }
      return first;
    }
    default:
      return undefined;
  }
}

/** `X.prototype` 形态（getPrototypeOf 结果；带 constructor 槽） */
export function protoBrandAbs(ctorName: string): Abs {
  return abs(
    {
      k: "brand",
      name: `${ctorName}.prototype`,
      shape: objOf({ constructor: { value: builtinCtorAbs(ctorName) } }),
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * Object.getPrototypeOf 的具体原型投影（constructor 链可解）。
 * null-proto → null 字面量；不可判形态 → unknown（不假装精确原型）。
 */
export function protoOfRecv(a: Abs): Abs {
  const s = a.shape;
  const nullProtoLit = abs(
    { k: "unknown" },
    { op: "lit", value: null as never },
    pTrue,
    "exact",
  );
  if (s.k === "tuple" || s.k === "arr") return protoBrandAbs("Array");
  if (s.k === "prim") {
    const ctor =
      s.type === "number"
        ? "Number"
        : s.type === "string"
          ? "String"
          : s.type === "boolean"
            ? "Boolean"
            : s.type === "bigint"
              ? "BigInt"
              : s.type === "symbol"
                ? "Symbol"
                : undefined;
    return ctor ? protoBrandAbs(ctor) : unknown;
  }
  if (s.k === "fn") return protoBrandAbs("Function");
  if (s.k === "eff" && s.eff === "promise") return protoBrandAbs("Promise");
  if (s.k === "brand") {
    if (s.name === "Object.prototype") return nullProtoLit;
    if (s.name.endsWith(".prototype")) return objectProtoBrand();
    return protoBrandAbs(s.name);
  }
  if (s.k === "obj") {
    if (isNullProtoObj(a)) return nullProtoLit;
    return objectProtoBrand();
  }
  return unknown;
}

// ---------------------------------------------------------------------------
// Promise：new Promise / Promise.resolve / reject / all / then
// ---------------------------------------------------------------------------

/** Promise executor 作用域：fork 计数（first-wins vs 路径 join） */
const promiseExecStack: number[] = [];

export function enterPromiseExecutorScope(): void {
  promiseExecStack.push(0);
}

export function leavePromiseExecutorScope(): number {
  return promiseExecStack.pop() ?? 0;
}

/** $fork 在 executor 内发生时打点（多臂 resolve 需 join，不得 first-wins 假精确） */
export function notePromiseExecutorFork(): void {
  if (promiseExecStack.length > 0) {
    promiseExecStack[promiseExecStack.length - 1]!++;
  }
}

function promiseAbs(inner: Abs, conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "eff", eff: "promise", inner }, undefined, undefined, conf);
}

function promiseUnknown(): Abs {
  return promiseAbs(unknown, "partial");
}

/** resolve 实参是 thenable → 展开 inner（与 Promise.resolve 同口径） */
function unwrapThenable(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") return v.shape.inner;
  return v;
}

/** JS 原始值 / null → Abs 字面量（resolveJs 等宿主回调桥） */
function litFromJs(value: unknown): Abs {
  if (value === undefined) return undefAbs();
  if (value === null) {
    return abs({ k: "unknown" }, { op: "lit", value: null as never }, pTrue, "exact");
  }
  if (typeof value === "number") return numLit(value);
  if (typeof value === "string") return strLit(value);
  if (typeof value === "boolean") return boolLit(value);
  if (typeof value === "bigint") return bigintLit(value);
  return unknown;
}

// then/catch 回调是微任务：不得在同步 then() 里跑（否则外层 return 前被写回）。
// 在 callTranspiledExportFull 出口排空，对齐原生执行序。
const promiseMicros: Array<() => void> = [];

export function queuePromiseMicro(task: () => void): void {
  promiseMicros.push(task);
}

export function drainPromiseMicros(): void {
  while (promiseMicros.length > 0) {
    const task = promiseMicros.shift()!;
    try {
      task();
    } catch {
      /* 微任务抛错不改写已计算的同步返回值 */
    }
  }
}

/**
 * new Promise(executor)：调用 executor(resolve, reject)，收集 resolve 实参作为
 * promise inner。原生只认第一次 settle——顺序双 resolve 取第一次；执行器内
 * $fork 分叉时各臂 settle 值 join（路径敏感，不得 first-wins 假精确）。
 * reject 不填 resolved 通道；永不 settle / 抽象 fn / 执行抛 → promise<unknown>。
 */
export function evalPromiseCtor(args: Abs[]): Abs {
  const executor = args[0];
  if (!executor) return promiseUnknown();

  let hasSettle = false;
  let hasResolve = false;
  const resolveValues: Abs[] = [];

  const onResolve = (value?: unknown): Abs => {
    const raw = asAbs(value) ?? litFromJs(value);
    const v = unwrapThenable(raw);
    if (!hasSettle) {
      hasSettle = true;
      hasResolve = true;
      resolveValues.push(v);
    } else if (hasResolve) {
      // 后续 resolve：顺序 no-op（first-wins）或另一 fork 臂（稍后 join）
      resolveValues.push(v);
    }
    return undefAbs();
  };
  const onReject = (_reason?: unknown): Abs => {
    if (!hasSettle) hasSettle = true;
    return undefAbs();
  };

  // B 路径 $callNamed("r", r, …) 对 JS 函数直调；Abs fn 走 applyCallbackValue/$call
  // 必须包成 Abs fn：裸 JS 函数当实参时 $call 认不出 apply，fork 臂里 r(1) 会掉成 unknown
  const resolveAbs = absFunction(["value"], {
    body: noBody,
    apply: (args) => onResolve(args[0]),
  });
  const rejectAbs = absFunction(["reason"], {
    body: noBody,
    apply: (args) => onReject(args[0]),
  });

  enterPromiseExecutorScope();
  try {
    if (typeof executor === "function") {
      (executor as (...a: unknown[]) => unknown)(
        (value?: unknown) => onResolve(value),
        (reason?: unknown) => onReject(reason),
      );
    } else if (executor && typeof executor === "object" && "shape" in (executor as object)) {
      const impl = getFnImpl(executor as Abs);
      const k = (executor as Abs).shape.k;
      // 抽象 fn（无 body/apply）：不可执行，保持 promise<unknown>
      if (!impl?.body && !impl?.apply && k === "fn" && !impl?.relation) {
        return promiseUnknown();
      }
      applyCallbackValue(executor, [resolveAbs, rejectAbs], emptyEnv(), pTrue, defaultLeakBudget);
    } else {
      return promiseUnknown();
    }
  } catch {
    // executor 抛出 → rejected promise；resolved 通道不假装 settle
    return promiseUnknown();
  }
  const forks = leavePromiseExecutorScope();

  if (!hasResolve || resolveValues.length === 0) return promiseUnknown();
  // 无 fork：顺序双 resolve 取第一次（原生 no-op）；有 fork：各臂 join
  const inner =
    forks === 0 || resolveValues.length === 1
      ? resolveValues[0]!
      : resolveValues.reduce((a, b) => joinAbs(a, b));
  return promiseAbs(inner, "path");
}

/** then/catch/finally：可映射回调 → 新 inner；做不到诚实 promise<unknown> */
export function evalPromiseMethod(
  name: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (recv.shape.k !== "eff" || recv.shape.eff !== "promise") return undefined;
  const inner = recv.shape.inner;
  switch (name) {
    case "then": {
      const onFulfilled = args[0];
      if (!onFulfilled) return promiseAbs(inner, recv.conf === "exact" ? "path" : recv.conf);
      // 纯 relation 回调：同步收窄 inner（analyze 路径立刻可读）
      const rel = getFnImpl(onFulfilled)?.relation;
      if (rel && !getFnImpl(onFulfilled)?.body && !getFnImpl(onFulfilled)?.apply) {
        const mapped = instantiateReturn(onFulfilled, [inner]);
        return promiseAbs(unwrapThenable(mapped), recv.conf === "exact" ? "path" : recv.conf);
      }
      // 先建 promise 占位，回调在微任务里填 inner（原生 then 不同步跑回调）
      const resultPromise = promiseAbs(unknown, "path");
      queuePromiseMicro(() => {
        const mapped = applyCallbackValue(
          onFulfilled,
          [inner],
          emptyEnv(),
          pTrue,
          defaultLeakBudget,
        );
        // 调用失败：无 term 的 unknown 单例。回调返回 undefined（undefAbs）合法。
        const next =
          !mapped || (mapped.shape.k === "unknown" && mapped.term === undefined)
            ? unknown
            : unwrapThenable(mapped);
        (resultPromise.shape as { inner: Abs }).inner = next;
      });
      return resultPromise;
    }
    case "catch": {
      // 只建模 resolved 通道：onRejected 映射 reject reason（unknown）→ 可能 resolve
      // 回调同样进微任务，不污染同步返回路径
      const onRejected = args[0];
      if (!onRejected) return promiseAbs(inner, recv.conf === "exact" ? "path" : recv.conf);
      const resultPromise = promiseAbs(inner, "path");
      queuePromiseMicro(() => {
        const recovered = applyCallbackValue(
          onRejected,
          [unknown],
          emptyEnv(),
          pTrue,
          defaultLeakBudget,
        );
        if (!recovered || (recovered.shape.k === "unknown" && recovered.term === undefined)) {
          (resultPromise.shape as { inner: Abs }).inner = unknown;
          return;
        }
        (resultPromise.shape as { inner: Abs }).inner = joinAbs(
          inner,
          unwrapThenable(recovered),
        );
      });
      return resultPromise;
    }
    case "finally": {
      // finally 不改变 settled value（回调返回值丢弃）
      return promiseAbs(inner, recv.conf === "exact" ? "path" : recv.conf);
    }
    default:
      return undefined;
  }
}

export function evalPromiseStatic(name: string, args: Abs[]): Abs | undefined {
  switch (name) {
    case "resolve": {
      const inner = args[0] ?? unknown;
      // Promise.resolve(thenable) 展开
      if (inner.shape.k === "eff" && inner.shape.eff === "promise") return inner;
      return promiseAbs(inner, "path");
    }
    case "reject":
      return promiseUnknown();
    case "all": {
      const a0 = args[0];
      if (a0?.shape.k === "arr" && a0.shape.element.shape.k === "eff") {
        return promiseAbs(
          abs({ k: "arr", element: a0.shape.element.shape.inner }, undefined, undefined, "path"),
          "path",
        );
      }
      return promiseAbs(
        abs({ k: "arr", element: unknown }, undefined, undefined, "partial"),
        "partial",
      );
    }
    default:
      return undefined;
  }
}

/** 命名空间分派入口 */
export function evalNamespaceCall(
  ns: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  switch (ns) {
    case "Math":
      return evalMathMethod(method, args);
    case "Object":
      return evalObjectMethod(method, args);
    case "JSON":
      return evalJsonMethod(method, args);
    case "Number":
      return evalNumberStatic(method, args);
    case "String":
      return evalStringStatic(method, args);
    case "Array":
      return evalArrayStatic(method, args);
    case "Date":
      return evalDateStatic(method, args);
    case "Promise":
      return evalPromiseStatic(method, args);
    default:
      return undefined;
  }
}

/** JS Error 家族构造器名（B 路径与 ast-eval 共用） */
const ERROR_CTOR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

export function isErrorCtorName(name: string | undefined): boolean {
  return !!name && ERROR_CTOR_NAMES.has(name);
}

/** Error 构造器 message 槽：原生恒为字符串（缺省/undefined → ""；非字符串
 *  字面量 → ToString）。非字面量保守（字符串保持、其余 strPrim）。 */
function errorMessageSlot(messageArg: Abs | undefined): Abs {
  if (!messageArg) return strLit(""); // new Error() → ""
  if (messageArg.term?.op === "lit") {
    const v = messageArg.term.value;
    if (typeof v === "string") return messageArg;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      return strLit(String(v));
    }
    if (v === null) return strLit("null");
    if (v === undefined) return strLit(""); // new Error(undefined) → ""
    // symbol 等：原生 ToString 抛 TypeError——保守 unknown，不折精确值
    return str();
  }
  if (messageArg.shape.k === "prim" && messageArg.shape.type === "string") {
    return messageArg;
  }
  return str();
}

/**
 * Error brand：shape 带 name/message（字面量 message 保精确）。
 * AggregateError(errors, message[, options])：message 在第二实参，errors
 * 挂 .errors（原生是实参数组副本）；options.cause 挂 .cause（闭槽 miss
 * 会折 undefined 假精确——原生 .cause 可能有值）。
 * $new 与 ast-eval 的 new Error 共用——catch 形参成员访问可解。
 */
export function errorBrandAbs(name: string, args: Abs[]): Abs {
  const messageArg = name === "AggregateError" ? args[1] : args[0];
  const slots: Record<string, { value: Abs }> = {
    name: { value: strLit(name) },
    message: { value: errorMessageSlot(messageArg) },
  };
  if (name === "AggregateError") {
    // errors：字面量 tuple 保留精确；抽象/缺省（原生 []）保守 unknown
    slots["errors"] = { value: args[0] ?? unknown };
  }
  const optionsArg = name === "AggregateError" ? args[2] : args[1];
  if (optionsArg && optionsArg.shape.k === "obj") {
    const cause = Object.prototype.hasOwnProperty.call(optionsArg.shape.slots, "cause")
      ? optionsArg.shape.slots["cause"]!.value
      : undefAbs();
    slots["cause"] = { value: cause };
  }
  return abs(
    {
      k: "brand",
      name,
      shape: objOf(slots),
    },
    undefined,
    undefined,
    "path",
  );
}

/** new X(...) */
export function evalBuiltinNew(className: string, args: Abs[]): Abs | undefined {
  switch (className) {
    case "Date":
      return evalDateCtor(args);
    case "RegExp":
      return evalRegExpCtor(args);
    case "Symbol":
      // new Symbol() 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    case "Promise":
      return evalPromiseCtor(args);
    case "Array":
      return makeArrayCtorAbs(args);
    case "Map":
      // C1.1：可选 entry 元组列表填充字面量映射；
      // 确定非法实参（prim 条目/非可迭代）→ NudoThrow(TypeError)
      // （与 B-path $new 同口径；ast-eval NewExpression 吸收为 EvalResult{threw}）
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    case "Set":
      // C1.2：从 iterable 填充元素联合
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    default:
      // C2.2：Error 家族 → name/message 槽
      if (isErrorCtorName(className)) {
        return errorBrandAbs(className, args);
      }
      return undefined;
  }
}

/** brand 实例方法（Date/RegExp/Map/Set） */
export function evalBuiltinInstanceMethod(
  brandName: string,
  method: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (brandName === "Date") return evalDateMethod(method, recv, args);
  if (brandName === "RegExp") return evalRegExpMethod(method, recv, args);
  if (brandName === "Map") {
    switch (method) {
      case "get":
        return mapGetEntry(recv, args[0]);
      case "has":
        return mapHasEntry(recv, args[0]);
      case "set":
        return mapSetEntry(recv, args[0], args[1] ?? unknown);
      case "delete":
        return mapDeleteEntry(recv, args[0]);
      case "clear":
        return mapClearEntries(recv);
      case "size":
        return mapSizeAbs(recv);
      default:
        return undefined;
    }
  }
  if (brandName === "Set") {
    switch (method) {
      case "has":
        return setHasEntry(recv, args[0]);
      case "add":
        return setAddEntry(recv, args[0] ?? unknown);
      case "delete":
        return setDeleteEntry(recv, args[0]);
      case "clear":
        return setClearEntries(recv);
      case "size":
        return setSizeAbs(recv);
      default:
        return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// A. String.fromCharCode
// ---------------------------------------------------------------------------

/** JS ToUint16（fromCharCode 逐实参）：ToNumber 后截断并对 2^16 取模 */
function toUint16(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const int = Math.trunc(n);
  return ((int % 65536) + 65536) % 65536;
}

/**
 * String.fromCharCode(...)：
 * - 全部字面量 → 按 ToUint16 折成精确字符串（含越界/非整数/数字字符串）
 * - symbol 字面量 → TypeError（ToNumber 抛）
 * - 任一抽象实参 → 抽象 string（不假精确）
 */
export function evalStringStatic(name: string, args: Abs[]): Abs | undefined {
  if (name !== "fromCharCode") return undefined;
  const codes: number[] = [];
  for (const a of args) {
    if (isSymbolAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (a.term?.op !== "lit") return str("path");
    const v = a.term.value;
    if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (typeof v === "number") {
      codes.push(toUint16(v));
      continue;
    }
    if (typeof v === "string" || typeof v === "boolean" || v === null) {
      codes.push(toUint16(Number(v)));
      continue;
    }
    if (typeof v === "bigint") throw new NudoThrow(errorTypeAbs("TypeError"));
    // undefined / 其它：ToNumber(undefined)=NaN → 0
    codes.push(0);
  }
  return strLit(String.fromCharCode(...codes));
}

// ---------------------------------------------------------------------------
// C. Symbol() / Symbol("desc")
// ---------------------------------------------------------------------------

function undefLit(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined as never }, pTrue, "exact");
}

/**
 * Symbol([description])：非具体 unique symbol（prim type=symbol，无 term）。
 * - 身份：侧表 id（两个 Symbol() 的 === 为 false；同 Abs 引用为 true）
 * - .description：字面量 string 或 undefined
 * - 不折成可比较的字面量身份（description 不作 identity）
 */
export function makeSymbolAbs(descArg?: Abs): Abs {
  let description: Abs;
  if (descArg === undefined) {
    description = undefLit();
  } else if (descArg.term?.op === "lit") {
    const v = descArg.term.value;
    if (v === undefined) description = undefLit();
    else if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    else description = strLit(String(v));
  } else {
    // 抽象 description：ToString 结果未知（string 或 undefined）
    description = abs({ k: "prim", type: "string" }, undefined, undefined, "partial");
  }
  const a: Abs = {
    shape: { k: "prim", type: "symbol" },
    conf: "path",
  };
  return registerSymbolMeta(a, description);
}

export const isSymbolAbs = isSymAbs;
export { symbolIdOf, symbolDescriptionAbs };

/** SymbolDescriptiveString：`Symbol()` / `Symbol(desc)` */
function symbolDescriptiveString(a: Abs): string {
  const d = symbolDescriptionAbs(a);
  const dv = d ? litValue(d) : undefined;
  if (typeof dv === "string") return dv.length > 0 ? `Symbol(${dv})` : "Symbol()";
  return "Symbol()";
}

/** 全局 Symbol([desc])（$callNamed 身份校验后派发） */
export function evalSymbolCtor(args: Abs[]): Abs {
  return makeSymbolAbs(args[0]);
}

/** String(sym) → SymbolDescriptiveString（原生不抛；隐式 ToString 才抛） */
export function stringOfSymbol(a: Abs): Abs {
  const d = symbolDescriptionAbs(a);
  if (d) {
    // description 槽在：undefined 字面量 → "Symbol()"；string 字面量 → Symbol(desc)
    if (d.term?.op === "lit") return strLit(symbolDescriptiveString(a));
  }
  return str("path");
}

// ---------------------------------------------------------------------------
// B. Object.prototype 方法
// ---------------------------------------------------------------------------

export const OBJECT_PROTO_METHOD_NAMES = new Set([
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "valueOf",
  "toString",
  "toLocaleString",
]);

let objectProtoSingleton: Abs | undefined;

/** Object.prototype 单例（$get(Object, "prototype") 与 host Object.prototype 共用）。
 *  带 constructor 槽（不可枚举）供 `.constructor` / `.constructor.name` 链折叠。 */
export function objectProtoBrand(): Abs {
  if (!objectProtoSingleton) {
    const a = abs(
      {
        k: "brand",
        name: "Object.prototype",
        shape: objOf({ constructor: { value: builtinCtorAbs("Object") } }),
      },
      undefined,
      undefined,
      "exact",
    );
    setPropFlags(a, "constructor", { enumerable: false, writable: true, configurable: true });
    objectProtoSingleton = a;
  }
  return objectProtoSingleton;
}

export function isObjectProtoBrand(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Object.prototype";
}

/** ToPropertyKey：字面量 → 字符串键；抽象/symbol → 标记 */
function toPropKey(a: Abs | undefined): string | "abstract" {
  if (a === undefined) return "undefined";
  const t = a.term;
  if (t?.op !== "lit") return "abstract";
  const v = t.value;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return "abstract"; // symbol
}

function boolPrimB(): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

function strPath(): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
}

/** hasOwnProperty 判定（自有槽 / 下标 / length / holes） */
function hasOwnDecision(recv: Abs, key: string): Abs {
  const s = recv.shape;
  if (s.k === "brand") {
    const inner = s.shape;
    // Number/Boolean/BigInt/Symbol 包装：无自有数据属性
    if (s.name === "Number" || s.name === "Boolean" || s.name === "BigInt" || s.name === "Symbol") {
      return boolLit(false);
    }
    if (inner.shape.k === "obj") {
      const slot = getSlot(inner.shape.slots, key);
      if (slot && !slot.optional) return boolLit(true);
      if (slot?.optional) return boolPrimB();
      if (!inner.shape.open) return boolLit(false);
      return boolPrimB();
    }
    return boolPrimB();
  }
  if (s.k === "obj") {
    const slot = getSlot(s.slots, key);
    if (slot && !slot.optional) return boolLit(true);
    if (slot?.optional) return boolPrimB();
    if (!s.open && recv.conf === "exact") return boolLit(false);
    return boolPrimB();
  }
  if (s.k === "tuple") {
    if (key === "length") return boolLit(true);
    const idx = canonicalArrayIndex(key);
    if (idx !== undefined) {
      if (s.holes?.includes(idx)) return boolLit(false);
      return boolLit(idx < s.elements.length);
    }
    return boolLit(false);
  }
  if (s.k === "arr") {
    if (key === "length") return boolLit(true);
    return boolPrimB();
  }
  if (s.k === "prim") {
    if (s.type === "string") {
      if (key === "length") return boolLit(true);
      const idx = canonicalArrayIndex(key);
      if (idx !== undefined) {
        const lit = litValue(recv);
        if (typeof lit === "string") return boolLit(idx < lit.length);
        return boolPrimB();
      }
      return boolLit(false);
    }
    // number/boolean/bigint/symbol 装箱：无自有数据属性
    return boolLit(false);
  }
  if (s.k === "fn") {
    if (key === "length" || key === "name") return boolLit(true);
    return boolPrimB();
  }
  return boolPrimB();
}

/** propertyIsEnumerable：自有 + 可枚举（length 不可枚举；defineProperty enumerable:false） */
function propertyIsEnumerableDecision(recv: Abs, key: string): Abs {
  const own = hasOwnDecision(recv, key);
  const ownV = litValue(own);
  if (ownV === false) return boolLit(false);
  // length 在数组/字符串包装上自有但不可枚举
  if (key === "length") {
    const s = recv.shape;
    if (s.k === "tuple" || s.k === "arr") return boolLit(false);
    if (s.k === "prim" && s.type === "string") return boolLit(false);
    if (s.k === "brand" && (s.name === "String" || s.name === "Array")) return boolLit(false);
  }
  // defineProperty(enumerable:false) 侧表
  const flags = getPropFlags(recv);
  if (flags?.get(key)?.enumerable === false) return boolLit(false);
  if (ownV === true) {
    // 下标在数组/字符串上可枚举
    return boolLit(true);
  }
  return boolPrimB();
}

function typeTagOf(recv: Abs): string | undefined {
  if (recv.term?.op === "lit") {
    const v = recv.term.value;
    if (v === null) return "Null";
    if (v === undefined) return "Undefined";
    if (typeof v === "string") return "String";
    if (typeof v === "number") return "Number";
    if (typeof v === "boolean") return "Boolean";
    if (typeof v === "bigint") return "BigInt";
    if (typeof v === "symbol") return "Symbol";
  }
  const s = recv.shape;
  if (s.k === "prim") {
    const t = s.type;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (s.k === "arr" || s.k === "tuple") return "Array";
  if (s.k === "fn") return "Function";
  if (s.k === "eff") return s.eff === "promise" ? "Promise" : "Generator";
  if (s.k === "brand") {
    // 只折叠标准 Object.prototype.toString 标签；未建模 brand（URLSearchParams
    // 等）不得假精确折 [object X]——native 在无该全局时是 ReferenceError
    const KNOWN_TAGS = new Set([
      "Object", "Array", "String", "Number", "Boolean", "Function", "Promise",
      "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
      "ReferenceError", "URIError", "EvalError", "Map", "Set", "WeakMap", "WeakSet",
      "Object.prototype",
    ]);
    const inner = s.shape;
    if (inner.shape.k === "obj") {
      const tag = getSlot(inner.shape.slots, "@@toStringTag");
      if (tag) {
        const v = litValue(tag.value);
        if (typeof v === "string") return v;
      }
    }
    if (KNOWN_TAGS.has(s.name) || s.name.endsWith("Error")) {
      return s.name === "Object.prototype" ? "Object" : s.name;
    }
    return undefined;
  }
  if (s.k === "obj") {
    const tag = getSlot(s.slots, "@@toStringTag");
    if (tag) {
      const v = litValue(tag.value);
      if (typeof v === "string") return v;
    }
    return "Object";
  }
  return "Object";
}

/**
 * Object.prototype 方法语义（B-path $invoke 与 Object.prototype.X.call 共用）。
 * null-proto 接收者无这些方法——返回 undefined（调用方走 TypeError 路径）。
 * 返回 undefined = 未接管。
 */
export function evalObjectProtoMethod(
  name: string,
  thisVal: Abs,
  args: Abs[],
): Abs | undefined {
  if (!OBJECT_PROTO_METHOD_NAMES.has(name)) return undefined;
  if (thisVal && typeof thisVal === "object" && "shape" in thisVal && isNullProtoObj(thisVal)) {
    return undefined;
  }
  // nullish this：ToObject 原生抛 TypeError
  if (thisVal && thisVal.term?.op === "lit" && (thisVal.term.value === null || thisVal.term.value === undefined)) {
    // Object.prototype.toString.call(null) 合法（返回 "[object Null]"）；
    // hasOwnProperty / valueOf 等经 ToObject 抛
    if (name !== "toString" && name !== "toLocaleString") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  switch (name) {
    case "hasOwnProperty": {
      const key = toPropKey(args[0]);
      if (key === "abstract") return boolPrimB();
      return hasOwnDecision(thisVal, key);
    }
    case "propertyIsEnumerable": {
      const key = toPropKey(args[0]);
      if (key === "abstract") return boolPrimB();
      return propertyIsEnumerableDecision(thisVal, key);
    }
    case "isPrototypeOf": {
      const v = args[0];
      if (!v) return boolLit(false);
      // 原始值 / nullish：Type(V) 不是 Object → false
      if (v.term?.op === "lit") {
        const vv = v.term.value;
        if (vv === null || vv === undefined || typeof vv !== "object") return boolLit(false);
      }
      const vk = v.shape.k;
      const vObjLike = vk === "obj" || vk === "arr" || vk === "tuple" || vk === "brand" || vk === "fn" || vk === "eff";
      if (!vObjLike && vk !== "sum" && vk !== "any" && vk !== "unknown") return boolLit(false);
      if (vObjLike && isNullProtoObj(v)) return boolLit(false);
      // Object.prototype.isPrototypeOf(普通对象) → true
      if (isObjectProtoBrand(thisVal)) {
        return vObjLike ? boolLit(true) : boolPrimB();
      }
      return boolPrimB();
    }
    case "valueOf": {
      // Object.prototype.valueOf：对象恒等；prim 装箱非具体（差分不假精确）
      const s = thisVal.shape;
      if (s.k === "prim") return abs({ k: "unknown" }, undefined, undefined, "path");
      return thisVal;
    }
    case "toString":
    case "toLocaleString": {
      const tag = typeTagOf(thisVal);
      if (tag === undefined) return str();
      return strLit(`[object ${tag}]`);
    }
  }
  return undefined;
}

/** Object.prototype.X 一等函数（bindThis：call/apply 把 receiver 注入首参） */
export function objectProtoMethodAbs(name: string): Abs {
  return absFunction(["thisArg", "arg0"], {
    body: noBody,
    bindThis: true,
    apply: (a) => {
      const recv = a[0] ?? undefLit();
      return evalObjectProtoMethod(name, recv, a.slice(1)) ?? unknown;
    },
  });
}

