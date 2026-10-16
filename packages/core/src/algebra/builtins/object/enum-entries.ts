/**
 * 枚举视图的接收者键投影与 groupBy 折叠：boxedStringEnumEntries（装箱
 * String 下标字符槽）、BUILTIN_BRAND_NO_ENUM_KEYS（零可枚举自有键的内建
 * brand 表）、GroupByFold/groupByElements/foldGroupBy（Object.groupBy /
 * Map.groupBy 共用）。
 *
 * Invariants:
 * - 键投影与 invariants 域同口径：isEnumerableView（propFlags enumerable:
 *   false + Slot.internal）剔除；TypedArray 全家入零键表（length 槽虽入
 *   brand 但 enumerable:false——keys/values/entries/assign 枚举视图折 []）。
 * - foldGroupBy 是 array-grouping 单一折叠（Bug 5/26）：校验序
 *   RequireObjectCoercible → 回调 IsCallable → items 可迭代性（非字符串
 *   prim 定抛 not iterable）；回调逐元素执行（(value, k) 双参）求键，键非
 *   可装字面量 → 键集开放（unkeyed 收元素域，Map shadow 值用）；property
 *   模式键经 ToPropertyKey 折字符串槽键、map 模式原始键 SameValueZero
 *   字面量合并（type 前缀区分 1 与 "1"）。
 * - 不可判（any/unknown/sum items、obj/fn/未知 brand items、不可执行回调）
 *   → status "unknown"/open，may-throw 在此记录，调用方折保守值。
 *
 * 兄弟模块边界：methods.ts（Object.groupBy/枚举 case）与 error/ 域
 * （namespace 的 Map.groupBy）共用 foldGroupBy。
 */

import type { Abs } from "../../abs.ts";
import { litValue, numLit, strLit, unknown } from "../../abs.ts";
import { mapEntriesAbs, setElementsAbs } from "../../collections.ts";
import { undefAbs, applyCallbackValue, validateCallableArg } from "../../hof.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { pTrue } from "../../pred.ts";
import { defaultLeakBudget } from "../../leak.ts";
import { emptyEnv } from "../../ast-env.ts";
import { TYPED_ARRAY_ELEMENT } from "../shared.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { str } from "../shared.ts";
import { isEnumerableView } from "../invariants.ts";

/**
 * Bug 43：boxed String brand（new String("ab") / Object('ab') 字面量箱）的
 * 可枚举自有键值对——下标字符槽（"0".."n-1"；length 不可枚举、
 * [[PrimitiveValue]] 内部槽已标 enumerable:false）。open 空箱键集未知 →
 * undefined（调用方落 generic 保守域）。
 */
