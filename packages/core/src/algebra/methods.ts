/**
 * Abs 方法表：模板字符串 / 结构值上的方法与属性。
 * 类型即计算——方法结果仍是 Abs，可继续参与约束推理。
 * 宿主 TypeValue 的 dispatchMethod 只服务 IR 兜底，不是真理源。
 * 模板语义（前缀/后缀/固定文本/长度/谓词判定）统一在 template.ts。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "./abs.ts";
import { applyCallbackAbs, undefAbs, validateIndexArg } from "./hof.ts";
import { joinAbs } from "./objects.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";
import { pTrue } from "./pred.ts";
import { defaultLeakBudget } from "./leak.ts";
import { isSymbolAbs } from "./symbol-id.ts";
import {
  isTemplateLike,
  templatePartsOf,
  concatString,
  absTemplateViews,
  knownPrefixOfViews,
  knownSuffixOfViews,
  fixedRunsOfViews,
  fixedLengthOfViews,
  decideStartsWith,
  decideEndsWith,
  decideIncludes,
} from "./template.ts";

function strPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, undefined, undefined, conf);
}

function boolPrim(): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

function numPrim(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "number" }, undefined, undefined, conf);
}

function strArr(conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "arr", element: strPrim("path") }, undefined, undefined, conf);
}

/**
 * replace 回调桥接的最小环境：宿主 applyCallbackHost 由 exec/call.ts
 * 注册（evaluator `$call` 宿主）；fn Abs 的 impl.env（闭包）优先，此 env
 * 仅作 hofCollect 等字段兜底。
 */
function callbackEnv(): unknown {
  return { vars: new Map(), fns: new Map(), hofCollect: undefined };
}

function isStrRecv(recv: Abs): boolean {
  return (
    isTemplateLike(recv) ||
    (recv.shape.k === "prim" && recv.shape.type === "string") ||
    (recv.term?.op === "lit" && typeof recv.term.value === "string")
  );
}

/**
 * ToIntegerOrInfinity / ToNumber 可折叠的字面量位置实参：
 * 缺省、显式 undefined、number/string/bool/null 字面量。
 * 符号实参原生 THROW；抽象实参不折叠。
 */
function isFoldableIndexArg(x: Abs | undefined): boolean {
  if (x === undefined) return true;
  if (x.term?.op !== "lit") return false;
  const v = x.term.value;
  return (
    v === undefined ||
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    v === null
  );
}

/**
 * ES ToIntegerOrInfinity：ToNumber 后 NaN→0、±∞ 保留、其余 truncate 向零。
 * 缺省实参 ≡ undefined → 0。可折叠返回整数/±Infinity；
 * 抽象实参 / bigint / symbol（ToNumber 抛）返回 undefined 不折叠。
 */
export function toIntegerOrInfinityLit(x: Abs | undefined): number | undefined {
  if (x === undefined) return 0;
  if (x.term?.op !== "lit") return undefined;
  const v = x.term.value;
  if (typeof v === "symbol" || typeof v === "bigint") return undefined;
  if (v === undefined) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return Infinity;
  if (n === -Infinity) return -Infinity;
  return Math.trunc(n);
}

/**
 * 实参 ToString 投影（搜索串 / 替换模式）：缺省 ≡ lit(undefined)
 * → String(undefined)。抽象 / symbol 原生 THROW 时不折叠。
 * 注意：String.prototype.split 对 undefined 分隔符有特判（不 ToString）——见 isUndefinedArg。
 */
function toStringArg(x: Abs | undefined): string | undefined {
  if (x === undefined) return "undefined";
  if (x.term?.op !== "lit") return undefined;
  const v = x.term.value;
  if (typeof v === "symbol") return undefined;
  return String(v);
}

/** 缺省实参或显式 lit(undefined)：ES 里都绑定为 undefined */
function isUndefinedArg(x: Abs | undefined): boolean {
  return x === undefined || (x.term?.op === "lit" && x.term.value === undefined);
}

