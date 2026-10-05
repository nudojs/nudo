/**
 * 全局转换函数（parseInt / Number / String / Boolean / Object / Array / Symbol / BigInt …）
 * 以及无 `new` 的原生构造器调用（Error 家族 / Map / Set / Promise …）。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, bigintLit, unknown, confJoin } from "../abs.ts";
import { objOf } from "../objects.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { numPrim, str, boolPrim, mayCoerceThrowOperand, isBigintPrimAbs } from "./shared.ts";
import { foldParseInt, foldParseFloat } from "./number.ts";
import { makeArrayCtorAbs } from "./array.ts";
import { makeSymbolAbs, isSymbolAbs, stringOfSymbol } from "./symbol.ts";
import { errorBrandAbs, isErrorCtorName } from "./error.ts";

/** term 确为 lit（含 lit(undefined)）；litValue 无法区分「字面量 undefined」与「无 lit」 */
function litTermOf(a: Abs | undefined): { value: unknown } | undefined {
  return a?.term?.op === "lit" ? (a.term as { value: unknown }) : undefined;
}

/**
 * ToBigInt（BigInt(x) 调用语义；`new BigInt` 原生 TypeError，不在此路径）。
 * 抽象 prim 折 bigint 非具体；确定非法 lit 硬抛（与 bigint-mixed-op 同口径）。
 */
