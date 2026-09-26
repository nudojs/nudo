/**
 * Object.assign 非 obj 源键投影 + Object.* 静态方法
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, confJoin, isExactLit } from "../abs.ts";
import { joinAbs, objOf, markNullProtoObj, canonicalArrayIndex } from "../objects.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { boolPrim, numPrim, str, isPrimLike } from "./shared.ts";
import { type PropFlags, getPropFlags, markExtState, extStateOf, setPropFlags, migrateInvariants } from "./invariants.ts";
import { protoOfRecv } from "./ctor.ts";

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

