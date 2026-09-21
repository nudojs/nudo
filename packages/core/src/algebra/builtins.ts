/**
 * Abs 侧常用 builtin：shape 级运算，不依赖 TypeValue host 库。
 * 覆盖 Math / Object / JSON / Number / 全局转换函数的常见面。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown, confJoin, isExactLit } from "./abs.ts";
import { joinAbs, objOf, markNullProtoObj } from "./objects.ts";
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
import { applyCallbackValue, undefAbs } from "./hof.ts";
import { matchIterElements } from "./exec/match-iter.ts";
import { NudoThrow } from "./exec/nudo-throw.ts";
import { errorTypeAbs } from "./exec/may-throw.ts";
import { pTrue } from "./pred.ts";
import { defaultLeakBudget } from "./leak.ts";
import { emptyEnv } from "./ast-eval.ts";

function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

function strPrim(conf: Abs["conf"] = "path"): Abs {
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

/** 写路径产生新副本时迁移不变性侧表（同 migrateAccessors 模式） */
export function migrateInvariants(from: Abs, to: Abs): void {
  const s = extStateTable.get(from);
  if (s !== undefined) extStateTable.set(to, s);
  const f = propFlagsTable.get(from);
  if (f) propFlagsTable.set(to, f);
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
      // 原始值 proto（number/string/bool/bigint/symbol）原生 TypeError → unknown。
      const protoV = a0 ? litValue(a0) : undefined;
      if (protoV === null) return markNullProtoObj(abs({ k: "obj", slots: {} }, undefined, undefined, "exact"));
      if (protoV === undefined) return undefined;
      if (typeof protoV === "object") {
        return abs({ k: "obj", slots: {} }, undefined, undefined, "path");
      }
      return unknown;
    }
    case "keys": {
      if (a0?.shape.k === "obj") {
        const keys = enumKeys(
          (a0.shape as { slots: Record<string, unknown> }).slots,
          a0,
        ).map((k) => strLit(k));
        return abs({ k: "tuple", elements: keys }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: strPrim("path") }, undefined, undefined, "partial");
    }
    case "values": {
      if (a0?.shape.k === "obj") {
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        const vals = enumKeys(slots, a0).map((k) => slots[k]!.value);
        return abs({ k: "tuple", elements: vals }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "entries": {
      if (a0?.shape.k === "obj") {
        const slots = (a0.shape as { slots: Record<string, { value: Abs }> }).slots;
        const entries = enumKeys(slots, a0).map((k) =>
          abs({ k: "tuple", elements: [strPrim("exact"), slots[k]!.value] }, undefined, undefined, "exact"),
        );
        return abs({ k: "tuple", elements: entries }, undefined, undefined, "exact");
      }
      return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
    }
    case "assign": {
      // Object.assign(a, b) ≈ spread
      if (!args.length) return unknown;
      // target 字面量：null/undefined → TypeError；prim → 装箱语义未建模
      const t0 = args[0];
      if (t0 && t0.term?.op === "lit") return unknown;
      let acc = args[0]!;
      for (let i = 1; i < args.length; i++) {
        acc = { ...acc }; // 保持结构；细粒度 spread 在 evalCall 侧
        if (acc.shape.k === "obj" && args[i]!.shape.k === "obj") {
          const base = (acc.shape as { slots: Record<string, { value: Abs }> }).slots;
          const over = (args[i]!.shape as { slots: Record<string, { value: Abs }> }).slots;
          acc = abs({ k: "obj", slots: { ...base, ...over } }, undefined, undefined, confJoin(acc.conf, args[i]!.conf));
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
      // prim/null 字面量 target：原生 TypeError（Properties can only be defined on Objects）
      if (a0.term?.op === "lit") return unknown;
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
    if (v === NOT_LITERAL) return strPrim("partial");
    // replacer：数组字面量 → 白名单键；null/非数组非函数 → 原生忽略；
    // 函数 replacer / 抽象 → 保守（结果串不可判定）
    const replacerArg = args[1];
    let replacer: (string | number)[] | undefined;
    if (replacerArg) {
      const rv = absToJsonNative(replacerArg, new Set());
      if (rv === NOT_LITERAL) return strPrim("partial");
      if (Array.isArray(rv)) {
        replacer = rv.filter(
          (x): x is string | number => typeof x === "string" || typeof x === "number",
        );
      } else if (typeof rv === "function") {
        return strPrim("partial");
      }
      // 其余（null/prim/对象）：原生忽略 replacer，照常序列化
    }
    // space：number（NaN/±Inf→0，负→0，>10→10，截断）/ string（前 10 字符）；
    // 缺省/null/undefined → 紧凑。非字面量 → 保守
    const spaceArg = args[2];
    let space: number | string | undefined;
    if (spaceArg) {
      const t = spaceArg.term;
      if (t?.op !== "lit") return strPrim("partial");
      const sv = t.value;
      if (typeof sv === "number") {
        space = Number.isFinite(sv) ? Math.min(10, Math.max(0, Math.floor(sv))) : 0;
      } else if (typeof sv === "string") {
        space = sv;
      } else if (sv !== undefined && sv !== null) {
        return strPrim("partial");
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

/** 全局 parseInt / parseFloat / isNaN / Number / String / Boolean / Object */
export function evalGlobalFn(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  switch (name) {
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
      if (typeof a0 === "number") return numLit(a0);
      if (typeof a0 === "string") return numLit(Number(a0));
      if (typeof a0 === "boolean") return numLit(a0 ? 1 : 0);
      return numPrim();
    case "String":
      if (a0 !== undefined) return strLit(String(a0));
      return strPrim();
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
      return strPrim("path");
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

/** Promise：new Promise / Promise.resolve / reject / all */
export function evalPromiseCtor(_args: Abs[]): Abs {
  return abs(
    { k: "eff", eff: "promise", inner: unknown },
    undefined,
    undefined,
    "partial",
  );
}

export function evalPromiseStatic(name: string, args: Abs[]): Abs | undefined {
  switch (name) {
    case "resolve": {
      const inner = args[0] ?? unknown;
      // Promise.resolve(thenable) 展开
      if (inner.shape.k === "eff" && inner.shape.eff === "promise") return inner;
      return abs({ k: "eff", eff: "promise", inner }, undefined, undefined, "path");
    }
    case "reject":
      return abs({ k: "eff", eff: "promise", inner: unknown }, undefined, undefined, "partial");
    case "all": {
      const a0 = args[0];
      if (a0?.shape.k === "arr" && a0.shape.element.shape.k === "eff") {
        return abs(
          { k: "eff", eff: "promise", inner: abs({ k: "arr", element: a0.shape.element.shape.inner }, undefined, undefined, "path") },
          undefined,
          undefined,
          "path",
        );
      }
      return abs({ k: "eff", eff: "promise", inner: abs({ k: "arr", element: unknown }, undefined, undefined, "partial") }, undefined, undefined, "partial");
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
    return strPrim();
  }
  if (messageArg.shape.k === "prim" && messageArg.shape.type === "string") {
    return messageArg;
  }
  return strPrim();
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
    case "Promise":
      return evalPromiseCtor(args);
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

