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
  allFixedTextOfViews,
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
 * replace 回调桥接的最小环境：宿主 applyCallbackHost 由 ast-eval 模块
 * 注册（B-path 经 ast-eval 的 emptyEnv import 已触发加载）；fn Abs 的
 * impl.env（闭包）优先，此 env 仅作 hofCollect 等字段兜底。
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
 * 调用 Abs 方法。返回 undefined = 未接管（调用方走其它路径）。
 */
export function callAbsMethod(
  recv: Abs,
  name: string,
  args: Abs[],
): Abs | undefined {
  if (!isStrRecv(recv)) return undefined;

  const a0 = args[0] ? litValue(args[0]) : undefined;
  const lit = recv.term?.op === "lit" && typeof recv.term.value === "string"
    ? (recv.term.value as string)
    : undefined;

  if (isTemplateLike(recv)) {
    const views = absTemplateViews(templatePartsOf(recv));
    const prefix = knownPrefixOfViews(views);
    const suffix = knownSuffixOfViews(views);
    switch (name) {
      case "startsWith": {
        if (args[1] && litValue(args[1]) !== undefined) return boolPrim();
        if (typeof a0 !== "string") return boolPrim();
        const d = decideStartsWith(prefix, a0);
        return d === "unknown" ? boolPrim() : boolLit(d);
      }
      case "endsWith": {
        if (args[1] && litValue(args[1]) !== undefined) return boolPrim();
        if (typeof a0 !== "string") return boolPrim();
        const d = decideEndsWith(suffix, a0);
        return d === "unknown" ? boolPrim() : boolLit(d);
      }
      case "includes": {
        if (args[1] && litValue(args[1]) !== undefined) return boolPrim();
        if (typeof a0 !== "string") return boolPrim();
        const d = decideIncludes(allFixedTextOfViews(views), a0);
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
      const a1Abs = args[1];
      const a1 = a1Abs ? litValue(a1Abs) : undefined;
      const a1Unknown = a1Abs !== undefined && a1Abs.term?.op !== "lit";
      if (a1Unknown) return boolPrim();
      if (lit !== undefined && typeof a0 === "string") {
        if (name === "startsWith") return boolLit(lit.startsWith(a0, a1 as number | undefined));
        if (name === "endsWith") return boolLit(lit.endsWith(a0, a1 as number | undefined));
        return boolLit(lit.includes(a0, a1 as number | undefined));
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
        // 位置参数：number 字面量或缺省（显式 undefined 字面量 ≡ 缺省）才折叠；
        // Symbol/抽象实参原生 THROW（Cannot convert a symbol to a number）→ 保守
        const numOrMissing = (x: Abs | undefined): boolean =>
          x === undefined ||
          (x.term?.op === "lit" && (x.term.value === undefined || typeof x.term.value === "number"));
        if (!numOrMissing(args[0]) || !numOrMissing(args[1])) return strPrim("path");
        const a1 = args[1] ? litValue(args[1]) : undefined;
        if (name === "slice") {
          return strLit(lit.slice(a0 as number | undefined, a1 as number | undefined));
        }
        return strLit(lit.substring(Number(a0 ?? 0), Number(a1 ?? lit.length)));
      }
      return strPrim("path");
    case "charAt":
      return lit !== undefined && typeof a0 === "number" ? strLit(lit.charAt(a0)) : strPrim("path");
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
    case "lastIndexOf":
    case "charCodeAt":
      return numPrim("path");
    case "split": {
      if (lit !== undefined) {
        const sep = typeof a0 === "string" ? a0 : undefined;
        // limit：number 字面量或缺省按原生截断；非字面量 → 元素数未知，保守 arr<string>
        const a1Abs = args[1];
        const a1 = a1Abs ? litValue(a1Abs) : undefined;
        if (a1Abs !== undefined && a1Abs.term?.op !== "lit") return strArr("path");
        if (sep !== undefined) {
          const parts = lit.split(sep, a1 as number | undefined).map((s) => strLit(s));
          return abs({ k: "tuple", elements: parts }, undefined, undefined, "exact");
        }
        // 非字面分隔符：结果元素数未知（""→逐字符、命中→多段、未命中→1 段），
        // 不能钉成 1 元 tuple（soundness）；保守 arr<string>
        return strArr("path");
      }
      return strArr("path");
    }
    case "replace":
    case "replaceAll": {
      if (lit !== undefined) {
        const patAbs = args[0];
        const repAbs = args[1];
        if (patAbs && repAbs) {
          // pattern：字符串字面量 / RegExp brand（source/flags 槽）
          let patSrc: string | undefined;
          let patRe: RegExp | undefined;
          const pv = patAbs.term?.op === "lit" ? patAbs.term.value : undefined;
          if (typeof pv === "string") {
            patSrc = pv;
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
          // repl 字符串字面量：$ 模式展开真执行
          const rv = repAbs.term?.op === "lit" ? repAbs.term.value : undefined;
          if (typeof rv === "string") {
            return strLit(name === "replaceAll" ? lit.replaceAll(pat as never, rv) : lit.replace(pat as never, rv));
          }
          // repl fn Abs：原生回调语义——逐命中桥接 Abs 回调（副作用真实执行）
          // 参数布局：string 模式 (match, offset, string)；
          // regex (match, ...pN, offset, string)；命名组时末尾多一个 groups 对象。
          if (repAbs.shape.k === "fn") {
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
              const lv = litValue(r);
              if (lv === undefined) {
                anyUnknown = true;
                return "";
              }
              return String(lv); // ToString：99→"99"、null→"null"
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