function toBigIntAbs(args: Abs[]): Abs {
  const a0 = args[0];
  if (!a0) throw new NudoThrow(errorTypeAbs("TypeError")); // BigInt() → TypeError
  const lit = litTermOf(a0);
  if (lit) {
    const v = lit.value;
    if (typeof v === "bigint") return bigintLit(v);
    if (typeof v === "number") {
      // NumberToBigInt：非整数 / NaN / Infinity → RangeError
      if (!Number.isFinite(v) || !Number.isInteger(v)) {
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      return bigintLit(BigInt(v));
    }
    if (typeof v === "string") {
      // StringToBigInt：解析失败 → SyntaxError
      try {
        return bigintLit(BigInt(v));
      } catch {
        throw new NudoThrow(errorTypeAbs("SyntaxError"));
      }
    }
    if (typeof v === "boolean") return bigintLit(v ? 1n : 0n);
    // undefined / null / symbol → TypeError
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (isSymbolAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
  // Bug 30：闭 obj 字面量且无自有 toString/valueOf → ToPrimitive 恒得
  // "[object Object]"，StringToBigInt 恒失败 → 确定 SyntaxError
  //（node 实测 BigInt({}) / BigInt({a:1}) 抛）；open obj / 带 coercer /
  // any/fn/brand/sum → may（TypeError: Symbol 载体 / SyntaxError: 不可解析）
  if (a0.shape.k === "obj") {
    const so = a0.shape as { slots: Record<string, unknown>; open?: boolean };
    const hasCoercer = "toString" in so.slots || "valueOf" in so.slots;
    if (!so.open && !hasCoercer) throw new NudoThrow(errorTypeAbs("SyntaxError"));
  }
  if (mayCoerceThrowOperand(a0)) {
    recordMayThrow({ kind: "TypeError", cause: "BigInt() ToPrimitive may be a Symbol" });
    recordMayThrow({ kind: "SyntaxError", cause: "BigInt() ToPrimitive result may be unparseable" });
  }
  // 抽象 prim / 对象：ToPrimitive 后仍可能是任意可转值——保守 bigint 非具体
  return abs(
    { k: "prim", type: "bigint" },
    undefined,
    undefined,
    confJoin(a0.conf, "widened"),
  );
}

export function evalGlobalFn(name: string, args: Abs[]): Abs | undefined {
  const a0R = args[0] ? litValue(args[0]) : undefined;
  // 仅取字面量值做 typeof 分派；是否是字面量看 a0Lit / a0R.ok，不用 !==undefined 哨兵
  const a0 = a0R?.ok ? a0R.value : undefined;
  const a0Lit = litTermOf(args[0]);
  switch (name) {
    case "eval":
      // 动态代码语义不可静态建模：保守 unknown。宿主 eval 对非字符串实参
      // 原样返回——直接调用会把 strLit Abs 对象原样传回并折成字符串假精确。
      return unknown;
    case "Array":
      // Array(n)/Array(a,b)/Array() 与 new Array 同语义（共享 makeArrayCtorAbs）
      return makeArrayCtorAbs(args);
    case "parseInt": {
      // 首参 ToString，radix ToInt32（'2'→2、true→1 越界 NaN、null/false→0）
      // 缺省首参 ≡ undefined → ToString(undefined)="undefined" → NaN。抽象不折。
      // Bug 26：首参 shape 先于 lit——prim symbol ToString 恒抛 TypeError；
      // 抽象（any/obj/…）ToPrimitive 可能成 Symbol → may（node 实测
      // parseInt({toString(){return Symbol()}}) 抛）。bigint ToString 合法。
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      const sVal = a0Lit ? a0Lit.value : undefined;
      const firstAbstract = !a0Lit && !!args[0] && args[0].term?.op !== "lit";
      if (firstAbstract && mayCoerceThrowOperand(args[0])) {
        recordMayThrow({ kind: "TypeError", cause: "parseInt argument ToString may throw (Symbol)" });
      }
      const rAbs = args[1];
      let radix: number | string | boolean | null | undefined;
      if (!rAbs) {
        radix = undefined;
      } else if (rAbs.term?.op !== "lit") {
        // Bug 45：radix ToInt32 → ToNumber——prim symbol/bigint（无 lit 项）
        // 确定 TypeError；抽象 may（symbol/bigint 载体）。抽象 radix 不折。
        if (isSymbolAbs(rAbs) || isBigintPrimAbs(rAbs)) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        if (mayCoerceThrowOperand(rAbs)) {
          recordMayThrow({ kind: "TypeError", cause: "parseInt radix ToNumber may throw (Symbol/BigInt)" });
        }
        return numPrim();
      } else if (typeof rAbs.term.value === "symbol") {
        // 防御：JS 无 symbol 字面量，正常源不可达
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else {
        const rv = rAbs.term.value;
        radix = rv === undefined
          ? undefined
          : (rv as number | string | boolean | null);
        if (rv !== undefined && typeof rv !== "number" && typeof rv !== "string" && typeof rv !== "boolean" && rv !== null) {
          // Bug 45：bigint 字面量 radix——ToNumber(1n) 恒抛 TypeError
          //（node 实测 parseInt("1", 1n) → TypeError）
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
      }
      if (firstAbstract) return numPrim();
      return foldParseInt(sVal as string | number | boolean | null | bigint | undefined, radix);
    }
    case "parseFloat": {
      // 缺省首参 ≡ undefined → NaN
      // Bug 26：同 parseInt 首参——prim symbol 硬抛；抽象 may
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (!a0Lit && args[0] && args[0].term?.op !== "lit") {
        if (mayCoerceThrowOperand(args[0])) {
          recordMayThrow({ kind: "TypeError", cause: "parseFloat argument ToString may throw (Symbol)" });
        }
        return numPrim();
      }
      return foldParseFloat(a0Lit ? a0Lit.value as string | number | boolean | null | bigint | undefined : undefined);
    }
    case "isNaN": {
      // 全局 isNaN：ToNumber 后判 NaN（与 Number.isNaN 不同，会强制转换）
      // isNaN('x')===true、isNaN(true)===false、isNaN(null)===false、
      // isNaN(undefined)===true、isNaN('')===false、isNaN('42')===false
      // Bug 81：prim symbol/bigint（无 lit 项）ToNumber 恒抛 TypeError
      if (args[0] && (isSymbolAbs(args[0]) || isBigintPrimAbs(args[0]))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (!args[0] || (args[0].term?.op === "lit" && args[0].term.value === undefined)) {
        return boolLit(true);
      }
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      if (typeof a0 === "boolean" || a0 === null) return boolLit(false);
      if (typeof a0 === "string") return boolLit(Number.isNaN(Number(a0)));
      if (typeof a0 === "bigint") throw new NudoThrow(errorTypeAbs("TypeError"));
      // Bug 81：抽象臂（any/obj/…）ToPrimitive 可能成 Symbol/BigInt → may
      if (mayCoerceThrowOperand(args[0])) {
        recordMayThrow({ kind: "TypeError", cause: "isNaN coercion may throw (Symbol/BigInt)" });
      }
      return boolPrim();
    }
    case "isFinite": {
      // 全局 isFinite：ToNumber 后判有限（与 Number.isFinite 不同，会强制转换）
      // isFinite() / isFinite(undefined) → false（ToNumber(undefined)=NaN）
      // 抽象/symbol 实参不得折 false（symbol 原生 ToNumber 抛 TypeError）
      // Bug 81：补齐与 isNaN 同口径的 bigint 守卫（isFinite(1n) 原生 TypeError）
      if (args[0] && (isSymbolAbs(args[0]) || isBigintPrimAbs(args[0]))) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (!args[0] || (args[0].term?.op === "lit" && args[0].term.value === undefined)) {
        return boolLit(false);
      }
      if (typeof a0 === "number") return boolLit(Number.isFinite(a0));
      if (typeof a0 === "boolean") return boolLit(true);
      if (typeof a0 === "string") return boolLit(Number.isFinite(Number(a0)));
      if (a0 === null) return boolLit(true);
      if (typeof a0 === "bigint") throw new NudoThrow(errorTypeAbs("TypeError"));
      // Bug 81：抽象臂（any/obj/…）ToPrimitive 可能成 Symbol/BigInt → may
      if (mayCoerceThrowOperand(args[0])) {
        recordMayThrow({ kind: "TypeError", cause: "isFinite coercion may throw (Symbol/BigInt)" });
      }
      return boolPrim();
    }
    case "Number":
      // Number(sym) → TypeError（ToNumeric 抛）
      // Number() → +0；Number(undefined) → NaN；Number(null) → 0；Number(5n) → 5
      //（Number 走 ToNumeric：Number(1n) / Number({valueOf(){return 1n}}) 合法折 number，
      //  node 实测；Math/isNaN 等 ToNumber 面才对 bigint 抛）
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (!args[0]) return numLit(0);
      if (a0Lit && a0Lit.value === undefined) return numLit(NaN);
      if (typeof a0 === "number") return numLit(a0);
      if (typeof a0 === "string") return numLit(Number(a0));
      if (typeof a0 === "boolean") return numLit(a0 ? 1 : 0);
      if (a0 === null) return numLit(0);
      if (typeof a0 === "bigint") return numLit(Number(a0));
      // Bug 50：抽象臂（any/obj/…）ToPrimitive 可能成 Symbol 值 → ToNumeric
      // may TypeError；bigint prim（BigInt(x) 产物）合法折 number（值域不变）
      if (mayCoerceThrowOperand(args[0])) {
        recordMayThrow({ kind: "TypeError", cause: "Number() coercion may throw (Symbol)" });
      }
      return numPrim();
    case "String":
      // String(sym) → SymbolDescriptiveString（原生不抛）；其余 ToString
      // String() → ""；String(undefined) → "undefined"（litValue 哨兵不得吞掉）
      if (args[0] && isSymbolAbs(args[0])) return stringOfSymbol(args[0]);
      if (!args[0]) return strLit("");
      if (a0Lit) return strLit(String(a0Lit.value));
      return str();
    case "Symbol":
      // Symbol([desc])：非具体 unique symbol
      return makeSymbolAbs(args[0]);
    case "Boolean":
      // Boolean() / Boolean(undefined) → false（litValue 哨兵不得吞掉）
      if (!args[0]) return boolLit(false);
      if (a0Lit) return boolLit(Boolean(a0Lit.value));
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
    case "BigInt":
      return toBigIntAbs(args);
    default: {
      // Error 家族无 `new` 调用 ≡ new Error(...)（原生同语义）→ errorBrandAbs。
      // 此前落到宿主直调：AggregateError(absArr) 走 iterable 协议炸 internal；
      // Error(absObj) 静默 ToString 成 "[object Object]" 假 message。
      if (isErrorCtorName(name)) return errorBrandAbs(name, args);
      // Map/Set/WeakMap/WeakSet/Promise 必须 `new`——原生 TypeError。
      // 此前宿主直调抛 "requires 'new'"，被 call 边界折成 internal。
      if (
        name === "Map" ||
        name === "Set" ||
        name === "WeakMap" ||
        name === "WeakSet" ||
        name === "Promise"
      ) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return undefined;
    }
  }
}

