/**
 * prim 接收者方法折叠域（自 invoke.ts 拆出——$invokeInner 责任链的 prim 面）：
 * bigint / number / boolean 字面量的原型方法精确折叠 + 抽象臂保守。
 *
 * Invariants:
 * - undefined = 本面未接管 ⇒ 交回 $invokeInner 继续后续面（no-method 诊断
 *   等不在此折）；非 undefined = 该面的最终结果（含 throws）。
 * - 判定顺序 bigint → number → boolean 遵循原实现（invokePrimitive）。
 * - Bug 65/107：digits/radix 字面量实参域检查**表驱动**
 *   （NUM_PROTO_ARG_DOMAIN，两处消费：Number 面的 enforceNumProtoArgDomain
 *   与抽象 bigint toString 的 radix 判界）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, litValue, strLit } from "../../abs.ts";
import { isSymbolAbs } from "../../builtins.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { NudoThrow } from "../runtime.ts";

/**
 * Bug 65/107：Number/BigInt.prototype 字面量实参域表（ToIntegerOrInfinity
 * 截断后判界）。toFixed/toExponential digits [0,100]、toPrecision [1,100]、
 * toString radix [2,36]（BigInt.prototype.toString 同 radix 界）。两处消费：
 * enforceNumProtoArgDomain（Number 面，NaN 先归一 +0 再判）与抽象 bigint
 * toString（NaN/±Infinity 由 isFinite 前置拦截）。toLocaleString 的 ICU
 * 路径不转换实参——不在面内。
 */
const NUM_PROTO_ARG_DOMAIN: Readonly<{ [m: string]: readonly [number, number] }> = {
  toFixed: [0, 100] as const,
  toExponential: [0, 100] as const,
  toPrecision: [1, 100] as const,
  toString: [2, 36] as const,
};

/** Bug 65：ToIntegerOrInfinity 后的域判定（NaN 归一由调用方先行）。
 *  方法不在面内 → false（不拦）。查表用 Object.hasOwn——Bug 90 口径：
 *  字典直取会让 Object.prototype.toLocaleString 等继承名漏进域检查
 *  （非 undefined ⇒ 假进面 ⇒ dom[0] undefined ⇒ NaN 比较 ⇒ 假 RangeError）。 */
function numProtoArgOutOfRange(method: string, n: number): boolean {
  if (!Object.hasOwn(NUM_PROTO_ARG_DOMAIN, method)) return false;
  const dom: readonly [number, number] | undefined = NUM_PROTO_ARG_DOMAIN[method];
  return !(n >= dom![0] && n <= dom![1]);
}

/**
 * Bug 107：Number.prototype digits/radix 字面量实参域检查（接收者无关——
 * 提升于接收者字面量守卫之前）。非字面量实参直接 return——各方法臂既有
 * recordMayThrow 口径不变。toLocaleString/valueOf 不转换实参，不在面内。
 */
function enforceNumProtoArgDomain(method: string, argAbs: Abs | undefined): void {
  // Object.hasOwn（Bug 90 口径）：字典直取会命中 Object.prototype 的
  // toLocaleString 等继承名（非 undefined ⇒ 假进面）。
  if (!Object.hasOwn(NUM_PROTO_ARG_DOMAIN, method)) return;
  if (argAbs === undefined) return;
  if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (argAbs.term?.op !== "lit") return;
  const v = argAbs.term.value;
  if (v === undefined) return; // 显式 undefined ≡ 缺省
  if (typeof v === "bigint") throw new NudoThrow(errorTypeAbs("TypeError")); // ToNumber(1n) 定抛
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" || typeof v === "boolean" || v === null) n = Number(v);
  else return;
  if (Number.isNaN(n)) n = 0; // ToIntegerOrInfinity(NaN) = +0（node 实测 (1.5).toFixed(NaN) === "2"）
  else n = Math.trunc(n); // 截断（100.9 → 100 合法）
  if (numProtoArgOutOfRange(method, n)) throw new NudoThrow(errorTypeAbs("RangeError"));
}

/**
 * bigint 字面量：toString(radix)/valueOf 精确折叠——字面量实参真执行，
 * 非法 radix 原生 RangeError / 符号实参 TypeError 硬抛（catch 可吸收）。
 * undefined = 未接管的其它方法（继续后续诊断路径）。
 */
