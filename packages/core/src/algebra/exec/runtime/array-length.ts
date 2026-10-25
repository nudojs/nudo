/**
 * 数组 length 写门（Bug 223 / 230 / 231）——**叶子模块**（只依赖 abs /
 * objects 两个叶子，不与 exec/runtime 其它模块成环）。
 *
 * - **Bug 231**（ArraySetLength 域校验）：原生先 `ToNumber(value)` 再判
 *   整数性与 [0, 2^32-1] 界。引擎此前只判「**数字**字面量」，把
 *   `undefined` / `{}` / `"abc"` 等**具体非数值**当成抽象值放行 → 原生
 *   RangeError 缺失（门禁假绿）。本模块给出 ToNumber 判定：
 *   - `nan`：ToNumber → NaN → **RangeError**（undefined / {} / "abc" …）
 *   - `typeerror`：ToNumber 本身抛（Symbol）→ **TypeError**
 *   - `num`：可转数字（number / 数字字符串 / 布尔 / null / bigint / 数组字面量）
 *   - `abstract`：不可判定（开放对象 / 类实例 / 抽象元素）→ **不抛**
 *     （sound 回退：原生本身不可判定，不制造确定假红）
 * - **Bug 223**（sealed 数组 length 截断写）：截断要**删除**被截掉的元素，
 *   sealed 数组的元素是**不可配置**自有属性 → 原生 TypeError。增长合法；
 *   `preventExtensions`（nonext）不冻结元素 → 截断**不**抛。
 * - **Bug 230**（delete a.length）：数组 length 是**不可配置**自有属性 →
 *   delete 恒 TypeError（strict）；**字符串 prim 接收者**同款（String 包装
 *   对象的 length 不可配置）。
 */
import type { Abs } from "../../abs.ts";
import { litValue } from "../../abs.ts";
import { getProtoAbs, getSlot, type ObjShape } from "../../objects.ts";
import { MAX_PROTO_DEPTH, ownPropHolder } from "./proto-walk.ts";

/** 数组 length 域判定结果（ToNumber → 整数 → [0, 2^32-1]） */
export type LengthNumber =
  /** 可转数字（n 可能非整数 / 越界——越界判定在调用方） */
  | { kind: "num"; n: number }
  /** ToNumber → NaN → 原生 RangeError */
  | { kind: "nan" }
  /** ToNumber 自身抛（Symbol）→ 原生 TypeError */
  | { kind: "typeerror" }
  /** 不可判定 → 不抛（sound 回退） */
  | { kind: "abstract" };

/**
 * 对象是否可能有**自定义**数值转换（valueOf / toString）——ToPrimitive
 * 走 valueOf → toString；命中任一自定义实现则 ToNumber 结果不可判定。
 * 默认 Object.prototype.valueOf/toString → "[object Object]" → NaN。
 */
function hasCustomNumberConversion(o: Abs): boolean {
  let p: Abs | undefined = o;
  let depth = 0;
  while (p !== undefined && depth++ < MAX_PROTO_DEPTH) {
    const holder = ownPropHolder(p);
    if (holder) {
      const slots = (holder.shape as ObjShape).slots;
      if (getSlot(slots, "valueOf") || getSlot(slots, "toString")) return true;
    }
    p = getProtoAbs(p);
  }
  return false;
}

/**
 * length 域判定：ToNumber(value) 的可判定部分。
 *
 * @param v 被写入 length 的值（Abs）
 */
export function lengthToNumber(v: Abs): LengthNumber {
  const lv = litValue(v);
  if (lv.ok) {
    const raw = lv.value;
    if (typeof raw === "number") return { kind: "num", n: raw };
    if (typeof raw === "string") {
      // StringToNumber："" / 纯空白 → 0；非法串 → NaN
      const n = Number(raw);
      return Number.isNaN(n) ? { kind: "nan" } : { kind: "num", n };
    }
    if (typeof raw === "boolean") return { kind: "num", n: raw ? 1 : 0 };
    if (typeof raw === "bigint") return { kind: "num", n: Number(raw) };
    if (raw === null) return { kind: "num", n: 0 };
    if (raw === undefined) return { kind: "nan" };
    if (typeof raw === "symbol") return { kind: "typeerror" };
    return { kind: "abstract" };
  }
  // 非字面量：数组字面量 → ToPrimitive（hint default → String）→ Number
  if (v.shape.k === "tuple") {
    const els = (v.shape as { elements: Abs[] }).elements;
    if (els.length === 0) return { kind: "num", n: 0 };
    if (els.length === 1) {
      const el = litValue(els[0]!);
      if (el.ok && (typeof el.value === "number" || typeof el.value === "string")) {
        const n = Number(String(el.value));
        return Number.isNaN(n) ? { kind: "nan" } : { kind: "num", n };
      }
      return { kind: "abstract" };
    }
    // 多元素数组 → String → "1,2" → NaN
    return { kind: "nan" };
  }
  if (v.shape.k === "obj") {
    // 开放对象（Object.create(抽象原型) 等）自有键不可知 → 不判定
    if ((v.shape as { open?: boolean }).open) return { kind: "abstract" };
    if (hasCustomNumberConversion(v)) return { kind: "abstract" };
    // 默认 toString → "[object Object]" → NaN
    return { kind: "nan" };
  }
  // arr（长度未知的数组）/ brand（类实例）/ prim 抽象 → 不可判定
  return { kind: "abstract" };
}

/**
 * Bug 230：数组 length 是**不可配置**自有属性 → `delete a.length` 恒
 * TypeError（strict）。非数组 / 非 length 键 → 不拦（交调用方常态处理）。
 *
 * **字符串 prim 接收者**（`delete s.length`）：String 包装对象的 "length"
 * 是**不可配置**自有属性（原生
 * `Object.getOwnPropertyDescriptor("ab","length").configurable === false`）
 * ⇒ strict（ESM）下 `delete s.length` 恒 TypeError。此前 prim 臂不拦 ⇒
 * 引擎折 unknown（假绿）。
 *
 * @param o delete 的接收者
 * @param key 属性键（字符串；抽象键 → undefined）
 */
export function arrayLengthIsNonConfigurable(o: Abs, key: string | undefined): boolean {
  if (key !== "length") return false;
  if (o.shape.k === "tuple" || o.shape.k === "arr") return true;
  if (o.shape.k === "prim" && o.shape.type === "string") return true;
  return false;
}
