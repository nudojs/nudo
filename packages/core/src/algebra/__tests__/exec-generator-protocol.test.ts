/**
 * Bug 22（运行时内建建模）：生成器对象此前塌缩为 yield 值元组数组
 * （$gen → $arr(ys)）——无 next/return/throw 方法面、无 Generator 原型。
 * 原生：it.next() 按调用序返 {value, done}、typeof it.next === "function"、
 * g().constructor.name === ""（GeneratorFunction）、it.return(x) →
 * {value: x, done: true}、it.throw(e) → 抛 e。
 * 修复：$gen 返回带迭代器协议面的对象 Abs（next/return/throw 方法槽 +
 * constructor GeneratorFunction brand + @@iterator + 数字下标槽）；yield
 * 元素域经元素侧表保留——for-of / [...g()] / Array.from / yield* / 数组
 * 解构继续按序精确展开（迭代路径不回归）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatAbs } from "@nudojs/core";

function call(src: string, name: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, name, args);
}

function throwsName(r: { throws: { shape: { k: string; name?: string } } }): string | undefined {
  return r.throws.shape.k === "brand" ? r.throws.shape.name : undefined;
}

describe("Bug 22: generator object carries the iterator protocol face", () => {
  it("it.next().value → 1（字面量 yield 序列首调用）", () => {
    const r = call(
      `export function genNext() { function* g() { yield 1; } const it = g(); return it.next().value; }`,
      "genNext",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("typeof it.next / it.return / it.throw → 'function'", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); return typeof it.next + typeof it.return + typeof it.throw; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "functionfunctionfunction" });
  });

  it("g().constructor.name → ''（GeneratorFunction）", () => {
    const r = call(
      `export function genCtor() { function* g() { yield 1; } return g().constructor.name; }`,
      "genCtor",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  });

  it("耗尽后 next → {value: undefined, done: true}", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); it.next(); const n = it.next(); return n.done && n.value === undefined; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("多 yield 序列按调用序推进：1 → 2 → done", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; } const it = g(); const a = it.next().value; const b = it.next().value; const c = it.next().done; return [a, b, c]; }`,
      "f",
    );
    expect(formatAbs(r.result)).toContain("[1, 2, true]");
  });

  it("it.return(9) → {value: 9, done: true}；随后 next 保持 done", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); const r1 = it.return(9); const r2 = it.next(); return r1.value + (r1.done && r2.done ? 100 : 0); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 109 });
  });

  it("it.throw(e) → 抛出载荷（catch 可吸收）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } const it = g(); try { it.throw(new TypeError("boom")); return "no"; } catch (e) { return e.name; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it("for-of 不回归（迭代路径经元素侧表）", () => {
    const r = call(
      `export function genForOf() { function* g() { yield 1; yield 2; } let t = 0; for (const x of g()) t += x; return t; }`,
      "genForOf",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("展开 [...g()] 不回归（逐元素精确）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; } return [...g()].length; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("Array.from(g()) 不回归（元素并入 arr 域——同修复前 tuple 路径口径）", () => {
    const r = call(
      `export function f() { function* g() { yield 5; yield 6; } return Array.from(g()).reduce((a, b) => a + b, 0); }`,
      "f",
    );
    // Array.from 消费的是元素（5|6 域），不是生成器对象本身
    expect(formatAbs(r.result)).toContain("5");
    expect(formatAbs(r.result)).toContain("6");
  });

  it("数组解构 const [a, b] = g() 不回归", () => {
    const r = call(
      `export function f() { function* g() { yield 4; yield 5; } const [a, b] = g(); return a + b; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("rest 解构 const [a, ...rest] = g() 不回归", () => {
    const r = call(
      `export function f() { function* g() { yield 4; yield 5; yield 6; } const [a, ...rest] = g(); return a + rest.length; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("yield* 委托生成器不回归（元素逐个压入）", () => {
    const r = call(
      `export function f() { function* inner() { yield 1; yield 2; } function* outer() { yield* inner(); yield 3; } let t = 0; for (const v of outer()) t += v; return t; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });

  it("async 生成器 for-await 不回归（现状保持：元素精确、外层 promise）", () => {
    const r = call(
      `export async function f() { async function* g() { yield 1; yield 2; } let t = 0; for await (const v of g()) t += v; return t; }`,
      "f",
    );
    // async 函数面：for-await 元素域精确（3），外层折 promise（现状口径）
    expect(formatAbs(r.result)).toContain("promise<3>");
  });

  it("生成器方法（class/对象方法）同样获得协议面", () => {
    const r = call(
      `export function f() { const o = { *m() { yield 7; } }; return o.m().next().value; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("数字下标读（历史口径）继续可读 yield 值", () => {
    const r = call(
      `export function f() { function* g() { yield 1; yield 2; yield 3; } const xs = g(); return xs[0] + xs[1] + xs[2]; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });
});
