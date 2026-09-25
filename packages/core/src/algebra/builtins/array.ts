/**
 * Array 构造 / Array.* 静态方法
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import { isMapAbs, isSetAbs, setElementsAbs, mapEntriesAbs } from "../collections.ts";
import { applyCallbackValue, undefAbs, asAbs } from "../hof.ts";
import { matchIterElements } from "../exec/match-iter.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { defaultLeakBudget } from "../leak.ts";
import { emptyEnv } from "../ast-env.ts";
import { absFunction } from "../abs-fn.ts";
import { numPrim, boolPrim, peelBrand, noBody, str } from "./shared.ts";
import { isSymbolAbs } from "./symbol.ts";

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
      // Array.prototype 本身是数组 exotic（原生 Array.isArray(Array.prototype) === true）
      if (a0.shape.k === "brand" && a0.shape.name === "Array.prototype") return boolLit(true);
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

/**
 * Array.prototype.toString = join(",")：全字面量元素折叠；含 symbol 元素 TypeError。
 * 与 exec/class.ts $invoke 的 toString 分支同口径（.call 路径共用）。
 */
export function arrayJoinToString(recv: Abs): Abs {
  const s = recv.shape;
  if (s.k === "tuple") {
    const holes = s.holes ?? [];
    const parts: string[] = [];
    for (let i = 0; i < s.elements.length; i++) {
      if (holes.includes(i)) {
        parts.push("");
        continue;
      }
      const el = s.elements[i]!;
      if (isSymbolAbs(el)) throw new NudoThrow(errorTypeAbs("TypeError"));
      const t = el.term;
      if (t?.op !== "lit") return str();
      const v = t.value;
      if (v === null || v === undefined) parts.push("");
      else if (typeof v === "object") return str();
      else parts.push(String(v));
    }
    return strLit(parts.join(","));
  }
  return str();
}

/** Array.prototype.toString / toLocaleString / join 一等函数（bindThis 注入 receiver） */
export function arrayMethodAbs(name: "toString" | "toLocaleString" | "join"): Abs {
  return absFunction(["thisArg"], {
    body: noBody,
    bindThis: true,
    apply: (a) => {
      const recv = a[0] ?? undefAbs();
      // join 带可选分隔符：不假精确折叠，保持 path string（与 $invoke 同口径）
      if (name === "join") return str();
      return arrayJoinToString(recv);
    },
  });
}
