/**
 * Abs 方法表：模板字符串 / 结构值上的方法与属性。
 * 类型即计算——方法结果仍是 Abs，可继续参与约束推理。
 * 宿主 TypeValue 的 dispatchMethod 只服务 IR 兜底，不是真理源。
 * 模板语义（前缀/后缀/固定文本/长度/谓词判定）统一在 template.ts。
 */

import type { Abs } from "./abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "./abs.ts";
import { applyCallbackAbs, undefAbs } from "./hof.ts";
import { NudoThrow } from "./exec/nudo-throw.ts";
import { errorTypeAbs } from "./exec/may-throw.ts";
import { pTrue } from "./pred.ts";
import { defaultLeakBudget } from "./leak.ts";
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

  const a0 = args[0] ? litValue(args[0]) : undefined;
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
        return strPrim("path");
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
      const a1 = a1Abs ? litValue(a1Abs) : undefined;
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
      return lit !== undefined ? strLit(
        name === "toUpperCase" ? lit.toUpperCase() : name === "toLowerCase" ? lit.toLowerCase() : lit.trim(),
      ) : strPrim("path");
    case "slice":
    case "substring":
      if (lit !== undefined) {
        // 位置参数走 ToIntegerOrInfinity：number/string/bool/null/缺省/undefined 可折叠；
        // Symbol/抽象实参原生 THROW（Cannot convert a symbol to a number）→ 保守
        if (!isFoldableIndexArg(args[0]) || !isFoldableIndexArg(args[1])) return strPrim("path");
        const a1 = args[1] ? litValue(args[1]) : undefined;
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
      const from = args[1] ? litValue(args[1]) : undefined;
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
        const lim = limAbs ? litValue(limAbs) : undefined;
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
            const src = slots ? litValue(slots["source"]?.value) : undefined;
            const flags = slots ? litValue(slots["flags"]?.value) : undefined;
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
      const a0 = a0Abs === undefined ? undefined : litValue(a0Abs);
      const a1 = a1Abs === undefined ? " " : litValue(a1Abs);
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
