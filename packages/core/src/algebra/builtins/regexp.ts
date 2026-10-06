/**
 * RegExp 构造 / brand / 实例方法
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { objOf } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { boolPrim, str, mayCoerceThrowOperand } from "./shared.ts";
import { isSymbolAbs } from "../symbol-id.ts";

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

/** RegExp brand：source/flags/lastIndex 进 slots（evaluator evalRegExpCtor / $regex 共用） */
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
 * - symbol pattern/flags → 确定 TypeError（ToString 抛；shape 判定——Symbol()
 *   无 lit 项，原先的 lit 分支内检查是死代码，Bug 29/52）
 * - 非法 pattern / 非法 flags（含 number/null/boolean flags 的 ToString）
 *   → SyntaxError；合法 → 精确 brand（source/flags 取真构造结果）
 * - 抽象 pattern/flags → undefined（调用方保守）+ 档位打点（见各分支）：
 *   obj/fn/brand/sum/any → may TypeError（自定义 coercer 可能产 Symbol）；
 *   抽象 prim string pattern → ToString total（非法 pattern 的 SyntaxError
 *   面不计）；抽象 prim string flags → may SyntaxError；抽象 prim
 *   number/bool/bigint flags → ToString 恒非法 flags → 确定 SyntaxError
 *   （node 实测 new RegExp('a', 1n) → SyntaxError）
 */
