// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): eval-bug-198-s20-residual-live-iter.test.ts + eval-bug-198-collection-live-iter.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { val, call, isNever } from "./eval-helpers.ts";
import { abs, strLit, numLit, litValue, type Abs } from "../abs.ts";
import { getSlot } from "../objects.ts";
import { getFnImpl, absOnly } from "../abs-fn.ts";
import { makeMapAbs, makeSetAbs } from "../collections.ts";
import { collectionIteratorFor } from "../builtins/error/iterator.ts";

describe("[merged] eval-bug-198-s20-residual-live-iter.test.ts", () => {
/**
 * Bug 198 残留修补（S20）回归：live 迭代器的**元素面 / 长度 / @@iterator 读值**
 * 三条口径必须与原生一致。
 *
 * 1. **$arrRest 的「侧表迭代物」门**（iterate.ts）：S17 把 live 集合迭代器的
 *    **静态侧表**去掉后（静态表 = 创建期拷贝，会把元素面与长度冻结在创建
 *    时刻），`$arrRest` 只查静态侧表 ⇒ live 迭代物**不被认成迭代物** ⇒
 *    `const [x, ...rest] = m.keys()` 的 rest 退 `<abs:unknown>`（精度回退）。
 *    门改为「静态侧表 **或** 消费视图」。
 * 2. **数组迭代器的静态侧表陈旧**（invoke-arr.ts）：数组迭代器**显式**登记了
 *    一面「与 live 同步的剩余元素镜像」⇒ 长度探针（sideIterLen）读到**陈旧**
 *    的剩余长度 ⇒ for-of 轮数停在创建时刻（`a.values(); a.push(3)` 后原生再跑
 *    2 轮，引擎只跑 1 轮）。静态侧表整体删除，元素面交给 live 消费视图。
 * 3. **Map/Set 原型的 @@iterator 臂**（member.ts）：`@@iterator` 臂直接吃
 *    **快照**（mapEntriesAbs / setElementsAbs）⇒ 迭代期间的增删不可见；且
 *    `m[Symbol.iterator]` 直读折成 **no-op fn** ⇒ 调用折 `<abs:never>`
 *    （**自信的错值**——原生返回集合迭代器）。
 *
 * 负控制：生成器 rest 解构、普通数组 rest 解构、静态快照语义（`[...m.keys()]`
 * 在改动前后都取当前条目表）不受影响。
 */



describe("S20-①：$arrRest 的「侧表迭代物」门认消费视图（live 集合迭代器）", () => {
  it("Map.keys() 的 rest 解构 → 取剩余键（原生 \"b\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [x, ...rest] = m.keys();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("Map.values() 的 rest 解构 → 取剩余值（原生 \"2\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [x, ...rest] = m.values();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("Map.entries() 的 rest 解构 → 取剩余条目元组（原生 \"b:2\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [x, ...rest] = m.entries();
        return rest.map((e) => e.join(":")).join(",");
      }`),
    ).toEqual({ ok: true, value: "b:2" });
  });

  it("Set.values() 的 rest 解构 → 取剩余元素（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2, 3]);
        const [x, ...rest] = s.values();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("负控制：生成器 rest 解构不受影响（原生 \"2\"）", () => {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const [x, ...rest] = g();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("负控制：普通数组 rest 解构不受影响（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2, 3];
        const [x, ...rest] = a;
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });
});

describe("S20-②：数组迭代器不登记静态侧表（剩余长度是 live 的）", () => {
  it("values() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.values();
        it.next();
        a.push(3);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("values() 迭代器：push 之后的展开取剩余（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.values();
        it.next();
        a.push(3);
        return [...it].join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("keys() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 \"1,2\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.keys();
        it.next();
        a.push(3);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("entries() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 \"1:2,2:3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.entries();
        it.next();
        a.push(3);
        const out = [];
        for (const v of it) out.push(v.map(String).join(":"));
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1:2,2:3" });
  });

  it("负控制：未变更的数组迭代器 for-of 不受影响（原生 \"1,2\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.values();
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });
});

describe("S20-③：Map/Set 的 @@iterator 是原型上的同一个函数对象", () => {
  it("m[Symbol.iterator]() → 集合迭代器（原生 \"a:1\"，修复前折 never）", () => {
    const r = call(`export function f() {
      const m = new Map([["a", 1]]);
      const it = m[Symbol.iterator]();
      return it.next().value.join(":");
    }`);
    expect(isNever(r.result)).toBe(false);
    expect(val(`export function f() {
      const m = new Map([["a", 1]]);
      const it = m[Symbol.iterator]();
      return it.next().value.join(":");
    }`)).toEqual({ ok: true, value: "a:1" });
  });

  it("s[Symbol.iterator]() → 元素迭代器（原生 1，非 [el,el]）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const it = s[Symbol.iterator]();
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("借调 Map.prototype[Symbol.iterator].call(m) → 集合迭代器（原生 \"a:1\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        return Map.prototype[Symbol.iterator].call(m).next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "a:1" });
  });

  it("借调 Set.prototype[Symbol.iterator].call(s) → 元素迭代器（原生 1）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        return Set.prototype[Symbol.iterator].call(s).next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("m[Symbol.iterator] 是函数（原生 \"function\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        return typeof m[Symbol.iterator];
      }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("for-of 走 m[Symbol.iterator]() → 逐条目（原生 \"a=1\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        for (const [k, v] of m[Symbol.iterator]()) out.push(k + "=" + v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a=1" });
  });

  it("m[Symbol.iterator]() 是 live 迭代器：迭代期间的 set 可见（原生 \"a,b\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m[Symbol.iterator]();
        m.set("b", 2);
        const out = [];
        for (const [k] of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("借调 Map.prototype[Symbol.iterator].call(m) 是 live 迭代器（原生 \"a,b\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = Map.prototype[Symbol.iterator].call(m);
        m.set("b", 2);
        const out = [];
        for (const [k] of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("s[Symbol.iterator]() 是 live 迭代器：迭代期间的 add 可见（原生 \"1,2\"）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const it = s[Symbol.iterator]();
        s.add(2);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("负控制：m.entries() / m.keys() / m.values() 不受影响", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        return [m.entries().next().value.join(":"), m.keys().next().value, m.values().next().value].join("|");
      }`),
    ).toEqual({ ok: true, value: "a:1|a|1" });
  });
});
});

describe("[merged] eval-bug-198-collection-live-iter.test.ts", () => {
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
});
