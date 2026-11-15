/**
 * Bug 449 回归：`String.prototype.matchAll(<非 RegExp 实参>)` **不得**折**确定**
 * TypeError（FALSE-THROW）。
 *
 * 原生语义（ES2023 String.prototype.matchAll，node v26.10.0 逐字实测）：
 * - 实参**确定是 RegExp**（IsRegExp(pattern) 为 true）⇒ 取其 flags；flags 确定
 *   不含 "g" ⇒ **确定 TypeError**（"String.prototype.matchAll argument must not
 *   be a non-global regular expression"）。
 * - 实参**确定不是 RegExp** ⇒ matcher = RegExpCreate(ToString(pattern), "g")
 *   （**"g" 由算法自补**）⇒ 返回**迭代器**；模式非法 ⇒ SyntaxError。
 *   ⇒ "abc".matchAll("b") / matchAll(1) / matchAll() / matchAll(null) 全部
 *   **正常返回迭代器**（原生实测命中数 1 / 1 / 4 / 0，见各断言注释）。
 *
 * 改前（缺陷链闭合）：
 * - class-regex.ts 的 matchAll 尾段：非 brand pattern ⇒ `return undefined`
 *   （"本臂不接管"哨兵）⇒ 回落 methods.ts 的抽象臂；
 * - methods.ts 的 matchAllAbstractArm：把「无 g 旗标 ⇒ TypeError」从「实参
 *   **确定是 RegExp**」错误推广到**所有非 RegExp 实参** ⇒ `definiteNonRegExp`
 *   **硬抛 TypeError**；
 * ⇒ 结果：shape.k=never + throws=brand:TypeError（假抛 ⇒ L2 entry-may-throw
 *   假红，且真实返回的迭代器被折成「永不返回」）。
 *
 * 改后：
 * - class-regex.ts（字面量接收者 + 字面量 pattern）⇒ new RegExp(strPat, "g")
 *   **真迭代** ⇒ RegExpMatchIterator（元素 = **RegExpExecArray 匹配数组**，
 *   不是字符串）；strPat 编译失败 ⇒ **确定 SyntaxError**（不回落哨兵）。
 * - methods.ts（抽象接收者 / 抽象 pattern）⇒ **迭代器**（元素域保守 unknown，
 *   协议面齐），**不抛** TypeError；RegExp brand 无 g 的定抛**保留**。
 *
 * ⚠ 协议面（迭代器协议：next / @@iterator / @@toStringTag）与元素域（匹配
 * 数组）**分列**：前者由 matchIteratorAbs 保证，后者由 matchResultAbs 保证。
 */
import { describe, it, expect } from "vitest";
import { abs, litValue, type Abs } from "@nudojs/core";
import { call, val, isNever, throwsError } from "./eval-helpers.ts";

/** 抽象 string 实参（抽象接收者臂用） */
const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");

/** 调用结果的字面量值（litValue 快捷） */
function v(src: string, args: Abs[] = []): unknown {
  const r = litValue(call(src, "f", args).result);
  return r.ok ? r.value : undefined;
}

describe("Bug 449: matchAll(<非 RegExp>) → RegExpCreate(ToString(pattern), \"g\") 迭代器", () => {
  it("字符串 pattern → 迭代器（原生 \"abc\".matchAll(\"b\") 命中 1）", () => {
    const r = call(`export function f() { return [... "abc".matchAll("b")].length; }`);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("迭代项是**匹配数组**（RegExpExecArray），不是字符串（原生 m[0]/index/input）", () => {
    // 原生："abc".matchAll("b") → [["b", 1, "abc"]]
    expect(
      v(`export function f() { const m = [... "abc".matchAll("b")][0]; return m[0] + ":" + m.index + ":" + m.input; }`),
    ).toBe("b:1:abc");
  });

  it("缺省实参 → 空 pattern（原生 \"abc\".matchAll() 命中 4）", () => {
    expect(val(`export function f() { return [... "abc".matchAll()].length; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("显式 undefined → 空 pattern（原生命中 4）", () => {
    expect(val(`export function f() { return [... "abc".matchAll(undefined)].length; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("数字 pattern → ToString(1)（原生 \"a1b\".matchAll(1) 命中 1，index=1）", () => {
    expect(
      v(`export function f() { const m = [... "a1b".matchAll(1)][0]; return m[0] + ":" + m.index; }`),
    ).toBe("1:1");
  });

  it("null → ToString(null)=\"null\"（原生 \"abc\".matchAll(null) 命中 0，**不抛**）", () => {
    const r = call(`export function f() { return [... "abc".matchAll(null)].length; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("布尔 / 小数 pattern → ToString 折叠（原生命中 0，**不抛**）", () => {
    expect(val(`export function f() { return [... "abc".matchAll(true)].length; }`)).toEqual({
      ok: true,
      value: 0,
    });
    expect(val(`export function f() { return [... "abc".matchAll(1.5)].length; }`)).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("非法 pattern → **确定 SyntaxError**（不回落「本臂不接管」哨兵）", () => {
    const r = call(`export function f() { return "abc".matchAll("("); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("symbol pattern → 确定 TypeError（ToString(symbol) 抛，原生同款）", () => {
    const r = call(`export function f() { return "abc".matchAll(Symbol("x")); }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("负控制：RegExp 实参确定无 g → **仍**确定 TypeError（原生同款）", () => {
    const r = call(`export function f() { return "abc".matchAll(/b/); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("负控制：RegExp 实参带 g → 迭代器，命中 1（原生同款）", () => {
    expect(val(`export function f() { return [... "abc".matchAll(/b/g)].length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("协议面：typeof → object；next() → {value,done}；@@iterator 返自身", () => {
    expect(val(`export function f() { return typeof "abc".matchAll("b"); }`)).toEqual({
      ok: true,
      value: "object",
    });
    expect(val(`export function f() { return "abc".matchAll("b").next().done; }`)).toEqual({
      ok: true,
      value: false,
    });
    expect(
      val(`export function f() { const it = "abc".matchAll("b"); return it[Symbol.iterator]() === it; }`),
    ).toEqual({ ok: true, value: true });
  });

  it("协议面：next().value 是匹配数组（原生 RegExpExecArray）", () => {
    expect(val(`export function f() { return "abc".matchAll("b").next().value[0]; }`)).toEqual({
      ok: true,
      value: "b",
    });
  });
});

describe("Bug 449: 抽象接收者的 matchAll 抽象臂（methods.ts matchAllAbstractArm）", () => {
  it("抽象 string 接收者 + 字符串 pattern → 迭代器（**不抛** TypeError）", () => {
    const r = call(`export function f(s) { return s.matchAll("b"); }`, "f", [strAbs]);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    const shape = (r.result as { shape?: { k?: string; name?: string } }).shape;
    expect(shape?.k).toBe("brand");
    expect(shape?.name).toBe("RegExpMatchIterator");
  });

  it("抽象 string 接收者 + 缺省实参 → 迭代器（**不抛** TypeError）", () => {
    const r = call(`export function f(s) { return s.matchAll(); }`, "f", [strAbs]);
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("负控制：抽象接收者 + RegExp 无 g → **仍**确定 TypeError（既有行为不变）", () => {
    const r = call(`export function f(s) { return s.matchAll(/a/); }`, "f", [strAbs]);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