export function boxedStringEnumEntries(a0: Abs | undefined): Array<[string, Abs]> | undefined {
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
// Bug 38：TypedArray 全家——实例零可枚举自有键（length 槽虽入 brand
//（makeTypedArrayAbs 数字形态）但标 enumerable:false；keys/values/entries
// /assign 枚举视图折 []，与 for-in 的 propFlags 过滤同口径）
for (const fam of Object.keys(TYPED_ARRAY_ELEMENT)) {
  BUILTIN_BRAND_NO_ENUM_KEYS.add(fam);
}

export function builtinBrandNoEnumKeys(a0: Abs | undefined): boolean {
  if (!a0 || a0.shape.k !== "brand") return false;
  const name = (a0.shape as { name?: string }).name ?? "";
  return BUILTIN_BRAND_NO_ENUM_KEYS.has(name);
}

/**
 * Bug 5/26：Object.groupBy / Map.groupBy（ES2024 array-grouping）共用的
 * 校验 + 分组折叠。node v26 实测校验序：items nullish（V8 的
 * RequireObjectCoercible 先于 IsCallable——groupBy(null,null) 报 nullish、
 * groupBy(1,null) 报 not-a-function）→ 回调 IsCallable（回调必填，undefined
 * 不豁免）→ items 可迭代性（非字符串 prim 定抛 not iterable——number/bool/
 * bigint/symbol 均无 @@iterator；字符串按 code point 可迭代）。
 * - mode "property"（Object.groupBy）：键经 ToPropertyKey 折字符串槽键
 *   （string/number/boolean/bigint/null/undefined 字面量 → String(v)；
 *   symbol 键引擎字符串槽不装 → 键集开放）；
 * - mode "map"（Map.groupBy）：原始键 SameValueZero 字面量合并（1 与 "1"
 *   异键——type 前缀区分；-0/+0、NaN 同串合并；symbol 键不装 → 开放）。
 * 不可判（any/unknown/sum items、obj/fn/未知 brand items、不可执行回调、
 * 非字面量键）→ status "unknown" / open（调用方折保守值），may-throw 在
 * 此记录；unkeyed = 键不可判组的元素域（Map shadow 值用）。
 */
export type GroupByFold =
  | { status: "unknown" }
  | {
      status: "ok";
      groups: Array<{ key: Abs; slotKey: string; values: Abs[] }>;
      open: boolean;
      unkeyed: Abs[];
    };

function groupByElements(items: Abs): { els: Abs[]; open: boolean } | undefined {
  const k = items.shape.k;
  if (k === "tuple") {
    const holes = (items.shape as { holes?: number[] }).holes ?? [];
    // hole 位按迭代器 Get 语义产出 undefined（实槽）
    return {
      els: items.shape.elements.map((e, i) => (holes.includes(i) ? undefAbs() : e)),
      open: false,
    };
  }
  if (k === "arr") {
    // 抽象数组：索引未知 → 单代表元素，键集不完备
    return { els: [items.shape.element], open: true };
  }
  if (k === "prim") {
    // type === "string"（调用方已排除其余 prim）
    const svR = litValue(items);
    if (svR.ok && typeof svR.value === "string") {
      return { els: [...svR.value].map((c) => strLit(c)), open: false }; // code point
    }
    return { els: [str()], open: true };
  }
  if (k === "brand") {
    const name = (items.shape as { name?: string }).name;
    if (name === "Map") return { els: mapEntriesAbs(items), open: false };
    if (name === "Set") return { els: setElementsAbs(items), open: false };
    return undefined; // RegExp/Promise/…：可能自定义 @@iterator → 不可判
  }
  // obj/fn/eff/any/unknown/sum：迭代性不可判
  return undefined;
}

export function foldGroupBy(
  items: Abs | undefined,
  cb: Abs | undefined,
  tag: string,
  mode: "property" | "map",
): GroupByFold {
  // ① items RequireObjectCoercible：缺省/nullish 字面量 → 定抛
  if (!items || isNullishLitAbs(items)) throw new NudoThrow(errorTypeAbs("TypeError"));
  // ② 回调 IsCallable：字面量非函数/prim/tuple/arr/闭 obj → 定抛；
  //   any/unknown/开 obj/sum → may（validateCallableArg 记录）
  validateCallableArg(cb, `${tag} callback may not be callable`);
  // ③ items 可迭代性：any/unknown/含 nullish 臂 sum → may ToObject
  const k = items.shape.k;
  if (
    k === "any" ||
    k === "unknown" ||
    (k === "sum" && (items.shape as { members: Abs[] }).members.some(isNullishLitAbs))
  ) {
    recordMayThrow({ kind: "TypeError", cause: `${tag} items may be null or undefined` });
  }
  if (k === "prim" && (items.shape as { type?: string }).type !== "string") {
    // number/boolean/bigint/symbol（字面量与抽象 prim 同）不可迭代
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const els = groupByElements(items);
  if (!els) {
    recordMayThrow({ kind: "TypeError", cause: `${tag} items may not be iterable` });
    return { status: "unknown" };
  }
  // ④ 逐元素执行回调求键（(value, k) 双参——node v26 实测回调收 2 实参）；
  //   回调不可执行 / 键非可装字面量 → 键集开放（unkeyed 收元素域）
  const groups: Array<{ key: Abs; slotKey: string; values: Abs[] }> = [];
  const indexOf = new Map<string, number>();
  const unkeyed: Abs[] = [];
  let open = els.open;
  for (let i = 0; i < els.els.length; i++) {
    const el = els.els[i]!;
    const keyAbs = applyCallbackValue(cb!, [el, numLit(i)], emptyEnv(), pTrue, defaultLeakBudget);
    const t = keyAbs?.term;
    let slotKey: string | undefined;
    if (t?.op === "lit" && typeof t.value !== "symbol") {
      slotKey =
        mode === "property"
          ? String(t.value) // ToPropertyKey：null/undefined/number/bool/bigint → 字符串
          : `${typeof t.value}:${String(t.value)}`; // Map SameValueZero 字面量合并
    }
    if (slotKey === undefined) {
      open = true;
      unkeyed.push(el);
      continue;
    }
    const idx = indexOf.get(slotKey);
    if (idx === undefined) {
      indexOf.set(slotKey, groups.length);
      groups.push({ key: keyAbs, slotKey, values: [el] });
    } else {
      groups[idx]!.values.push(el);
    }
  }
  return { status: "ok", groups, open, unkeyed };
}
