/**
 * Object.assign 非 obj 源键投影 + Object.* 静态方法
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, confJoin, isExactLit } from "../abs.ts";
import { joinAbs, objOf, markNullProtoObj, canonicalArrayIndex, setSlot, setProtoAbs } from "../objects.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import { mapEntriesAbs } from "../collections.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isSymbolAbs } from "./symbol.ts";
import { boolPrim, numPrim, str, isPrimLike, mayCoerceThrowOperand } from "./shared.ts";
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
      // 对象原型实参的动态继承不建模，保守空闭对象。
      // create()/create(undefined)/prim 字面量 proto：原生 TypeError 硬抛
      if (a0 === undefined || (a0.term?.op === "lit" && a0.term.value === undefined)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const protoVR = litValue(a0);
      const protoV = protoVR.ok ? protoVR.value : undefined;
      if (protoV === null) return markNullProtoObj(abs({ k: "obj", slots: {} }, undefined, undefined, "exact"));
      if (typeof protoV === "object") {
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      if (a0.term?.op === "lit") {
        // number/string/bool/bigint/symbol 字面量 proto：原生 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 33：shape 先于 lit 判定——prim 形态（symbol prim 无 lit 项，
      // Symbol() 产物；抽象 number/string/bool/bigint prim 同为非对象）→
      // 原生定抛（Object prototype may only be an Object or null）
      if (a0.shape.k === "prim") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // 抽象 proto（any/unknown/含 prim 臂 union）→ may TypeError；对象形态
      //（obj/tuple/arr/fn/brand/eff）合法但动态继承不建模——保守 unknown
      //（闭空对象会假精确：'p' in Object.create({p:1}) 折 false、
      //  gPo(create({x:1}))===gPo(…) 折 true，differential 实测不健全）
      if (a0.shape.k === "any" || a0.shape.k === "unknown" || a0.shape.k === "sum") {
        recordMayThrow({ kind: "TypeError", cause: "Object.create proto must be an object or null" });
      }
      return undefined; // 动态原型继承不建模：保守 unknown（值域与前一致）
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
      // Bug 39：target 缺省 / nullish·prim 字面量 → 原生首步 IsObject 定抛
      //（原实现把 target 守卫放在 key 可判定之后——defineProperty(1, x, {})
      //  静默折 a0）
      if (!a0 || a0.term?.op === "lit") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 39：prim 形态 target（无 lit 项——symbol prim / 抽象 refined
      // prim）同为非对象 → 定抛；any/unknown/sum target → may
      if (a0.shape.k === "prim") {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // Bug 39：any/unknown/含 prim 臂 union target → may（IsObject：一切
      // prim 均抛，不止 nullish——比 ToObject 面宽，不用 nullish 助手）
      {
        const mayNonObject = (m: Abs): boolean =>
          m.shape.k === "prim" ||
          m.shape.k === "any" ||
          m.shape.k === "unknown" ||
          (m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined));
        const k = a0.shape.k;
        if (
          k === "any" ||
          k === "unknown" ||
          (k === "sum" && (a0.shape as unknown as { members: Abs[] }).members.some(mayNonObject))
        ) {
          recordMayThrow({ kind: "TypeError", cause: "Object.defineProperty target must be an object" });
        }
      }
      const kvR = args[1] ? litValue(args[1]) : undefined;
      const kv = kvR?.ok ? kvR.value : undefined;
      const descAbs = args[2];
      // Bug 39：描述符校验（先于 key 保守回退——原生 ToPropertyDescriptor
      // 对 key 值不敏感，desc 定抛/may 抛都要记）：缺省 / nullish 字面量 /
      // prim 形态（含 symbol prim）→ 定抛「Property description must be an
      // object」（node 实测 1/"s"/null/true/Symbol()/缺省全抛；[] 是对象合法）
      if (
        !descAbs ||
        (descAbs.term?.op === "lit" &&
          (descAbs.term.value === null || descAbs.term.value === undefined)) ||
        descAbs.shape.k === "prim"
      ) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // 抽象描述符（any/unknown/sum）→ may；tuple/arr/fn/brand/eff 是对象
      //（原生合法）——字段面按空描述符处理
      if (descAbs.shape.k === "any" || descAbs.shape.k === "unknown" || descAbs.shape.k === "sum") {
        recordMayThrow({ kind: "TypeError", cause: "Object.defineProperty descriptor must be an object" });
      }
      if (typeof kv !== "string" && typeof kv !== "number") return a0;
      const key = String(kv);
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
      if (invalidAccessor(getF) || invalidAccessor(setF)) return unknown;
      // value 与访问器共存 → TypeError（Invalid property. 'value' present on …）
      const accessorPresent =
        (getF.present && getF.v !== undefined) || (setF.present && setF.v !== undefined);
      if (accessorPresent && valueF.present && valueF.v !== undefined) return unknown;
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
        if (v === null) return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
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
      const mkDesc = (value: Abs, writable: boolean, enumerable: boolean, configurable: boolean): Abs =>
        abs(
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
      // 键不可判 / 槽开放：可能有也可能没有 → descriptor | undefined 联合
      const maybeDesc = (): Abs =>
        joinAbs(
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
      if (a0.shape.k === "obj") {
        const os = a0.shape as { slots: Record<string, { value: Abs }>; open?: boolean; index?: unknown };
        if (os.open || os.index || key === undefined) return maybeDesc();
        if (Object.prototype.hasOwnProperty.call(os.slots, key)) {
          const flags = getPropFlags(a0)?.get(key);
          return mkDesc(
            os.slots[key]!.value,
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

