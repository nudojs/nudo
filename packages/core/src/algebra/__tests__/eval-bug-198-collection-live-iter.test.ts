/**
 * Bug 198 回归：`Map` / `Set` 的**集合条目遍历必须是接收者的 live 视图**。
 *
 * ES 语义：`Set.prototype.forEach` / `Map.prototype.forEach` / `for-of`（走
 * 集合自身的迭代器）都是**活**的——回调里新增/删除条目，迭代必须看到
 * 接收者**当前**的条目表（新增的条目在追加位置被访问，已删除的条目被跳过）。
 *
 * 修复前：引擎把集合条目**快照**成数组再遍历 ⇒ 回调里的增删对迭代**不可见**
 * （wrong-exact）：
 * - `s.forEach` 删掉 2 → 引擎仍访问 2（原生只访问 1、3）；
 * - `s.forEach` 新增 2 → 引擎漏掉 2（原生访问 1、2）；
 * - `m.forEach` 新增 "b" → 引擎漏掉 "b"（原生访问 a、b）。
 *
 * 负控制：**快照语义**的静态视图（`[...m.keys()]` / `[...s]`）不受影响；
 * 普通对象 / 数组的 forEach 不受影响。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";
import { abs, strLit, numLit, litValue, type Abs } from "../abs.ts";
import { getSlot } from "../objects.ts";
import { getFnImpl, absOnly } from "../abs-fn.ts";
import { makeMapAbs, makeSetAbs } from "../collections.ts";
import { collectionIteratorFor } from "../builtins/error/iterator.ts";

describe("Bug 198：Map/Set 集合条目遍历是接收者的 live 视图", () => {
  it("Set.forEach：回调里删除条目 → 被删条目不再被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2, 3]);
        const out = [];
        s.forEach((v) => { out.push(v); if (v === 1) s.delete(2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,3" });
  });

  it("Set.forEach：回调里新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const out = [];
        s.forEach((v) => { out.push(v); s.add(2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("Map.forEach：回调里新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        m.forEach((v, k) => { out.push(k); m.set("b", 2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("Map.forEach：回调里 clear() → 后续条目不再被访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const out = [];
        m.forEach((v, k) => { out.push(k); m.clear(); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Map.forEach：回调里改写已有条目的值 → 读到的是新值", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const out = [];
        m.forEach((v, k) => { out.push(v); if (k === "a") m.set("b", 9); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,9" });
  });

  it("for-of（Set）：回调体里删除条目 → 被删条目不再被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const out = [];
        for (const v of s) { out.push(v); if (v === 1) s.delete(2); }
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("for-of（Map）：循环体里新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        for (const [k] of m) { out.push(k); m.set("b", 2); }
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("for-of（Set）：循环体里 clear() → 立即终止", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const out = [];
        for (const v of s) { out.push(v); s.clear(); }
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("负控制：静态快照视图不受影响（[...m.keys()] / [...s]）", () => {
    expect(val(`export function f() { const m = new Map([["a",1],["b",2]]); return [...m.keys()].join(","); }`)).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(val(`export function f() { const s = new Set([1,2]); return [...s].join(","); }`)).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("负控制：数组 / 普通对象的 forEach 不受影响", () => {
    expect(
      val(`export function f() { const a = [1,2]; const out = []; a.forEach((v) => out.push(v)); return out.join(","); }`),
    ).toEqual({ ok: true, value: "1,2" });
    expect(
      val(`export function f() { const o = {a:1,b:2}; const out = []; Object.keys(o).forEach((k) => out.push(k)); return out.join(","); }`),
    ).toEqual({ ok: true, value: "a,b" });
  });
});

/**
 * 手动迭代器（`m.keys()` / `m.values()` / `m.entries()` / `a.keys()` /
 * `a.values()` / `a.entries()` / `a[Symbol.iterator]()`）同样是**接收者的
 * live 视图**——原生迭代器持条目指针（Map/Set）或 nextIndex 指针（数组）：
 * - Map/Set：迭代期间**新增**的条目被访问、**删除**的条目被跳过；
 * - 数组：每次 next() 按**当前** LengthOfArrayLike(O) 判结束、按当前内容取值
 *   （push / unshift / shift 对迭代可见）。
 *
 * 修复前：手动迭代器是**创建时的快照** ⇒ 删除的条目仍被访问、新增的条目
 * 看不到、数组迭代器读到陈旧值（wrong-exact）。
 */
