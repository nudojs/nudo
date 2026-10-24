/**
 * Bug 149：符号键的**内部槽键表示**（"@@X" 字符串）↔ **对外可见的
 * PropertyKey**（宿主真 symbol）之间的映射。
 *
 * 引擎内部用 "@@name" 作为符号键的槽键表示（Bug 73 的表示）——槽表 / 枚举面
 * / JSON 面都按这个串寻址。但 Proxy 陷阱的 key 实参必须按规范传**真 symbol**
 * （trap 收到的 key 与读取时的 key 相同），否则按 symbol 分派的 handler 全部
 * 失灵：typeof k 得 "string"、String(k) 得 "@@iterator"、k === Symbol.iterator
 * 恒 false。
 *
 * 映射源：宿主 `Symbol` 命名空间的自有**字符串名**属性（值为 symbol 的那些）
 * ——与转译侧静态投影 "[Symbol.X] → "@@X"" 严格同源（同一个 X）。
 *
 * 不变量：
 * - 只有**宿主 well-known 符号**有槽键投影；用户符号（Symbol("x") /
 *   Symbol.for("x")）无宿主名 → 两侧都 undefined（不得凭空捏一个符号）。
 * - 槽键 → 符号按**名字**查（转译期投影的名字）；符号 → 槽键按**宿主身份**
 *   查（不按 description——用户符号 Symbol("Symbol.iterator") 的 description
 *   恰是 "Symbol.iterator"，按 description 会误投影到 well-known 槽）。
 */
import type { Abs } from "../../abs.ts";
import { litAbsFromJs } from "./state.ts";

/** 宿主 Symbol 命名空间：属性名 → 真 symbol（well-known 全集） */
const HOST_SYMBOLS: ReadonlyMap<string, symbol> = (() => {
  const m = new Map<string, symbol>();
  for (const name of Object.getOwnPropertyNames(Symbol)) {
    const v = (Symbol as unknown as Record<string, unknown>)[name];
    if (typeof v === "symbol") m.set(name, v);
  }
  return m;
})();

/** 真 symbol → 内部槽键 "@@X"（宿主身份反查；用户符号不在表内） */
const HOST_SYMBOL_SLOT_KEYS: ReadonlyMap<symbol, string> = (() => {
  const m = new Map<symbol, string>();
  for (const [name, v] of HOST_SYMBOLS) m.set(v, `@@${name}`);
  return m;
})();

/** 内部槽键 "@@X" → 宿主真 symbol；非 well-known 槽键 → undefined */
export function hostSymbolForSlotKey(slotKey: string): symbol | undefined {
  if (!slotKey.startsWith("@@")) return undefined;
  return HOST_SYMBOLS.get(slotKey.slice(2));
}

/**
 * 内部槽键 "@@X" → symbol Abs（Proxy 陷阱 key 实参用）。
 * 非 well-known 槽键 → undefined（调用方退回字符串实参——不得凭空捏符号）。
 */
export function symbolAbsForSlotKey(slotKey: string): Abs | undefined {
  const sym = hostSymbolForSlotKey(slotKey);
  return sym === undefined ? undefined : litAbsFromJs(sym);
}

/**
 * symbol Abs → 内部槽键 "@@X"（`in` 的槽寻址用）。
 * 按**宿主身份**反查；无 lit term 的抽象符号（Symbol() 产物）→ undefined。
 */
export function slotKeyOfSymbolAbs(a: Abs): string | undefined {
  if (a.term?.op !== "lit") return undefined;
  const v = a.term.value as unknown;
  if (typeof v !== "symbol") return undefined;
  return HOST_SYMBOL_SLOT_KEYS.get(v);
}
