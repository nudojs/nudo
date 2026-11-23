/**
 * 模板标签对象（GetTemplateObject）：冻结的数组 exotic。
 *
 * 从 iterate.ts 抽出；模板对象同时需要数组视图与元素侧表，迭代 / spread
 * 仍由 iterate 消费侧表。
 */
import type { Abs } from "../../../abs.ts";
import { abs } from "../../../abs.ts";
import { numLit } from "../../../abs.ts";
import { absFunction } from "../../../abs-fn.ts";
import { setSlot } from "../../../objects.ts";
import { markExtState, setPropFlags } from "../../../builtins.ts";
import { markMatchArrayView } from "../../../builtins/regexp.ts";
import { registerTplElements } from "../../match-iter.ts";
import { $arr } from "./arr-make.ts";
import { $lit, noBody } from "../state.ts";

export function $tpl(cooked: Array<string | undefined>, raw: string[]): Abs {
  const slots: Record<string, { value: Abs; symbolKey?: boolean }> = Object.create(null);
  const els: Abs[] = [];
  for (let i = 0; i < cooked.length; i++) {
    const c = cooked[i]!;
    const v = typeof c === "string" ? $lit(c) : $lit(undefined);
    els.push(v);
    setSlot(slots, String(i), { value: v });
  }
  setSlot(slots, "length", { value: numLit(cooked.length) });
  const rawArr = $arr(raw.map((r) => $lit(r)));
  setSlot(slots, "raw", { value: rawArr });
  setSlot(slots, "@@iterator", {
    value: absFunction([], { body: noBody }, { ctor: false }),
    // Bug 99/106：迭代器是 Symbol.iterator 的**符号键槽**，不是字符串
    // "@@iterator" 属性（原生 Object.keys(s) 看不到它）——按字符串键发布
    // 会产出运行时不存在的字段 / 恒假守卫子句。
    symbolKey: true,
  });
  const t = abs({ k: "obj", slots }, undefined, undefined, "exact");
  // Bug 195：元槽非枚举 + 不可写（原生冻结数组的自有属性全 non-writable/
  // non-configurable；length/raw/@@iterator 另 non-enumerable）。
  for (const k of ["length", "raw", "@@iterator"]) {
    setPropFlags(t, k, { enumerable: false, writable: false, configurable: false });
  }
  // Bug 195：冻结（原生 SetIntegrityLevel(frozen)——s 与 s.raw 皆冻结）。
  markExtState(t, "frozen");
  markExtState(rawArr, "frozen");
  // Bug 195：数组序列化视图（原生模板对象是 Array ⇒ JSON.stringify 走数组面）
  markMatchArrayView(t);
  // 元素侧表：spread / for-of / join 按 cooked 精确展开
  registerTplElements(t, els);
  return t;
}

/**
 * TypedArray brand 的**精确**迭代元素序列：长度槽可判且内层索引槽齐备时
 * 逐槽取值（`[...new Uint8Array([1,2])]` → [1,2]）；任一位不可判 → undefined
 * （调用方退元素域单代表，不得折半精确元组）。
 */
