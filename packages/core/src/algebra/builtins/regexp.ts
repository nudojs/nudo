/**
 * RegExp 构造 / brand / 实例方法
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { objOf } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { boolPrim, str } from "./shared.ts";

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