/**
 * ToString 强转实参的 throw 档位（Bug 42/72 共享，shape 先于 lit）：
 * - symbol-prim（Symbol() 产物，无 lit 项）→ 确定 TypeError（ToString 恒抛）
 * - 字面量 / 抽象 prim（string/number/bool/bigint）→ ToString 恒 total
 * - obj/fn/brand/sum/any/unknown/tuple/arr（term 非 lit）→ may：自定义
 *   toString/valueOf 可能产 Symbol；数组 join 元素可能为 symbol（node 实测
 *   'a'.concat([Symbol()]) 抛 TypeError）
 */
export function toStringArgTier(x: Abs | undefined): "ok" | "throw" | "may" {
  if (x === undefined) return "ok";
  if (isSymbolAbs(x)) return "throw";
  if (x.term?.op === "lit") return "ok";
  return x.shape.k === "prim" ? "ok" : "may";
}

/** ToString 档位落地：throw → NudoThrow（catch 层吸收）；may → recordMayThrow */
export function enforceToStringArg(x: Abs | undefined, what: string): void {
  const tier = toStringArgTier(x);
  if (tier === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (tier === "may") {
    recordMayThrow({ kind: "TypeError", cause: `${what} ToString may throw (Symbol)` });
  }
}

/** RegExp brand 判定（Bug 69 IsRegExp 守卫 / replace pattern 合法臂共用） */
function isRegExpBrandAbs(x: Abs | undefined): boolean {
  return !!x && x.shape.k === "brand" && (x.shape as { name?: string }).name === "RegExp";
}

/**
 * String.prototype.split 的 limit → ToUint32。
 * NaN/±Infinity/±0 → 0；其余 truncate 向零后 mod 2^32。
 * bigint/symbol（ToNumber 抛 TypeError）→ 返回 undefined 由调用方保守。
 */
function toUint32Limit(v: number | string | boolean | null | bigint): number | undefined {
  if (typeof v === "bigint" || typeof v === "symbol") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return 0;
  const int = Math.trunc(n);
  const mod = int % 4294967296;
  return mod < 0 ? mod + 4294967296 : mod;
}

/**
 * 调用 Abs 方法。返回 undefined = 未接管（调用方走其它路径）。
 */
export function callAbsMethod(
  recv: Abs,
  name: string,
  args: Abs[],
): Abs | undefined {
  if (!isStrRecv(recv)) return undefined;

  // 实参强转校验（Bug 42/69/72/75）：shape 先于 lit——确定抛 → NudoThrow，
  // 抽象 may → recordMayThrow；值域折叠逻辑不变（各 case 的保守臂照旧）。
  // 原生口径（node v26 实测）：searchString/separator/pattern/replacement/
  // concat 实参/fill/form 走 ToString；position/fromIndex/limit/targetLength/
  // count 走 ToIntegerOrInfinity；startsWith/endsWith/includes 先 IsRegExp。
  switch (name) {
    case "startsWith":
    case "endsWith":
    case "includes": {
      // Bug 69：IsRegExp 守卫先于 ToString——RegExp brand 实参 → 确定
      // TypeError（node: "First argument to String.prototype.startsWith
      // must not be a regular expression"，endsWith/includes 同款）
      if (isRegExpBrandAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      enforceToStringArg(args[0], "searchString");
      validateIndexArg(args[1], "position");
      break;
    }
    case "indexOf":
    case "lastIndexOf":
      enforceToStringArg(args[0], "searchString");
      validateIndexArg(args[1], "fromIndex");
      break;
    case "concat":
      for (let i = 0; i < args.length; i++) enforceToStringArg(args[i], "concat operand");
      break;
    case "split":
      // limit 走 ToUint32（ToNumber）——symbol/bigint 确定 TypeError（node 实测
      // 'a'.split('a', 1n) 抛）；separator 的 undefined 特判在折叠面（不 ToString）
      validateIndexArg(args[1], "limit");
      if (!isUndefinedArg(args[0])) enforceToStringArg(args[0], "separator");
      break;
    case "replace":
    case "replaceAll": {
      // pattern：RegExp brand 合法（折叠面分支）；fn replacement 不 ToString
      //（回调语义）；其余 ToString 档
      if (!isRegExpBrandAbs(args[0])) enforceToStringArg(args[0], "replace pattern");
      if (!(args[1] && args[1].shape.k === "fn")) {
        enforceToStringArg(args[1], "replace replacement");
      }
      break;
    }
    case "padStart":
    case "padEnd":
      validateIndexArg(args[0], "targetLength");
      enforceToStringArg(args[1], "fill");
      break;
    case "repeat":
      validateIndexArg(args[0], "count");
      break;
    case "slice":
    case "substring":
    case "charAt":
    case "charCodeAt":
    case "codePointAt":
    case "at":
    case "substr":
      validateIndexArg(args[0], "position");
      validateIndexArg(args[1], "end");
      break;
    case "localeCompare":
      enforceToStringArg(args[0], "compareString");
      // 第二参（locales）为 null 字面量 → 确定 TypeError（ToObject；node 实测
      // 'a'.localeCompare('b', null) 抛）；symbol/undefined 原生 total
      if (args[1] && args[1].term?.op === "lit" && args[1].term.value === null) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      break;
    case "normalize": {
      // form 走 ToString + 合法性校验：symbol → TypeError；抽象 prim string →
      // may RangeError（form 可能非法）；抽象 prim number/bool/bigint → ToString
      // 恒非法 form → 确定 RangeError（node 实测 normalize(1n) 抛）；其余抽象 →
      // may TypeError + may RangeError
      const f = args[0];
      if (isSymbolAbs(f)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (f !== undefined && f.term?.op !== "lit") {
        const k = (f.shape as { k?: string; type?: string });
        if (k.k === "prim" && k.type === "string") {
          recordMayThrow({ kind: "RangeError", cause: "normalize form may be invalid" });
        } else if (k.k === "prim") {
          throw new NudoThrow(errorTypeAbs("RangeError"));
        } else {
          recordMayThrow({ kind: "TypeError", cause: "normalize form ToString may throw (Symbol)" });
          recordMayThrow({ kind: "RangeError", cause: "normalize form may be invalid" });
        }
      }
      break;
    }
  }

  const a0R = args[0] ? litValue(args[0]) : undefined;

  const a0 = a0R?.ok ? a0R.value : undefined;
  const a0Str = toStringArg(args[0]);
  const lit = recv.term?.op === "lit" && typeof recv.term.value === "string"
    ? (recv.term.value as string)
    : undefined;

  if (isTemplateLike(recv)) {
    const views = absTemplateViews(templatePartsOf(recv));
    const prefix = knownPrefixOfViews(views);
    const suffix = knownSuffixOfViews(views);
    switch (name) {
      case "startsWith":
      case "endsWith":
      case "includes": {
        // 位置/长度参：缺省或 lit(undefined) 按默认（0 / 全长）；
        // 真实字面量或**抽象实参**都不得假装缺省（litValue 哨兵会把抽象
        // 参折成 undefined）——抽象位置可能改变判定，保守 boolPrim。
        const a1Abs = args[1];
        if (a1Abs !== undefined) {
          const omitted = a1Abs.term?.op === "lit" && a1Abs.term.value === undefined;
          if (!omitted) return boolPrim();
        }
        if (a0Str === undefined) return boolPrim();
        const d =
          name === "startsWith"
            ? decideStartsWith(prefix, a0Str)
            : name === "endsWith"
              ? decideEndsWith(suffix, a0Str)
              : decideIncludes(fixedRunsOfViews(views), a0Str);
        return d === "unknown" ? boolPrim() : boolLit(d);
      }
      case "toUpperCase":
      case "toLowerCase":
      case "trim":
      case "slice":
      case "trimStart":
      case "trimEnd":
      case "toLocaleUpperCase":
      case "toLocaleLowerCase":
      case "substr":
      case "normalize":
        return strPrim("path");
      case "localeCompare":
        return numPrim("path");
      case "concat": {
        let acc = recv;
        for (const a of args) acc = concatString(acc, a);
        return acc;
      }
      case "toString":
      case "valueOf":
        return recv;
    }
  }

  // string prim / string 字面量
  switch (name) {
    case "startsWith":
    case "endsWith":
    case "includes": {
      // 可选位置参数（startsWith/includes 的 position、endsWith 的 length）：
      // number 字面量或缺省（undefined）→ 按原生折叠；非字面量 → boolPrim
      // searchString 走 ToString：缺省 ≡ undefined → "undefined"
      const a1Abs = args[1];
      const a1R = a1Abs ? litValue(a1Abs) : undefined;
      const a1 = a1R?.ok ? a1R.value : undefined;
      const a1Unknown = a1Abs !== undefined && a1Abs.term?.op !== "lit";
      if (a1Unknown) return boolPrim();
      if (lit !== undefined && a0Str !== undefined) {
        if (name === "startsWith") return boolLit(lit.startsWith(a0Str, a1 as number | undefined));
        if (name === "endsWith") return boolLit(lit.endsWith(a0Str, a1 as number | undefined));
        return boolLit(lit.includes(a0Str, a1 as number | undefined));
      }
      return boolPrim();
    }
    case "toUpperCase":
    case "toLowerCase":
    case "trim":
    case "trimStart":
    case "trimEnd":
    case "toLocaleUpperCase":
    case "toLocaleLowerCase": {
      // Bug 72：此前未建模 → unknown。实参不参与（locale 实参原生忽略），
      // 字面量经宿主真执行（同 host 行为一致），模板/抽象保守 strPrim。
      if (lit === undefined) return strPrim("path");
      const impl = String.prototype as unknown as Record<string, (...a: unknown[]) => string>;
      return strLit(impl[name]!.call(lit));
    }
    case "substr": {
      // Bug 72：Annex B 但宿主全有。start/length 走 ToIntegerOrInfinity
      //（负 start → len+start；length 0 → ""——node 实测 'abc'.substr(1, null) === ""）
      if (lit === undefined) return strPrim("path");
      if (!isFoldableIndexArg(args[0]) || !isFoldableIndexArg(args[1])) return strPrim("path");
      const a1R = args[1] ? litValue(args[1]) : undefined;
      const a1 = a1R?.ok ? a1R.value : undefined;
      return strLit(lit.substr(Number(a0 ?? 0), a1 === undefined ? undefined : Number(a1)));
    }
    case "normalize": {
      // Bug 72：缺省/undefined → NFC；非法 form 字面量（含 number/bool/bigint/null
      // 的 ToString——node 实测 normalize(1n)/normalize(true) 均抛）→ 确定 RangeError
      if (lit === undefined) return strPrim("path");
      if (args[0] !== undefined && args[0].term?.op !== "lit") return strPrim("path");
      try {
        return strLit(lit.normalize(a0 as string | undefined));
      } catch {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
    }
    case "localeCompare": {
      // Bug 72：比较实参 ToString（symbol → TypeError 已在入口硬抛）；
      // 第二参（locales）原生校验：非法 language tag 字面量 → RangeError
      // （node 实测 'a'.localeCompare('b','b') 抛）、null → TypeError（ToObject，
      // 入口已硬抛）；symbol/undefined/number/bigint → total（node 实测跳过校验）。
      // 字面量经宿主（默认 locale，与 node 同机一致）→ number
      if (lit === undefined) return numPrim("path");
      const that = toStringArg(args[0]);
      if (that === undefined) return numPrim("path");
      const loc = args[1];
      if (loc !== undefined && loc.term?.op === "lit") {
        try {
          return numLit(lit.localeCompare(that, loc.term.value as never));
        } catch (e) {
          if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
      }
      const lk = loc?.shape as { k?: string; type?: string } | undefined;
      if (!loc || isSymbolAbs(loc) || (lk?.k === "prim" && lk.type !== "string")) {
        return numLit(lit.localeCompare(that));
      }
      // 抽象 string / 数组 / 对象 / any locales：可能含非法 tag → may RangeError
      recordMayThrow({ kind: "RangeError", cause: "localeCompare locales may be an invalid language tag" });
      return numPrim("path");
    }
    case "slice":
    case "substring":
      if (lit !== undefined) {
        // 位置参数走 ToIntegerOrInfinity：number/string/bool/null/缺省/undefined 可折叠；
        // Symbol/抽象实参原生 THROW（Cannot convert a symbol to a number）→ 保守
        if (!isFoldableIndexArg(args[0]) || !isFoldableIndexArg(args[1])) return strPrim("path");
        const a1R = args[1] ? litValue(args[1]) : undefined;
        const a1 = a1R?.ok ? a1R.value : undefined;
        if (name === "slice") {
          return strLit(lit.slice(a0 as number | undefined, a1 as number | undefined));
        }
        // substring：start 缺省/undefined/null → ToIntegerOrInfinity → 0；
        // end 仅 undefined/缺省才取 len（null/false/'' → 0，不得 ?? 吞成缺省）
        const start = toIntegerOrInfinityLit(args[0]) ?? 0;
        const end =
          isUndefinedArg(args[1]) ? lit.length : (toIntegerOrInfinityLit(args[1]) ?? 0);
        return strLit(lit.substring(start, end));
      }
      return strPrim("path");
    case "charAt": {
      // 缺省 pos ≡ 0；位置 ToIntegerOrInfinity（'1'/true/null 可折叠）
      if (lit === undefined) return strPrim("path");
      if (!isFoldableIndexArg(args[0])) return strPrim("path");
      return strLit(lit.charAt(Number(a0 ?? 0)));
    }
    case "codePointAt": {
      // Bug 75：此前完全未建模 → unknown。位置走 ToIntegerOrInfinity；
      // OOB → undefined（与 charAt 的 "" 不同）；非折叠位置 → number | undefined
      if (lit === undefined) return joinAbs(numPrim("path"), undefAbs());
      if (!isFoldableIndexArg(args[0])) return joinAbs(numPrim("path"), undefAbs());
      const cp = lit.codePointAt(Number(a0 ?? 0));
      return cp === undefined ? undefAbs() : numLit(cp);
    }
    case "at": {
      // String.prototype.at：ToIntegerOrInfinity，支持负索引；OOB → undefined
      //（charAt 用 "" 表示 OOB，at 是 undefined——不得混用）
      if (lit === undefined) return strPrim("path");
      const iv = toIntegerOrInfinityLit(args[0]);
      if (iv === undefined) return strPrim("path");
      const idx = iv < 0 ? lit.length + iv : iv;
      if (idx >= 0 && idx < lit.length) return strLit(lit[idx]!);
      return undefAbs();
    }
    case "toString":
    case "valueOf":
      return lit !== undefined ? strLit(lit) : strPrim("path");
    case "concat": {
      if (lit !== undefined) {
        let s = lit;
        for (const a of args) {
          // 抽象实参（term 非 lit）→ 拼接结果未知，保守；
          // Symbol 字面量 → 隐式 ToString 原生 THROW，保守
          if (a.term?.op !== "lit" || typeof a.term.value === "symbol") return strPrim("path");
          s += String(a.term.value);
        }
        return strLit(s);
      }
      return strPrim("path");
    }
    case "indexOf":
    case "lastIndexOf": {
      // 字面量 receiver + 可 ToString 的字面量 needle → 按原生折叠
      // fromIndex 同 ToIntegerOrInfinity（含字符串数字 / 缺省）
      // needle 缺省 ≡ undefined → String(undefined)="undefined"
      if (lit === undefined) return numPrim("path");
      const search = toStringArg(args[0]);
      if (search === undefined) return numPrim("path");
      if (!isFoldableIndexArg(args[1])) return numPrim("path");
      const fromR = args[1] ? litValue(args[1]) : undefined;
      const from = fromR?.ok ? fromR.value : undefined;
      return numLit(
        name === "indexOf"
          ? lit.indexOf(search, from as number | undefined)
          : lit.lastIndexOf(search, from as number | undefined),
      );
    }
    case "charCodeAt": {
      if (lit === undefined) return numPrim("path");
      if (!isFoldableIndexArg(args[0])) return numPrim("path");
      return numLit(lit.charCodeAt(Number(a0 ?? 0)));
    }
    case "split": {
      if (lit !== undefined) {
        // limit：number 字面量或缺省按原生截断；非字面量 → 元素数未知，保守 arr<string>
        const limAbs = args[1];
        const limR = limAbs ? litValue(limAbs) : undefined;
        const lim = limR?.ok ? limR.value : undefined;
        if (limAbs !== undefined && limAbs.term?.op !== "lit") return strArr("path");
        // ES 特判：separator 为 undefined（含缺省）→ 不 ToString(separator)，
        // 直接返回 [ToString(O)] 再按 limit 截断。toStringArg 会误折成 "undefined" 分隔。
        if (isUndefinedArg(args[0])) {
          const one = abs({ k: "tuple", elements: [strLit(lit)] }, undefined, undefined, "exact");
          // limit 缺省/显式 undefined → lim = 2^32-1（不是 ToUint32(undefined)=0）
          if (lim === undefined) return one;
          // limit 走 ToUint32：0.5/±Infinity → 0（空数组）；-1 → 2^32-1（保 1 段）
          const n = toUint32Limit(lim);
          if (n === undefined) return strArr("path"); // bigint/symbol limit：ToNumber 抛，保守
          if (n === 0) return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
          return one;
        }
        const sep = toStringArg(args[0]);
        if (sep !== undefined) {
          const parts = lit.split(sep, lim as number | undefined).map((s) => strLit(s));
          return abs({ k: "tuple", elements: parts }, undefined, undefined, "exact");
        }
        // 抽象/symbol 分隔符：结果元素数未知（""→逐字符、命中→多段、未命中→1 段），
        // 不能钉成 1 元 tuple（soundness）；保守 arr<string>
        return strArr("path");
      }
      return strArr("path");
    }
    case "replace":
    case "replaceAll": {
      if (lit !== undefined) {
        // pattern / replacement 缺省 ≡ undefined → ToString；非字面量保守
        const patAbs = args[0];
        const repAbs = args[1];
        {
          // pattern：字符串字面量 / ToString 可折叠字面量 / RegExp brand（source/flags 槽）
          let patSrc: string | undefined;
          let patRe: RegExp | undefined;
          const pv = patAbs?.term?.op === "lit" ? patAbs.term.value : undefined;
          if (patAbs === undefined) {
            patSrc = "undefined";
          } else if (typeof pv === "string") {
            patSrc = pv;
          } else if (patAbs.term?.op === "lit" && typeof pv !== "symbol") {
            patSrc = String(pv);
          } else if (patAbs.shape.k === "brand" && patAbs.shape.name === "RegExp") {
            const inner = patAbs.shape.shape;
            const slots = inner.shape.k === "obj" ? inner.shape.slots : undefined;
            const srcR = slots ? litValue(slots["source"]?.value) : undefined;
            const src = srcR?.ok ? srcR.value : undefined;
            const flagsR = slots ? litValue(slots["flags"]?.value) : undefined;
            const flags = flagsR?.ok ? flagsR.value : undefined;
            if (typeof src === "string" && (flags === undefined || typeof flags === "string")) {
              try {
                patRe = new RegExp(src, flags ?? "");
              } catch {
                return strPrim("path");
              }
            }
          }
          if (patSrc === undefined && patRe === undefined) return strPrim("path");
          // replaceAll + 非全局正则 → 原生 TypeError（hard throw，catch 可吸收）
          if (name === "replaceAll" && patRe && !patRe.global) {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          const pat = (patSrc ?? patRe)!;
          // repl 字符串字面量：$ 模式展开真执行；缺省/undefined → "undefined"
          const rvLit = repAbs?.term?.op === "lit" ? repAbs.term.value : undefined;
          const rv = repAbs === undefined
            ? "undefined"
            : typeof rvLit === "string"
              ? rvLit
              : repAbs.term?.op === "lit" && typeof rvLit !== "symbol"
                ? String(rvLit)
                : undefined;
          if (rv !== undefined) {
            return strLit(name === "replaceAll" ? lit.replaceAll(pat as never, rv) : lit.replace(pat as never, rv));
          }
          // repl fn Abs：原生回调语义——逐命中桥接 Abs 回调（副作用真实执行）
          // 参数布局：string 模式 (match, offset, string)；
          // regex (match, ...pN, offset, string)；命名组时末尾多一个 groups 对象。
          if (repAbs && repAbs.shape.k === "fn") {
            let anyUnknown = false;
            const replWrapper = (...caps: unknown[]): string => {
              const last = caps[caps.length - 1];
              const hasNamedGroups =
                caps.length >= 4 &&
                typeof last === "object" &&
                last !== null &&
                typeof caps[caps.length - 3] === "number" &&
                typeof caps[caps.length - 2] === "string";
              const groups: unknown[] = hasNamedGroups
                ? caps.slice(1, caps.length - 3)
                : caps.slice(1, -2);
              const offset = hasNamedGroups
                ? caps[caps.length - 3]
                : caps[caps.length - 2];
              const whole = hasNamedGroups
                ? caps[caps.length - 2]
                : caps[caps.length - 1];
              const callArgs: Abs[] = [
                strLit(String(caps[0])),
                ...groups.map((g) => (g === undefined ? undefAbs() : strLit(String(g)))),
                typeof offset === "number" ? numLit(offset) : unknown,
                typeof whole === "string" ? strLit(whole) : unknown,
              ];
              const r = applyCallbackAbs(repAbs, callArgs, callbackEnv(), pTrue, defaultLeakBudget);
              // litValue 哨兵：lit(undefined) 折成 undefined，须看 term
              if (r.term?.op !== "lit") {
                anyUnknown = true;
                return "";
              }
              return String(r.term.value); // ToString：99→"99"、null→"null"、undefined→"undefined"
            };
            try {
              const out =
                name === "replaceAll"
                  ? lit.replaceAll(pat as never, replWrapper as never)
                  : lit.replace(pat as never, replWrapper as never);
              return anyUnknown ? strPrim("path") : strLit(out);
            } catch {
              return strPrim("path");
            }
          }
        }
      }
      return strPrim("path");
    }
    case "padStart":
    case "padEnd":
    case "repeat": {
      if (lit === undefined) return strPrim("path");
      // 任一实参抽象（term 非 lit）→ 保守；缺省 fill=" "
      const a0Abs = args[0];
      const a1Abs = args[1];
      if (a0Abs !== undefined && a0Abs.term?.op !== "lit") return strPrim("path");
      if (a1Abs !== undefined && a1Abs.term?.op !== "lit") return strPrim("path");
      const a0R = a0Abs === undefined ? undefined : litValue(a0Abs);
      const a0 = a0R?.ok ? a0R.value : undefined;
      const a1R = a1Abs === undefined ? undefined : litValue(a1Abs);
      const a1 = a1Abs === undefined ? " " : a1R?.ok ? a1R.value : undefined;
      try {
        const impl = String.prototype as unknown as Record<string, (...a: unknown[]) => string>;
        return strLit(impl[name]!.call(lit, a0, a1));
      } catch (e) {
        // repeat 负/Infinity → RangeError；符号实参（ToIntegerOrInfinity/
        // ToLength 抛）→ TypeError。硬抛，catch 经 $catchVal 吸收
        if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
        return strPrim("path");
      }
    }
  }
  return undefined;
}

/** 属性读取：template/string.length 等 */
export function getAbsProperty(recv: Abs, name: string): Abs | undefined {
  if (name === "length") {
    if (isTemplateLike(recv)) {
      const n = fixedLengthOfViews(absTemplateViews(templatePartsOf(recv)));
      if (n !== undefined) return numLit(n);
      return numPrim("path");
    }
    if (isStrRecv(recv)) {
      const lit = recv.term?.op === "lit" && typeof recv.term.value === "string"
        ? recv.term.value
        : undefined;
      if (lit !== undefined) return numLit(lit.length);
      return numPrim("path");
    }
  }
  return undefined;
}