function invokeBigintPrim(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "prim" || s.type !== "bigint") return undefined;
  const bvR = litValue(thisVal);
  const bv = bvR.ok ? (bvR.value as bigint | undefined) : undefined;
  if (typeof bv === "bigint") {
    if (method === "valueOf") return thisVal;
    // toLocaleString：BigInt 原型真方法（M3 白名单成员）——宿主 ICU 真执行
    //（千分位随 locale 精确；此前落通用路径折 "[object BigInt]" 假精确）；
    // 实参参与（Bug 251）：locales 走宿主 CanonicalizeLocaleList 校验——
    // null → TypeError、非法 language tag → RangeError；number/bool/
    // bigint/symbol 实参原生被忽略（默认 locale）——与 Number 臂同口径
    if (method === "toLocaleString") {
      const argAbs = args[0];
      // symbol 实参宿主忽略（ToObject 路径，不抛）⇒ 不记 may
      if (argAbs !== undefined && argAbs.term?.op !== "lit" && !isSymbolAbs(argAbs)) {
        // Bug 251：locales 不可判 —— 可能是非法 language tag → may RangeError
        recordMayThrow({
          kind: "RangeError",
          cause: "BigInt.prototype.toLocaleString locales may be an invalid language tag",
        });
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
      const avR = argAbs === undefined ? undefined : litValue(argAbs);
      const av = avR?.ok ? avR.value : undefined;
      try {
        const impl = BigInt.prototype as unknown as Record<string, (...a: unknown[]) => string>;
        const hostArgs: unknown[] = argAbs !== undefined ? [av] : [];
        return strLit(Reflect.apply(impl.toLocaleString, bv, hostArgs) as string);
      } catch (e) {
        if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
    }
    if (method === "toString") {
      const argAbs = args[0];
      // Bug 65：radix 经 ToIntegerOrInfinity——symbol 按 shape 判定（无
      // lit 项）确定 TypeError；抽象 → may TypeError；字面量真执行
      // （RangeError catch 保留）
      if (argAbs !== undefined) {
        if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (argAbs.term?.op !== "lit") {
          recordMayThrow({
            kind: "TypeError",
            cause: "BigInt.prototype.toString radix may not be convertible to a number",
          });
          return unknown;
        }
      }
      const avR = argAbs === undefined ? undefined : litValue(argAbs);
      const av = avR?.ok ? avR.value : undefined;
      try {
        return strLit(bv.toString(av as never));
      } catch (e) {
        if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
        return unknown;
      }
    }
  } else if (method === "toLocaleString") {
    // 抽象 bigint：toLocaleString 恒成功（ICU 不转换实参）→ 抽象 string
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  } else if (method === "valueOf") {
    // Bug 105：抽象 bigint prim 的 valueOf = 接收者自身（thisBigIntValue
    // 恒成功）——此前落通用路径被 Object.prototype.toString 吞
    return thisVal;
  } else if (method === "toString") {
    // Bug 105：抽象 bigint prim 的 toString → BigInt.prototype.toString
    //（结果恒 string），不落 Object.prototype.toString（"[object Bigint]"
    // 假精确）。radix 实参口径与字面量接收者臂一致：symbol 定抛
    // TypeError、字面量真查域（域界见 NUM_PROTO_ARG_DOMAIN）、抽象 may
    // TypeError。
    const argAbs = args[0];
    if (argAbs !== undefined) {
      if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
      const avR = litValue(argAbs);
      const av = avR.ok ? avR.value : undefined;
      if (avR.ok && av !== undefined) {
        const radix = Math.trunc(Number(av));
        if (!Number.isFinite(radix) || numProtoArgOutOfRange("toString", radix)) {
          throw new NudoThrow(errorTypeAbs("RangeError"));
        }
      } else if (!avR.ok) {
        recordMayThrow({
          kind: "TypeError",
          cause: "BigInt.prototype.toString radix may not be convertible to a number",
        });
      }
    }
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  // 未接管的其它方法不得在此 return——继续后续诊断路径（M3：原型外
  // 方法名（toFixed 等）在下方定抛 TypeError；toLocaleString 等软保守）
  return undefined;
}

/**
 * number 字面量：toString(radix)/toFixed/toExponential/toPrecision/valueOf
 * 精确折叠——字面量实参真执行（ToIntegerOrInfinity 截断、NaN→缺省等由原生
 * 处理），非法参数硬抛 RangeError、符号实参硬抛 TypeError；抽象实参保守。
 * 未接管的其它方法不得在此 return——继续后续诊断路径（no-method）。
 */
function invokeNumberPrim(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "prim" || s.type !== "number") return undefined;
  if (method === "valueOf") return thisVal;
  // Bug 107：字面量 digits/radix 实参的域检查与接收者是否字面量无关——
  // 提升到接收者 guard 之前（此前 Math.random().toFixed(500) 等抽象
  // number 接收者在下方各方法臂早折抽象 string，漏掉确定的 RangeError
  // → throws 域 never 的假 total）。方法界见 NUM_PROTO_ARG_DOMAIN
  //（ToIntegerOrInfinity 后判；symbol 实参 ToNumber 定抛、bigint 字面量
  // 同）；toLocaleString 的 ICU 路径不转换实参
  //（(1.5).toLocaleString(Symbol()) → "1.5"）——不在提升面。抽象实参
  // return——各方法臂既有 recordMayThrow 口径不变。
  enforceNumProtoArgDomain(method, args[0]);
  if (method === "toString" || method === "toLocaleString") {
    const nvR = litValue(thisVal);
    const nv = nvR.ok ? nvR.value : undefined;
    if (typeof nv !== "number") return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    const argAbs = args[0];
    // Bug 65：radix 经 ToNumber——symbol（shape 判定）确定 TypeError、
    // 抽象 → may TypeError；toLocaleString 例外：原生 ICU 路径不转换实参
    // （(1).toLocaleString(Symbol()) → "1"），恒不抛
    if (method === "toString" && argAbs !== undefined) {
      if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (argAbs.term?.op !== "lit") {
        recordMayThrow({
          kind: "TypeError",
          cause: "Number.prototype.toString radix may not be convertible to a number",
        });
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
    }
    if (argAbs !== undefined && argAbs.term?.op !== "lit" && !isSymbolAbs(argAbs)) {
      // Bug 251：locales 实参不可判 —— 可能是非法 language tag
      // （`(1.5).toLocaleString(tag)` 原生 RangeError）⇒ may RangeError
      // （symbol 实参宿主忽略 ⇒ 不记 may）
      if (method === "toLocaleString") {
        recordMayThrow({
          kind: "RangeError",
          cause: "Number.prototype.toLocaleString locales may be an invalid language tag",
        });
      }
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    const avR = argAbs === undefined ? undefined : litValue(argAbs);
    const av = avR?.ok ? avR.value : undefined;
    try {
      const impl = Number.prototype as unknown as Record<string, (...a: unknown[]) => string>;
      if (method === "toLocaleString") {
        // Bug 251：走**宿主 toLocaleString**（ICU）——此前重定向宿主 toString
        // ⇒ 值错（丢千分位 / -0 / 指数形态：1234567.5 → "1234567.5"，
        // 原生 "1,234,567.5"）。locales 实参透传 ⇒ 宿主
        // CanonicalizeLocaleList 校验（null → TypeError、非法 tag →
        // RangeError；number/bool/bigint/symbol 原生被忽略 ⇒ 默认 locale）。
        const localeArgs: unknown[] = argAbs !== undefined ? [av] : [];
        return strLit(Reflect.apply(impl.toLocaleString!, nv, localeArgs) as string);
      }
      const radixArgs: unknown[] = av === undefined ? [] : [av];
      return strLit(Reflect.apply(impl.toString!, nv, radixArgs) as string);
    } catch (e) {
      if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
  }
  if (
    method === "toFixed" ||
    method === "toExponential" ||
    method === "toPrecision"
  ) {
    const nvR = litValue(thisVal);
    const nv = nvR.ok ? nvR.value : undefined;
    if (typeof nv !== "number") return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    const argAbs = args[0];
    // Bug 65：digits 经 ToIntegerOrInfinity——symbol（shape 判定）确定
    // TypeError；抽象 → may TypeError；字面量真执行（RangeError catch 保留）
    if (argAbs !== undefined) {
      if (isSymbolAbs(argAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (argAbs.term?.op !== "lit") {
        recordMayThrow({
          kind: "TypeError",
          cause: `Number.prototype.${method} digits may not be convertible to a number`,
        });
        return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
      }
    }
    const avR = argAbs === undefined ? undefined : litValue(argAbs);
    const av = avR?.ok ? avR.value : undefined;
    try {
      const impl = Number.prototype as unknown as Record<string, (...a: unknown[]) => string>;
      return strLit(impl[method]!.call(nv, av));
    } catch (e) {
      if (e instanceof TypeError) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
  }
  return undefined;
}

/** boolean 字面量：toString/valueOf；undefined = 未接管 */
function invokeBooleanPrim(
  thisVal: Abs,
  method: string,
  _args: Abs[],
): Abs | undefined {
  const s = thisVal.shape;
  if (s.k !== "prim" || s.type !== "boolean") return undefined;
  if (method === "valueOf") return thisVal;
  if (method === "toString" || method === "toLocaleString") {
    const bvR = litValue(thisVal);
    const bv = bvR.ok ? bvR.value : undefined;
    if (typeof bv === "boolean") return strLit(String(bv));
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  return undefined;
}

/**
 * $invokeInner 责任链的 prim 面入口（bigint → number → boolean，遵循原实现
 * 的判定顺序）。undefined = 本面未接管 ⇒ 继续 Symbol / 字符串表 / 通用槽位 /
 * 诊断面。
 */
export function invokePrimitive(
  thisVal: Abs,
  method: string,
  args: Abs[],
): Abs | undefined {
  const bigintR = invokeBigintPrim(thisVal, method, args);
  if (bigintR !== undefined) return bigintR;
  const numberR = invokeNumberPrim(thisVal, method, args);
  if (numberR !== undefined) return numberR;
  return invokeBooleanPrim(thisVal, method, args);
}
