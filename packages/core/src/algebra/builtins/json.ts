/**
 * JSON.parse / JSON.stringify
 */
import type { Abs } from "../abs.ts";
import { abs, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { getSlot } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { str } from "./shared.ts";
import { getPropFlags } from "./invariants.ts";

const NOT_LITERAL = Symbol("nudo:not-literal");

/** Abs 字面量树 → JS 值（JSON.stringify 折叠输入）；非字面量子树不提取 */
function absToJsonNative(a: Abs, seen: Set<object>): unknown | typeof NOT_LITERAL {
  if (seen.has(a as object)) return NOT_LITERAL; // 防御自引用（Abs 树理论无环）
  const t = a.term;
  if (t?.op === "lit") return t.value; // 含 bigint/symbol/undefined/null
  const s = a.shape;
  if (s.k === "tuple") {
    seen.add(a as object);
    const holes = (a.shape as { holes?: number[] }).holes ?? [];
    const out: unknown[] = [];
    for (let i = 0; i < s.elements.length; i++) {
      // hole 与 undefined 元素提取同为 undefined——JSON.stringify 数组槽都输出 null
      if (holes.includes(i)) {
        out.push(undefined);
        continue;
      }
      const v = absToJsonNative(s.elements[i]!, seen);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      out.push(v);
    }
    return out;
  }
  if (s.k === "obj") {
    // open/带 index 的对象有未知键：序列化结果不确定
    if (s.open || s.index) return NOT_LITERAL;
    seen.add(a as object);
    const out: Record<string, unknown> = {};
    const flags = getPropFlags(a);
    for (const [k, sv] of Object.entries(s.slots as Record<string, { value: Abs }>)) {
      // enumerable:false（defineProperty 描述符）→ JSON.stringify 跳过
      if (flags?.get(k)?.enumerable === false) continue;
      const v = absToJsonNative(sv.value, seen);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      out[k] = v;
    }
    return out;
  }
  return NOT_LITERAL;
}

/** JS 值 → Abs（JSON.parse 字面量折叠；JSON 值域无 bigint/symbol/undefined/function） */
function jsonValueToAbs(v: unknown): Abs {
  if (v === null) return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
  if (typeof v === "number") return numLit(v);
  if (typeof v === "string") return strLit(v);
  if (typeof v === "boolean") return boolLit(v);
  if (Array.isArray(v)) {
    return abs({ k: "tuple", elements: v.map(jsonValueToAbs) }, undefined, undefined, "exact");
  }
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, sv] of Object.entries(v as Record<string, unknown>)) {
    slots[k] = { value: jsonValueToAbs(sv) };
  }
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

/** JSON.parse / stringify：字面量实参真执行折叠；失败硬抛（catch 可吸收） */
export function evalJsonMethod(name: string, args: Abs[]): Abs | undefined {
  if (name === "parse") {
    // 无实参 ≡ 实参 undefined：原生 ToString(undefined)="undefined" → SyntaxError
    const a0Abs = args[0];
    if (!a0Abs) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    // reviver 实参：原生逐键变换——Abs 侧不建模，任何存在性都保守 unknown
    if (args[1]) return unknown;
    const t = a0Abs.term;
    if (t?.op !== "lit") return unknown; // 抽象实参：保守
    const v = t.value;
    if (v === undefined) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    // 原生先 ToString：number/boolean/bigint/null 都走字符串解析；
    // symbol 的 ToString 原生 TypeError
    if (typeof v === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    const src =
      typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean" || typeof v === "bigint"
          ? String(v)
          : v === null
            ? "null"
            : undefined;
    if (src === undefined) return unknown;
    try {
      return jsonValueToAbs(JSON.parse(src));
    } catch {
      throw new NudoThrow(errorTypeAbs("SyntaxError"));
    }
  }
  if (name === "stringify") {
    // 顶层 undefined（无参/显式/函数/symbol）→ 原生返回 undefined 值
    const a0Abs = args[0];
    if (!a0Abs) return undefAbs();
    const v = absToJsonNative(a0Abs, new Set());
    if (v === NOT_LITERAL) return str("partial");
    // replacer：数组字面量 → 白名单键；null/非数组非函数 → 原生忽略；
    // 函数 replacer / 抽象 → 保守（结果串不可判定）
    const replacerArg = args[1];
    let replacer: (string | number)[] | undefined;
    if (replacerArg) {
      const rv = absToJsonNative(replacerArg, new Set());
      if (rv === NOT_LITERAL) return str("partial");
      if (Array.isArray(rv)) {
        replacer = rv.filter(
          (x): x is string | number => typeof x === "string" || typeof x === "number",
        );
      } else if (typeof rv === "function") {
        return str("partial");
      }
      // 其余（null/prim/对象）：原生忽略 replacer，照常序列化
    }
    // space：number（NaN/±Inf→0，负→0，>10→10，截断）/ string（前 10 字符）；
    // 缺省/null/undefined → 紧凑。非字面量 → 保守
    const spaceArg = args[2];
    let space: number | string | undefined;
    if (spaceArg) {
      const t = spaceArg.term;
      if (t?.op !== "lit") return str("partial");
      const sv = t.value;
      if (typeof sv === "number") {
        space = Number.isFinite(sv) ? Math.min(10, Math.max(0, Math.floor(sv))) : 0;
      } else if (typeof sv === "string") {
        space = sv;
      } else if (sv !== undefined && sv !== null) {
        return str("partial");
      }
    }
    try {
      const s = JSON.stringify(v, replacer, space);
      return s === undefined ? undefAbs() : strLit(s);
    } catch {
      // bigint / 循环引用（防御）→ 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  return undefined;
}