export function tryMakeRegexAbs(args: Abs[]): Abs | undefined {
  const a0 = args[0];
  if (!a0) return regexBrandAbsFrom("(?:)", "");
  // Bug 29：pattern symbol → 确定 TypeError（原生先 ToString pattern）
  if (isSymbolAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const fAbs = args[1];
  // Bug 52：flags symbol → 确定 TypeError
  if (fAbs && isSymbolAbs(fAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
  // 字面量 flags 先真构造校验（非法 flags 与 pattern 无关恒抛——抽象 pattern
  // 也不得吞掉：new RegExp(x, "x") 原生确定 SyntaxError）
  let litFlags: string | undefined;
  let flagsAbstract = false;
  if (fAbs) {
    if (fAbs.term?.op !== "lit") {
      flagsAbstract = true;
    } else {
      const fvR = litValue(fAbs);
      const fv = fvR?.ok ? fvR.value : undefined;
      litFlags = fv === undefined ? "" : String(fv);
      try {
        new RegExp("", litFlags);
      } catch {
        throw new NudoThrow(errorTypeAbs("SyntaxError"));
      }
    }
  }
  if (a0.term?.op !== "lit") {
    // 抽象 pattern：RegExp brand 豁免（原生 species 构造不走 ToString）；
    // obj/fn/brand/sum/any → may TypeError；抽象 prim ToString total
    if (!isRegExpBrandAbs(a0)) {
      if (mayCoerceThrowOperand(a0) || a0.shape.k === "tuple" || a0.shape.k === "arr") {
        recordMayThrow({ kind: "TypeError", cause: "RegExp pattern ToString may throw (Symbol)" });
      }
    }
    if (flagsAbstract) noteAbstractFlags(fAbs);
    return undefined;
  }
  if (flagsAbstract) {
    noteAbstractFlags(fAbs);
    return undefined;
  }
  const pv = a0.term.value;
  try {
    const r = new RegExp(String(pv), litFlags ?? "");
    return regexBrandAbsFrom(r.source, r.flags);
  } catch (e) {
    if (e instanceof SyntaxError) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/** RegExp brand 判定（species 构造路径不走 ToString） */
function isRegExpBrandAbs(x: Abs): boolean {
  return x.shape.k === "brand" && (x.shape as { name?: string }).name === "RegExp";
}

/** 抽象 flags 档位打点（Bug 52） */
function noteAbstractFlags(fAbs: Abs | undefined): void {
  if (!fAbs) return;
  const k = fAbs.shape as { k?: string; type?: string };
  if (k.k === "prim") {
    if (k.type === "string") {
      recordMayThrow({ kind: "SyntaxError", cause: "RegExp flags may be invalid" });
    } else {
      // 抽象 number/bool/bigint：ToString 恒非法 flags → 确定 SyntaxError
      throw new NudoThrow(errorTypeAbs("SyntaxError"));
    }
    return;
  }
  if (mayCoerceThrowOperand(fAbs) || k.k === "tuple" || k.k === "arr") {
    recordMayThrow({ kind: "TypeError", cause: "RegExp flags ToString may throw (Symbol)" });
  }
}

/**
 * Bug 57：test/exec 的 subject ToString 校验（evalRegExpMethod 与 evaluator
 * execRegexBrand/$reStateCall 三面共用）：
 * - symbol-prim（无 lit 项）→ 确定 TypeError（node 实测 /a/.test(Symbol()) 抛）
 * - 字面量 / 抽象 prim（string/number/bool/bigint——1n ToString 合法）→ total
 * - obj/fn/brand/sum/any/unknown/tuple/arr（term 非 lit）→ may：自定义 coercer
 *   可能产 Symbol；数组 join 元素可能为 symbol（node 实测 /a/.test([Symbol()]) 抛）
 */
export function validateRegexSubjectArg(subject: Abs | undefined): void {
  if (!subject) return;
  if (isSymbolAbs(subject)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (subject.term?.op === "lit") return;
  if (subject.shape.k === "prim") return;
  recordMayThrow({ kind: "TypeError", cause: "RegExp test/exec subject ToString may throw (Symbol)" });
}

/** RegExpExecArray → Abs（Bug 11）：capture 下标槽（"0"/"1"…）+
 *  length/index/input/groups 附加属性，合并为带附加属性的对象 Abs。
 *  `m[0]`/`m[1]` 经 $idx 字面量下标读槽、`m.index`/`m.input`/`m.groups.g`
 *  经 $get 字符串键读槽；具名组 → groups 对象、无具名组 → undefined。 */
export function matchResultAbs(m: RegExpExecArray): Abs {
  const slots: Record<string, { value: Abs }> = {
    length: { value: numLit(m.length) },
    index: { value: numLit(m.index) },
    input: { value: strLit(m.input) },
  };
  for (let i = 0; i < m.length; i++) {
    const g = m[i];
    slots[String(i)] = { value: g === undefined ? undefAbs() : strLit(g) };
  }
  const named = m.groups;
  slots["groups"] = {
    value: named
      ? objOf(
          Object.fromEntries(
            Object.entries(named).map(([k, v]) => [
              k,
              { value: v === undefined ? undefAbs() : strLit(v) },
            ]),
          ),
        )
      : undefAbs(),
  };
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

export function evalRegExpMethod(name: string, recv: Abs, args: Abs[]): Abs | undefined {
  if (name === "test" || name === "exec") {
    // Bug 57：subject ToString 校验（shape 先于 litValue 提取）
    validateRegexSubjectArg(args[0]);
    // 字面量 brand（source/flags 槽）+ 字面量 subject → 真执行（与 evaluator 同轨）
    const inner =
      recv.shape.k === "brand" && recv.shape.name === "RegExp"
        ? recv.shape.shape
        : undefined;
    const slots = inner && inner.shape.k === "obj" ? inner.shape.slots : undefined;
    const patR = slots ? litValue(slots["source"]?.value) : undefined;
    const pat = patR?.ok ? patR.value : undefined;
    const flagsVR = slots ? litValue(slots["flags"]?.value) : undefined;
    const flagsV = flagsVR?.ok ? flagsVR.value : undefined;
    const subjectR = args[0] ? litValue(args[0]) : undefined;
    const subject = subjectR?.ok ? subjectR.value : undefined;
    if (typeof pat === "string" && typeof subject === "string") {
      try {
        const re = new RegExp(pat, typeof flagsV === "string" ? flagsV : "");
        if (name === "test") return boolLit(re.test(subject));
        const m = re.exec(subject);
        if (!m) return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
        return matchResultAbs(m);
      } catch {
        return undefined;
      }
    }
    return name === "test" ? boolPrim() : unknown;
  }
  return undefined;
}
