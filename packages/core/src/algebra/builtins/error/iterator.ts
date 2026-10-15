/**
 * 集合迭代器协议对象：collectionIteratorAbs（Map/Set/Array 的
 * keys/values/entries——条目表精确展开）+ abstractSeqIteratorAbs（长度
 * 未知 arr 接收者）+ Map/Set 条目投影（mapEntryKey/setEntryTuple）。
 *
 * Invariants:
 * - 协议面 = obj + next 方法槽（按调用序折 {value, done}，耗尽 →
 *   {value: undefined, done: true}）+ @@iterator 槽；next/@@iterator 打
 *   enumerable:false（原生在 %ArrayIteratorPrototype% 等原型上，
 *   Object.keys(iter)/for-in/assign 折空，Bug 66 同口径）。
 * - 精确迭代器挂元素侧表（registerGenElements/registerGenDrain）——
 *   spread/for-of/Array.from/.next() 链路全求值；消费位 live 视图
 *  （next() 推进收缩、drain 从当前位取剩余并排空，Bug 54）。
 * - abstractSeqIteratorAbs 长度不可知**不挂元素侧表**：next() 折
 *   {value: el ∪ undefined, done: boolean 域}（可能已耗尽），spread/
 *   for-of 走 unbounded join 保守面（不折精确长度）。
 * - 每次调用产出新迭代器对象（markFreshInstance，R2b）；条目投影供
 *   dispatch.ts 的 Map/Set 迭代 case 复用。
 */

import type { Abs } from "../../abs.ts";
import { abs, boolLit, bool, unknown } from "../../abs.ts";
import { joinAbs } from "../../objects.ts";
import { undefAbs } from "../../hof.ts";
import { registerGenElements, registerGenDrain } from "../../exec/match-iter.ts";
import { absFunction } from "../../abs-fn.ts";
import { markFreshInstance } from "../../instance-id.ts";
import { setPropFlags } from "../invariants.ts";
import { noBody } from "../shared.ts";

/** Bug 23：迭代器结果对象 {value, done}（生成器对象 genIterResult 同款） */
function iterResultAbs(value: Abs, done: boolean): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        value: { value },
        done: { value: boolLit(done) },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * Bug 23：Map/Set keys/values/entries 迭代器对象——生成器对象（Bug 22）
 * 同款协议面：obj + next 方法槽（按调用序折 {value, done}，耗尽 →
 * {value: undefined, done: true}）+ @@iterator 槽 + 元素侧表
 * （registerGenElements）——spread/for-of/Array.from/.next() 链路全求值。
 * Bug 63：Array.prototype.entries/keys/values（tuple 接收者）同款复用。
 * Bug 66 同口径：next/@@iterator 槽打 enumerable:false——原生迭代器 next
 * 在 %ArrayIteratorPrototype% 等原型上（非自有可枚举），Object.keys(iter)
 * / for-in / assign 折空。
 */
export function collectionIteratorAbs(els: Abs[]): Abs {
  const state = { i: 0 };
  // Bug 54：消费位 live 视图——next() 推进时收缩；迭代消费（spread /
  // for-of / Array.from / 解构）经 drain 从当前位取剩余并排空
  const live: Abs[] = [...els];
  const next = absFunction(
    [],
    {
      body: noBody,
      apply: (): Abs => {
        if (state.i >= els.length) return iterResultAbs(undefAbs(), true);
        const v = els[state.i]!;
        state.i++;
        if (live.length > 0) live.shift();
        return iterResultAbs(v, false);
      },
    },
    { ctor: false },
  );
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  const iter = abs(
    { k: "obj", slots },
    undefined,
    undefined,
    els.every((e) => e.conf === "exact") ? "exact" : "path",
  );
  setPropFlags(iter, "next", { enumerable: false });
  setPropFlags(iter, "@@iterator", { enumerable: false });
  registerGenElements(iter, live);
  registerGenDrain(iter, {
    drain: (): Abs[] => {
      const remaining = [...live];
      live.length = 0;
      state.i = els.length;
      return remaining;
    },
    peek: (i: number): Abs | undefined => (i < live.length ? live[i] : undefAbs()),
    peekAll: (): Abs[] => [...live],
  });
  // R2b：每次 entries/keys/values 调用产出新迭代器对象——打新鲜实例标
  return markFreshInstance(iter);
}

/**
 * Bug 63：抽象序列（长度未知 arr 接收者）的 keys/values/entries 迭代器
 * 对象。协议面与 collectionIteratorAbs 一致（next 槽 + @@iterator + 均
 * 不可枚举 → Array.isArray 折 false、Object.keys 折 []、typeof .next 折
 * "function"）；长度不可知**不挂元素侧表**——next() 折
 * {value: el ∪ undefined, done: boolean 域}（可能已耗尽），spread/for-of
 * 走 unbounded join 保守面（不折精确长度）。
 */
export function abstractSeqIteratorAbs(el: Abs): Abs {
  const next = absFunction(
    [],
    {
      body: noBody,
      apply: (): Abs =>
        abs(
          {
            k: "obj",
            slots: {
              value: { value: joinAbs(el, undefAbs()) },
              done: { value: bool() },
            },
          },
          undefined,
          undefined,
          "partial",
        ),
    },
    { ctor: false },
  );
  const iter = abs(
    {
      k: "obj",
      slots: {
        next: { value: next },
        "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
      },
    },
    undefined,
    undefined,
    "partial",
  );
  setPropFlags(iter, "next", { enumerable: false });
  setPropFlags(iter, "@@iterator", { enumerable: false });
  // R2b：同 collectionIteratorAbs——每次调用新迭代器对象
  return markFreshInstance(iter);
}

/** Bug 23：Map 迭代条目的 key 投影（条目是 [k, v] 元组；非元组臂 → unknown） */
export function mapEntryKey(e: Abs): Abs {
  if (e.shape.k === "tuple" && e.shape.elements.length >= 1) return e.shape.elements[0]!;
  return unknown;
}

/** Bug 23：Set 元素 → [el, el] 条目元组（Set#entries 原生语义） */
export function setEntryTuple(el: Abs): Abs {
  return abs(
    { k: "tuple", elements: [el, el] },
    undefined,
    undefined,
    el.conf,
  );
}