describe("Bug 198：手动迭代器是接收者的 live 视图", () => {
  it("Map.keys()：迭代期间删除条目 → 被删条目不再被访问（done 提前为 true）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.keys();
        it.next();
        m.delete("b");
        return it.next().done;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("Map.keys()：迭代期间新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m.keys();
        it.next();
        m.set("b", 2);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("Map.values()：迭代期间改写已有条目的值 → 读到新值（非陈旧值）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.values();
        it.next();
        m.set("b", 9);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("Map.entries()：迭代期间新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m.entries();
        it.next();
        m.set("b", 2);
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "b:2" });
  });

  it("Set.values()：迭代期间删除元素 → 被删元素不再被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const it = s.values();
        it.next();
        s.delete(2);
        return it.next().done;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("Set.entries()：迭代期间新增元素 → 新元素被追加访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const it = s.entries();
        it.next();
        s.add(2);
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "2:2" });
  });

  it("数组 entries()：迭代期间 shift() → 读到移位后的当前内容", () => {
    expect(
      val(`export function f() {
        const a = [1, 2, 3];
        const it = a.entries();
        it.next();
        a.shift();
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "1:3" });
  });

  it("数组 @@iterator()（= values）：迭代期间 unshift() → 读到移位后的当前内容", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a[Symbol.iterator]();
        it.next();
        a.unshift(0);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("数组 keys()：迭代期间 push() → 展开取到新增下标", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.keys();
        it.next();
        a.push(3);
        return [...it].join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("负控制：无变异时手动迭代器与快照一致", () => {
    expect(
      val(`export function f() { const m = new Map([["a",1],["b",2]]); const it = m.keys(); it.next(); return it.next().value; }`),
    ).toEqual({ ok: true, value: "b" });
    expect(
      val(`export function f() { const a = [1,2,3]; const it = a.entries(); return it.next().value.join(":"); }`),
    ).toEqual({ ok: true, value: "0:1" });
    expect(
      val(`export function f() { const a = [1,2,3]; return [...a.entries()].map((e) => e.join(":")).join(","); }`),
    ).toEqual({ ok: true, value: "0:1,1:2,2:3" });
  });

  it("负控制：迭代器对象仍不是数组（Array.isArray → false）", () => {
    expect(val(`export function f() { return Array.isArray([1,2,3].entries()); }`)).toEqual({
      ok: true,
      value: false,
    });
  });
});

/**
 * S17 收尾接线（Bug 198 根治点）：
 *
 * ① **投影同口径**：Map/Set 的 keys/values/entries 迭代器，`next().value`
 *    必须是**投影后**的值（Map 的键 / 值；Set 的 [el,el] 元组）——live 视图
 *    与快照路径走同一份 project 逻辑。此前 live 视图吐的是**未投影**的原始
 *    条目 ⇒ next().value 给原始条目（wrong-exact）。
 *
 * ② **live 迭代器不登记静态元素侧表**：静态表一旦登记，matchIterElements 会
 *    命中创建期快照 ⇒ 长度探针（sideIterLen）读到**冻结**的剩余长度 ⇒
 *    for-of 的迭代轮数停在创建时刻（迭代器不再随接收者变化）。
 *    修前：`it.next()` 后接收者新增条目 ⇒ for-of 只跑 1 轮（原生 2 轮）。
 */
describe("Bug 198（S17）：投影同口径 + live 迭代器不登记静态侧表", () => {
  it("① Map.keys() 的 next().value 是键（不是 [k,v] 条目元组）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        return m.keys().next().value;
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("① Map.values() 的 next().value 是值（不是条目元组）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        return m.values().next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("① Set.entries() 的 next().value 是 [el, el] 元组（不是元素本身）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        return s.entries().next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "1:1" });
  });

  it("① 投影在 live 路径上同样成立（迭代期间新增条目 → 新条目按投影给出）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m.values();
        it.next();
        m.set("b", 2);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const it = s.entries();
        it.next();
        s.add(2);
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "2:2" });
  });

  it("② for-of 走**当前剩余**：消费一条后接收者新增条目 ⇒ 新条目仍被访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.keys();
        it.next();
        m.set("c", 3);
        const out = [];
        for (const k of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "b,c" });
  });

  it("② for-of 走**当前剩余**：消费一条后接收者删除条目 ⇒ 被删条目被跳过", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.keys();
        it.next();
        m.delete("b");
        const out = [];
        for (const k of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("② Set 迭代器同口径：消费一条后接收者新增元素 ⇒ 新元素被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const it = s.values();
        it.next();
        s.add(3);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("负控制：静态快照视图不受影响（[...m.keys()] / [...s]）", () => {
    expect(val(`export function f() { const m = new Map([["a",1],["b",2]]); return [...m.keys()].join(","); }`)).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(val(`export function f() { const s = new Set([1,2]); return [...s].join(","); }`)).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("负控制：forEach 的 live 路径不受影响", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        m.forEach((v, k) => { out.push(k); m.set("b", 2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("负控制：用户迭代器协议（@@iterator）不受影响", () => {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x","y"][Symbol.iterator](); } };
        const out = [];
        for (const v of o) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x","y"][Symbol.iterator](); } };
        return [...o].join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
  });
});

/**
 * ① 的**根因**直测：直接调 `collectionIteratorFor`（集合迭代器的唯一构造
 * 入口），断言 live 视图的 `next().value` 已是**投影后**的值。
 *
 * 这条不走产品路径（产品路径此前被 dispatch.ts 的自建绕行版本遮住），是
 * 「live 视图与快照同口径投影」这条不变量的直钉——修前 live 视图吐的是
 * **未投影**的原始条目（Map 给 [k,v] 元组而不是键 / 值）。
 */
describe("Bug 198（S17）：collectionIteratorFor 的 live 视图与快照同口径投影", () => {
  /** 迭代器对象的 next().value（litValue 后的字面量值；tuple → 元素数组） */
  function nextValue(iter: Abs): unknown {
    const slots = (iter.shape as { slots: Record<string, { value: Abs }> }).slots;
    const next = getSlot(slots, "next")!.value;
    const impl = getFnImpl(next)!;
    const res = absOnly(impl.apply!([], iter));
    const rSlots = (res.shape as { slots: Record<string, { value: Abs }> }).slots;
    const v = getSlot(rSlots, "value")!.value;
    const sh = v.shape as { k: string; elements?: Abs[] };
    if (sh.k === "tuple" && sh.elements) {
      return sh.elements.map((e) => {
        const lv = litValue(e);
        return lv.ok ? lv.value : "<abs>";
      });
    }
    const lv = litValue(v);
    return lv.ok ? lv.value : "<abs>";
  }

  const mapAbs = (): Abs =>
    makeMapAbs(
      abs(
        {
          k: "tuple",
          elements: [
            abs({ k: "tuple", elements: [strLit("a"), numLit(1)] }, undefined, undefined, "exact"),
            abs({ k: "tuple", elements: [strLit("b"), numLit(2)] }, undefined, undefined, "exact"),
          ],
        },
        undefined,
        undefined,
        "exact",
      ),
    );

  const setAbs = (): Abs =>
    makeSetAbs(
      abs({ k: "tuple", elements: [numLit(1), numLit(2)] }, undefined, undefined, "exact"),
    );

  it("Map.keys()：live 视图给键（不是 [k,v] 条目元组）", () => {
    expect(nextValue(collectionIteratorFor(mapAbs(), "keys"))).toBe("a");
  });

  it("Map.values()：live 视图给值（不是条目元组）", () => {
    expect(nextValue(collectionIteratorFor(mapAbs(), "values"))).toBe(1);
  });

  it("Map.entries()：live 视图给条目元组", () => {
    const v = nextValue(collectionIteratorFor(mapAbs(), "entries"));
    expect(Array.isArray(v) ? v.join(":") : v).toBe("a:1");
  });

  it("Set.keys()/values()：live 视图给元素", () => {
    expect(nextValue(collectionIteratorFor(setAbs(), "values"))).toBe(1);
  });

  it("Set.entries()：live 视图给 [el, el] 元组（不是元素本身）", () => {
    const v = nextValue(collectionIteratorFor(setAbs(), "entries"));
    expect(Array.isArray(v) ? v.join(":") : v).toBe("1:1");
  });
});
