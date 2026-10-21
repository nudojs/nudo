/**
 * Bug 218 回归：number / boolean / bigint **原始值**读不存在的成员 →
 * 原生 undefined（不是 unknown），且**后续读该值**记 may-throw TypeError。
 *
 * ES 语义：原始值的属性访问走 `ToObject(v)` 后的 [[Get]]——原型链上没有
 * 该键 → undefined（不抛）。`5..foo` → undefined；`5..foo.bar` → 读
 * undefined 的成员 → TypeError（undefined/null 的 [[Get]] 必抛）。
 *
 * 修复前：这类 prim 无「确定缺失」臂 → 一路落尾部 unknown 接收者分支：
 * 既折了错值（unknown 而非 undefined），又**丢掉 may-throw**（unknown 接收者
 * 不记 throws）⇒ `n.foo.bar` 不记 TypeError ⇒ **L2 门禁假绿**（引擎声称
 * 「保证不抛」，原生确定抛）。
 *
 * 不变量（负控制钉住）：
 * - string prim 早有同款语义（不回归）；
 * - prim 自己的原型方法照常可读可调（toFixed / toString …）；
 * - Object.prototype 继承名（toString / valueOf / hasOwnProperty）不是
 *   「确定缺失」；
 * - 对象（obj）面的缺失成员读语义不受影响。
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

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 218 — prim 读不存在的成员 → undefined（不是 unknown）", () => {
  it("(5).foo → undefined", () => {
    expect(v(wrap(`const n = 5; return n.foo;`))).toEqual({ ok: true, value: undefined });
  });

  it("(true).foo → undefined", () => {
    expect(v(wrap(`const b = true; return b.foo;`))).toEqual({ ok: true, value: undefined });
  });

  it("(1n).foo → undefined", () => {
    expect(v(wrap(`const g = 1n; return g.foo;`))).toEqual({ ok: true, value: undefined });
  });

  it("对象属性读出的 number 读缺失成员 → undefined", () => {
    expect(v(wrap(`const o = {a:1}; return o.a.b;`))).toEqual({ ok: true, value: undefined });
  });
});

describe("Bug 218 — 后续读该值记 may-throw TypeError（L2 门禁不再假绿）", () => {
  it("(5).foo.bar → TypeError", () => {
    expect(throwName(wrap(`const n = 5; return n.foo.bar;`))).toBe("TypeError");
  });

  it("(true).foo.bar → TypeError", () => {
    expect(throwName(wrap(`const b = true; return b.foo.bar;`))).toBe("TypeError");
  });

  it("(1n).foo.bar → TypeError", () => {
    expect(throwName(wrap(`const g = 1n; return g.foo.bar;`))).toBe("TypeError");
  });

  it("o.a.b.c（o.a 是 number）→ TypeError", () => {
    expect(throwName(wrap(`const o = {a:1}; return o.a.b.c;`))).toBe("TypeError");
  });

  it("string prim 同款（既有语义，不回归）", () => {
    expect(throwName(wrap(`const s = "ab"; return s.foo.bar;`))).toBe("TypeError");
  });
});

describe("Bug 218 — 负控制：prim 原型方法 / 继承名 / 对象面不回归", () => {
  it("(5).toFixed(2) → \"5.00\"（prim 自有原型方法）", () => {
    expect(v(wrap(`const n = 5; return n.toFixed(2);`))).toEqual({ ok: true, value: "5.00" });
  });

  it("typeof (5).toString → \"function\"（Object.prototype 继承名）", () => {
    expect(v(wrap(`const n = 5; return typeof n.toString;`))).toEqual({ ok: true, value: "function" });
  });

  it("(5).valueOf() → 5（继承名仍走调用面）", () => {
    expect(v(wrap(`const n = 5; return n.valueOf();`))).toEqual({ ok: true, value: 5 });
  });

  it("(5).constructor.name → \"Number\"（constructor 不是「确定缺失」）", () => {
    expect(v(wrap(`const n = 5; return n.constructor.name;`))).toEqual({ ok: true, value: "Number" });
  });

  it("对象面缺失成员读 → undefined（既有语义）", () => {
    expect(v(wrap(`const o = {a:1}; return o.zzz;`))).toEqual({ ok: true, value: undefined });
  });

  it("对象面缺失成员的后续读仍记 TypeError（既有语义）", () => {
    expect(throwName(wrap(`const o = {a:1}; return o.zzz.yy;`))).toBe("TypeError");
  });

  it("数组面不受影响（arr[0] 命中）", () => {
    expect(v(wrap(`const a = [1,2]; return a[0];`))).toEqual({ ok: true, value: 1 });
  });
});
