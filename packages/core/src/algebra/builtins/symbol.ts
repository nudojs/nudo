/**
 * Symbol 构造 / 描述 / 字符串化
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, strLit, unknown } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import { registerSymbolMeta, symbolIdOf, symbolDescriptionAbs, isSymbolAbs as isSymAbs } from "../symbol-id.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { numPrim, str, boolPrim } from "./shared.ts";

function undefLit(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "exact");
}

/**
 * Symbol([description])：非具体 unique symbol（prim type=symbol，无 term）。
 * - 身份：侧表 id（两个 Symbol() 的 === 为 false；同 Abs 引用为 true）
 * - .description：字面量 string 或 undefined
 * - 不折成可比较的字面量身份（description 不作 identity）
 */
export function makeSymbolAbs(descArg?: Abs): Abs {
  let description: Abs;
  if (descArg === undefined) {
    description = undefLit();
  } else if (descArg.term?.op === "lit") {
    const v = descArg.term.value;
    if (v === undefined) description = undefLit();
    else if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    else description = strLit(String(v));
  } else {
    // Bug 23：shape 先于 lit 判定——Symbol()/成员读出的 prim symbol 无 lit 项
    // （JS 无 symbol 字面量，上面 lit 分支的 typeof symbol 是防御性死代码），
    // ToString(descriptor) 原生恒抛 TypeError（node 实测 Symbol(Symbol()) 抛）
    if (isSymAbs(descArg)) throw new NudoThrow(errorTypeAbs("TypeError"));
    // 抽象 description：ToString 结果未知（string 或 undefined）
    description = abs({ k: "prim", type: "string" }, undefined, undefined, "partial");
  }
  const a: Abs = {
    shape: { k: "prim", type: "symbol" },
    conf: "path",
  };
  return registerSymbolMeta(a, description);
}

export const isSymbolAbs = isSymAbs;
export { undefLit };
export { symbolIdOf, symbolDescriptionAbs };

function symbolDescriptiveString(a: Abs): string {
  const d = symbolDescriptionAbs(a);
  const dvR = d ? litValue(d) : undefined;
  const dv = dvR?.ok ? dvR.value : undefined;
  if (typeof dv === "string") return dv.length > 0 ? `Symbol(${dv})` : "Symbol()";
  return "Symbol()";
}

/** 全局 Symbol([desc])（$callNamed 身份校验后派发） */
export function evalSymbolCtor(args: Abs[]): Abs {
  return makeSymbolAbs(args[0]);
}

// --- Bug 43：Symbol.for / Symbol.keyFor（全局注册表语义）------------------
// 原生注册表按 ToString(key) 全局驻留：同 key 两次 Symbol.for 是**同一**符号
//（=== 为 true、keyFor 可反查）。分析侧以 key 复用同一 Abs 对象建模身份；
// 注册表跨模块驻留（与原生一致，进程生命周期）。
const registeredSymbols = new Map<string, Abs>();

/**
 * `Symbol.for(key)`：key 过 ToString——symbol prim（Symbol()/成员读产物，
 * 无 lit 项）定抛 TypeError；any/unknown/对象（toString 可能返 Symbol）
 * may；其余字面量（string/number/boolean/bigint/null/undefined）ToString
 * 全定，按 String(key) 入注册表（description = key 字符串，node 实测
 * Symbol.for().description === "undefined"）。抽象 key → 保守未注册 symbol。
 */
export function evalSymbolStatic(method: string, args: Abs[]): Abs | undefined {
  if (method !== "for" && method !== "keyFor") return undefined;
  const a0 = args[0];
  if (method === "for") {
    if (a0 && isSymAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
    if (a0 && a0.term?.op !== "lit") {
      // 抽象 key：ToPrimitive 可能成 Symbol → may（bigint/number/… 合法）
      if (
        a0.shape.k === "any" ||
        a0.shape.k === "unknown" ||
        a0.shape.k === "obj" ||
        a0.shape.k === "fn" ||
        a0.shape.k === "brand" ||
        a0.shape.k === "sum"
      ) {
        recordMayThrow({ kind: "TypeError", cause: "Symbol.for key ToString may throw (Symbol)" });
      }
      // key 不可判 → 无法入注册表：保守未注册 unique symbol
      return makeSymbolAbs(a0);
    }
    // 缺省 ≡ Symbol.for(undefined)：key "undefined"（node 实测与
    // Symbol.for() 同一符号，description "undefined"）
    const v = a0 ? (a0.term as { value: unknown }).value : undefined;
    const key = String(v);
    const existing = registeredSymbols.get(key);
    if (existing) return existing;
    const sym = registerSymbolMeta(
      { shape: { k: "prim", type: "symbol" }, conf: "path" } as Abs,
      strLit(key),
    );
    registeredSymbols.set(key, sym);
    return sym;
  }
  // Symbol.keyFor(sym)：实参必须是 symbol——非 symbol 字面量 / 抽象 refined
  // prim（number/string/…，不可能是 symbol 值）定抛（node 实测 keyFor(1)/
  // keyFor('a')/keyFor(null) 全抛 "x is not a symbol"）；注册表命中 → key
  // 字符串；fresh symbol（未注册）→ undefined；any/unknown/对象 → may +
  // string|undefined 联合
  if (!a0) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (isSymAbs(a0)) {
    for (const [key, sym] of registeredSymbols) {
      if (sym === a0) return strLit(key);
    }
    return undefLit(); // 未注册 fresh symbol → undefined
  }
  if (a0.term?.op === "lit" || a0.shape.k === "prim") {
    throw new NudoThrow(errorTypeAbs("TypeError")); // 确定非 symbol
  }
  recordMayThrow({ kind: "TypeError", cause: "Symbol.keyFor argument may not be a symbol" });
  return joinAbs(str("path"), undefLit());
}

/** String(sym) → SymbolDescriptiveString（原生不抛；隐式 ToString 才抛） */
export function stringOfSymbol(a: Abs): Abs {
  const d = symbolDescriptionAbs(a);
  if (d) {
    // description 槽在：undefined 字面量 → "Symbol()"；string 字面量 → Symbol(desc)
    if (d.term?.op === "lit") return strLit(symbolDescriptiveString(a));
  }
  return str("path");
}
