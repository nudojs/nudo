/**
 * Bug 187 回归：可选「调用」`o.b?.()` 命中 nullish 时必须**整链**短路。
 *
 * ES 语义：`o.b?.().c` 里 `o.b` 为 nullish ⇒ **整条链**求值为 undefined，
 * 后续的 `.c` 不得再求值、不得抛（`o.b` 非 nullish 时才调用并继续 `.c`）。
 *
 * 修复前：调用跳（invoke / invokeKey hop）的 nullish 短路臂只发
 * `$lit(void 0)`，**剩余链留在 fork 之外** ⇒ `undefined.c` 记定抛 TypeError
 * （`nudo check` 门禁假红：entry-may-throw / `property 'c' on undefined`）。
 * 成员跳（`o.b?.c`）一直是整链短路（shortCircuitHop 把剩余链放进短路臂），
 * 本次修复让调用跳与成员跳同口径。
 *
 * 不变量（负控制钉住）：非 nullish 链仍正常求值；调用跳**无尾随成员**时
 * 发射形态不变；真正该抛的 TypeError（调用结果为 null 时的 `.c`）不被吞。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

/** 整链短路：不得抛，且结果必须是精确 undefined */
function expectChainUndefined(src: string) {
  expect(throwName(src), `throws for: ${src}`).toBe("");
  expect(v(src), `result for: ${src}`).toEqual({ ok: true, value: undefined });
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 187 — 可选调用命中 nullish 时整链短路（剩余成员读不再求值）", () => {
  it("o.b?.().c on {b:null} → undefined（不抛）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c;`));
  });

  it("o.b?.().c on {b:undefined} → undefined", () => {
    expectChainUndefined(wrap(`const o = { b: undefined }; return o.b?.().c;`));
  });

  it("o.b?.().c on {}（b 缺失） → undefined", () => {
    expectChainUndefined(wrap(`const o = {}; return o.b?.().c;`));
  });

  it("o.b?.()['c'] on {b:null} → undefined（计算成员读同口径）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.()["c"];`));
  });

  it("o.b?.().c.d on {b:null} → undefined（多级尾随读）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c.d;`));
  });

  it("o.b?.().c?.d on {b:null} → undefined（尾随链自身可选）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c?.d;`));
  });

  it("o?.m?.().c on {}（m 缺失） → undefined（接收者+方法双可选）", () => {
    expectChainUndefined(wrap(`const o = {}; return o?.m?.().c;`));
  });

  it("o[k]?.().c on {b:null} → undefined（invokeKey hop 同款）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; const k = "b"; return o[k]?.().c;`));
  });

  it("o?.[k]?.().c on {} → undefined（invokeKey + 接收者可选）", () => {
    expectChainUndefined(wrap(`const o = {}; const k = "b"; return o?.[k]?.().c;`));
  });

  it("o.b?.()() on {b:null} → undefined（尾随调用同属链，ES 同口径）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.()();`));
  });

  it("o.b?.().c() on {b:null} → undefined（尾随成员读 + 调用）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.().c();`));
  });

  it("o.b?.()[0] on {b:null} → undefined（尾随下标读）", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.()[0];`));
  });
});

describe("Bug 187 — 负控制：非 nullish 链仍正常求值 / 既有 hop 语义不回归", () => {
  it("o.b?.().c on 函数 b → 读到 c", () => {
    expect(v(wrap(`const o = { b: () => ({ c: 9 }) }; return o.b?.().c;`))).toEqual({ ok: true, value: 9 });
  });

  it("o.b?.().c 方法体 this 仍绑 o", () => {
    expect(v(wrap(`const o = { v: 3, b() { return { c: this.v }; } }; return o.b?.().c;`))).toEqual({ ok: true, value: 3 });
  });

  it("o.b?.().c on 函数 b 返回 {c:{d:8}} → 多级读通", () => {
    expect(v(wrap(`const o = { b: () => ({ c: { d: 8 } }) }; return o.b?.().c.d;`))).toEqual({ ok: true, value: 8 });
  });

  it("o?.m?.().c on {m:()=>({c:4})} → 读到 c", () => {
    expect(v(wrap(`const o = { m: () => ({ c: 4 }) }; return o?.m?.().c;`))).toEqual({ ok: true, value: 4 });
  });

  it("o[k]?.().c on {b:()=>({c:5})} → 读到 c", () => {
    expect(v(wrap(`const o = { b: () => ({ c: 5 }) }; const k = "b"; return o[k]?.().c;`))).toEqual({ ok: true, value: 5 });
  });

  it("调用跳无尾随成员：o.b?.() on {b:null} → undefined", () => {
    expectChainUndefined(wrap(`const o = { b: null }; return o.b?.();`));
  });

  it("调用跳无尾随成员：o.b?.() 仍调用方法", () => {
    expect(v(wrap(`const o = { b: () => 1 }; return o.b?.();`))).toEqual({ ok: true, value: 1 });
  });

  it("成员跳既有语义：o?.b.c on null → undefined", () => {
    expectChainUndefined(wrap(`const o = null; return o?.b.c;`));
  });

  it("成员跳既有语义：o?.b.c on {b:{c:1}} → 1", () => {
    expect(v(wrap(`const o = { b: { c: 1 } }; return o?.b.c;`))).toEqual({ ok: true, value: 1 });
  });

  it("接收者可选的调用跳既有语义：o?.m() on null → undefined", () => {
    expectChainUndefined(wrap(`const o = null; return o?.m();`));
  });

  it("接收者可选的调用跳既有语义：o?.m() this 仍绑 o", () => {
    expect(v(wrap(`const o = { v: 5, m() { return this.v; } }; return o?.m();`))).toEqual({ ok: true, value: 5 });
  });

  it("真正该抛的 TypeError 不被吞：调用结果为 null 时的 .c", () => {
    expect(throwName(wrap(`const o = { b: () => null }; return o.b?.().c;`))).toBe("TypeError");
  });

  it("调用结果为 {c:null} → 值 null（不是抛）", () => {
    expect(v(wrap(`const o = { b: () => ({ c: null }) }; return o.b?.().c;`))).toEqual({ ok: true, value: null });
  });

  it("真正该抛的 TypeError 不被吞：o?.b().c 且 b 非函数", () => {
    expect(throwName(wrap(`const o = { b: null }; return o?.b().c;`))).toBe("TypeError");
  });
});
