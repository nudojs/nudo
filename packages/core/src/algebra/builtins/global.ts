/**
 * 全局转换函数（parseInt / Number / String / Boolean / Object / Array / Symbol …）
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { objOf } from "../objects.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { numPrim, str, boolPrim } from "./shared.ts";
import { foldParseInt } from "./number.ts";
import { makeArrayCtorAbs } from "./array.ts";
import { makeSymbolAbs, isSymbolAbs, stringOfSymbol } from "./symbol.ts";

/** term 确为 lit（含 lit(undefined)）；litValue 无法区分「字面量 undefined」与「无 lit」 */
function litTermOf(a: Abs | undefined): { value: unknown } | undefined {
  return a?.term?.op === "lit" ? (a.term as { value: unknown }) : undefined;
}

export function evalGlobalFn(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  const a0Lit = litTermOf(args[0]);
  switch (name) {
    case "eval":
      // 动态代码语义不可静态建模：保守 unknown。宿主 eval 对非字符串实参
      // 原样返回——直接调用会把 strLit Abs 对象原样传回并折成字符串假精确。
      return unknown;
    case "Array":
      // Array(n)/Array(a,b)/Array() 与 new Array 同语义（共享 makeArrayCtorAbs）
      return makeArrayCtorAbs(args);
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
    case "isNaN": {
      // 全局 isNaN：ToNumber 后判 NaN（与 Number.isNaN 不同，会强制转换）
      // isNaN('x')===true、isNaN(true)===false、isNaN(null)===false、
      // isNaN(undefined)===true、isNaN('')===false、isNaN('42')===false
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (!args[0] || (args[0].term?.op === "lit" && args[0].term.value === undefined)) {
        return boolLit(true);
      }
      if (typeof a0 === "number") return boolLit(Number.isNaN(a0));
      if (typeof a0 === "boolean" || a0 === null) return boolLit(false);
      if (typeof a0 === "string") return boolLit(Number.isNaN(Number(a0)));
      if (typeof a0 === "bigint") throw new NudoThrow(errorTypeAbs("TypeError"));
      return boolPrim();
    }
    case "isFinite": {
      // 全局 isFinite：ToNumber 后判有限（与 Number.isFinite 不同，会强制转换）
      // isFinite() / isFinite(undefined) → false（ToNumber(undefined)=NaN）
      // 抽象/symbol 实参不得折 false（symbol 原生 ToNumber 抛 TypeError）
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (!args[0] || (args[0].term?.op === "lit" && args[0].term.value === undefined)) {
        return boolLit(false);
      }
      if (typeof a0 === "number") return boolLit(Number.isFinite(a0));
      if (typeof a0 === "boolean") return boolLit(true);
      if (typeof a0 === "string") return boolLit(Number.isFinite(Number(a0)));
      if (a0 === null) return boolLit(true);
      return boolPrim();
    }
    case "Number":
      // Number(sym) → TypeError（ToNumber 抛）
      // Number() → +0；Number(undefined) → NaN；Number(null) → 0；Number(5n) → 5
      if (args[0] && isSymbolAbs(args[0])) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (!args[0]) return numLit(0);
      if (a0Lit && a0Lit.value === undefined) return numLit(NaN);
      if (typeof a0 === "number") return numLit(a0);
      if (typeof a0 === "string") return numLit(Number(a0));
      if (typeof a0 === "boolean") return numLit(a0 ? 1 : 0);
      if (a0 === null) return numLit(0);
      if (typeof a0 === "bigint") return numLit(Number(a0));
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
    default:
      return undefined;
  }
}

