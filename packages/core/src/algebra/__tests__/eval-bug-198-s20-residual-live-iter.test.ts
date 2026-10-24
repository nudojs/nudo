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
import { describe, it, expect } from "vitest";
import { val, call, isNever } from "./eval-helpers.ts";

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
