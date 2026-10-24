/**
 * Bug 140 回归：数组解构对**用户 iterable**（对象带自有 `@@iterator` 方法）
 * 必须按迭代序取元素（GetIterator + IteratorNext），**不得**按索引读。
 *
 * 修复前：解构 lowering 一律 `$idx(recv, i)`（按索引属性读）——用户 iterable
 * 没有索引槽 ⇒ 折出**确定 undefined**（精确错值；原生是迭代序的第 2 个值）。
 * 修复后（用户迭代器协议）：`exec/runtime/containers/iterate.ts` 的
 * `$iterCheck` 兼做两件事——①可迭代性守卫；②返回**迭代序元素读取器**
 * （`get(i)` / `rest(i)`），生成码（`exec/transpile/emit.ts`）按需取元素。
 * 元素域与原生**逐值一致**（不再是 sound 的 unknown 折）。
 *
 * 副产物回归：`noBody` 必须是**全局唯一**占位 body 单例——否则
 * 「占位 fn 判据」（按身份比较）跨模块失配 ⇒ 引擎原生迭代器
 * （`abstractSeqIteratorAbs`）的 `@@iterator` 占位被误判为「真实现」⇒
 * 跑用户协议调占位 fn ⇒ `[...Array.from('ab').keys()]` **假抛** TypeError。
 *
 * 负控制：内建可迭代体（tuple / 字符串 / Set / Map）的解构**不受影响**
 * （仍是精确值）；`any` 接收者仍保持 any 面；非可迭代接收者仍抛 TypeError。
 */
import { describe, it, expect } from "vitest";
import { call, val, isNever, throwsError } from "./eval-helpers.ts";
import { formatAbs } from "../format.ts";
import { anyAbs } from "../abs.ts";

/** 用户 iterable：对象带自有 @@iterator 方法（原生按迭代序产 1,2,3…） */
const USER_ITER = `const it = { [Symbol.iterator]() { let i = 0; return { next: () => (i < 3 ? { value: ++i, done: false } : { done: true }) }; } };`;

describe("Bug 140：数组解构对用户 iterable 按迭代序（不按索引）", () => {
  it("单元素解构：值面 = 迭代序第 1 个值（原生 1，此前折确定 undefined）", () => {
    expect(val(`export function f() { ${USER_ITER} const [a] = it; return a; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("多元素解构：第 1 位 = 迭代序第 1 个值", () => {
    expect(
      val(`export function f() { ${USER_ITER} const [a, b] = it; return a; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("多元素解构：第 2 位 = 迭代序第 2 个值（原生 2，此前折确定 undefined）", () => {
    expect(
      val(`export function f() { ${USER_ITER} const [a, b] = it; return b; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("赋值形态（[p, q] = it）同样按迭代序", () => {
    expect(
      val(`export function f() { ${USER_ITER} let p, q; [p, q] = it; return q; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("形参位解构（function h([a, b]) {…} h(userIter)）同样按迭代序", () => {
    expect(
      val(
        `export function f() { const g = { [Symbol.iterator]: function() { return [1, 2][Symbol.iterator](); } }; function h([a, b]) { return b; } return h(g); }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("用户**迭代器**对象（自带 next + @@iterator）按迭代序取值", () => {
    expect(
      val(
        `export function f() { const it = { i: 0, next() { return this.i < 2 ? { value: "n" + (++this.i), done: false } : { done: true }; }, [Symbol.iterator]() { return this; } }; const [a, b] = it; return a + b; }`,
      ),
    ).toEqual({ ok: true, value: "n1n2" });
  });

  it("副产物：引擎原生迭代器不被误判为用户 iterable（spread 不假抛）", () => {
    // 原生：[...Array.from('ab').keys()] → [0,1]（不抛）
    const r = call(`export function f() { return [...Array.from('ab').keys()]; }`);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    // for-of 同口径
    const r2 = call(
      `export function f() { const it = Array.from('ab').keys(); for (const x of it) return x; return 'none'; }`,
    );
    expect(isNever(r2.result)).toBe(false);
    expect(throwsError(r2.throws, "TypeError")).toBe(false);
  });

  it("负控制：内建可迭代体（tuple / 字符串 / Set / Map）解构仍是精确值", () => {
    expect(val(`export function f() { const [a, b] = [1, 2]; return a + b; }`)).toEqual({
      ok: true,
      value: 3,
    });
    expect(val(`export function f() { const [a, b] = "xy"; return a + b; }`)).toEqual({
      ok: true,
      value: "xy",
    });
    expect(val(`export function f() { const [a, b] = new Set([1, 2]); return a + b; }`)).toEqual({
      ok: true,
      value: 3,
    });
    expect(
      val(`export function f() { const [a] = new Map([["k", 1]]); return a[1]; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：any 接收者仍保持 any 面（探针不过度命中）", () => {
    const r = call(`export function f(x) { const [y] = x; return y; }`, "f", [anyAbs]);
    expect(formatAbs(r.result)).toContain("any");
  });

  it("负控制：非可迭代接收者仍抛 TypeError（守卫不被绕过）", () => {
    const r = call(`export function f() { const [x] = 1; return x; }`);
    expect(formatAbs(r.throws as never)).toContain("TypeError");
  });

  it("负控制：生成器对象 / 集合迭代器（引擎自有元素模型）不被探针误伤", () => {
    expect(
      val(`export function f() { function* g() { yield 4; yield 5; } const [a, b] = g(); return a + b; }`),
    ).toEqual({ ok: true, value: 9 });
    expect(
      val(`export function f() { const [a, b] = [1, 2].entries(); return a[0] + b[1]; }`),
    ).toEqual({ ok: true, value: 2 });
  });
});
