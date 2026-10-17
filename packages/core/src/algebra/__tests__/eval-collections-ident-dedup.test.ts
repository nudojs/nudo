/**
 * Bug 88 回归：Set/Map 非字面量（对象 / any 绑定）键此前永不去重——
 * `new Set([k, k]).size` / `s.add(x); s.add(x)` / `new Map([[k,1],[k,2]])`
 * 折错 exact 条数。修复：条目表加身份通道（collections.ts identKeyOf /
 * refIdentKeyOf——引用语义键进 Map 身份通道与精确 miss 折叠，绑定级键
 * （非单例 any/unknown）只用于同绑定去重；域共享 / 全局单例 / 抽象 prim
 * 域不入通道）。断言锚定原生语义（node 实测），不锚定引擎现状。
 */
import { describe, it, expect } from "vitest";
import { call, val } from "./eval-helpers.ts";
import { abs, type Abs } from "../abs.ts";

/** 逐调用铸造（镜像 check.ts 逐形参 any——不复用共享单例） */
function anyArg(): Abs {
  return abs({ k: "any" }, undefined, undefined, "path");
}
function objArg(): Abs {
  return abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
}
function boolArg(): Abs {
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "path");
}

describe("Bug 88：Set 非字面量键 SameValueZero 去重", () => {
  it("new Set([k, k]).size === 1（exact）", () => {
    const r = call(`export function f() { const k = {}; return new Set([k, k]).size; }`);
    expect(val(`export function f() { const k = {}; return new Set([k, k]).size; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(r.result.conf).toBe("exact");
  });

  it("s.add(k); s.add(k); size === 1（exact）", () => {
    const r = call(
      `export function f() { const k = {}; const s = new Set(); s.add(k); s.add(k); return s.size; }`,
    );
    expect(r.result).toMatchObject({ conf: "exact" });
    expect(val(`export function f() { const k = {}; const s = new Set(); s.add(k); s.add(k); return s.size; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("s.add(k); s.add(k); [...s].length === 1", () => {
    expect(
      val(`export function f() { const k = {}; const s = new Set(); s.add(k); s.add(k); return [...s].length; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("new Set([k, 1, k]).size === 2（字面量 + 对象混合）", () => {
    expect(val(`export function f() { const k = {}; return new Set([k, 1, k]).size; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("new Set([...new Set([k, k])]).size === 1（拷贝构造再去重）", () => {
    expect(val(`export function f() { const k = {}; return new Set([...new Set([k, k])]).size; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("any 形参双 add 去重（check 入口面：同一绑定同一值）", () => {
    const r = call(
      `export function f(x) { const s = new Set(); s.add(x); s.add(x); return s.size; }`,
      "f",
      [anyArg()],
    );
    expect(r.result).toMatchObject({ conf: "exact" });
    expect(r.result.term).toEqual({ op: "lit", value: 1 });
  });

  it("同一 symbol 双 add 去重；两个独立 Symbol() 不去重", () => {
    expect(
      val(`export function f() { const sym = Symbol("s"); const s = new Set(); s.add(sym); s.add(sym); return s.size; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const s = new Set(); s.add(Symbol("a")); s.add(Symbol("a")); return s.size; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("s.has(k) 同引用 exact true / 异引用 exact false", () => {
    expect(
      val(`export function f() { const k = {}; const s = new Set(); s.add(k); return s.has(k); }`),
    ).toEqual({ ok: true, value: true });
    const miss = call(
      `export function f() { const k = {}; const j = {}; const s = new Set(); s.add(k); return s.has(j); }`,
    );
    expect(miss.result).toMatchObject({ conf: "exact" });
    expect(miss.result.term).toEqual({ op: "lit", value: false });
  });

  it("s.delete(k) 精确：删除后 size 0、has(k) exact false；异引用 delete 不影响", () => {
    expect(
      val(`export function f() { const k = {}; const s = new Set(); s.add(k); s.delete(k); return s.size; }`),
    ).toEqual({ ok: true, value: 0 });
    expect(
      val(`export function f() { const k = {}; const s = new Set(); s.add(k); s.delete(k); return s.has(k); }`),
    ).toEqual({ ok: true, value: false });
    expect(
      val(`export function f() { const k = {}; const s = new Set(); s.add(k); return s.delete(k); }`),
    ).toEqual({ ok: true, value: true });
    expect(
      val(`export function f() { const k = {}; const j = {}; const s = new Set(); s.add(k); s.delete(j); return s.size; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const k = {}; const j = {}; const s = new Set(); s.add(k); s.delete(j); return s.has(k); }`),
    ).toEqual({ ok: true, value: true });
  });

  it("controls：字面量 / NaN / 两个不同对象字面量", () => {
    expect(val(`export function f() { return new Set([1, 1, 2]).size; }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return new Set(["a", "a", "b"]).size; }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { return new Set([NaN, NaN]).size; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { return new Set([{}, {}]).size; }`)).toEqual({ ok: true, value: 2 });
  });

  it("健全性：抽象元素在场时 s.has(字面量) 不得折 exact false", () => {
    const r = call(
      `export function f(x) { const s = new Set(); s.add(x); return s.has("a"); }`,
      "f",
      [anyArg()],
    );
    // 原生 x 可能就是 "a" —— exact false 是错误定值
    expect(r.result.conf).not.toBe("exact");
  });

  it("健全性：条件 add 的身份元素 membership 不确定 → size 不折 exact", () => {
    const r = call(
      `export function f(c) { const k = {}; const s = new Set(); if (c) { s.add(k); } return s.size; }`,
      "f",
      [boolArg()],
    );
    expect(r.result.conf).not.toBe("exact");
  });
});

describe("Bug 88：Map 非字面量键 SameValueZero 去重", () => {
  it("new Map([[k,1],[k,2]]) 单条目：size / keys / entries / values", () => {
    expect(val(`export function f() { const k = {}; return new Map([[k, 1], [k, 2]]).size; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(
      val(`export function f() { const k = {}; return [...new Map([[k, 1], [k, 2]]).keys()].length; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const k = {}; return [...new Map([[k, 1], [k, 2]]).entries()].length; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const k = {}; return [...new Map([[k, 1], [k, 2]]).values()].join(","); }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("m.set(k,1); m.set(k,2)：size === 1 exact、get(k) === 2 exact（覆盖写）", () => {
    expect(
      val(`export function f() { const k = {}; const m = new Map(); m.set(k, 1); m.set(k, 2); return m.size; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const k = {}; const m = new Map(); m.set(k, 1); m.set(k, 2); return m.get(k); }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("异引用键互不覆盖：size 2、各自 get 精确", () => {
    expect(
      val(`export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); m.set(j, 2); return m.size; }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      val(`export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); m.set(j, 2); return m.get(j); }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("get/has 身份 miss：异引用 → undefined / false（exact）", () => {
    const g = call(
      `export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); return m.get(j); }`,
    );
    expect(g.result).toMatchObject({ conf: "exact" });
    expect(g.result.term).toEqual({ op: "lit", value: undefined });
    const h = call(
      `export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); return m.has(j); }`,
    );
    expect(h.result.term).toEqual({ op: "lit", value: false });
    expect(
      val(`export function f() { const k = {}; const m = new Map(); m.set(k, 1); return m.has(k); }`),
    ).toEqual({ ok: true, value: true });
  });

  it("m.delete 身份精确：命中 true / 异引用 false 且表不变", () => {
    expect(
      val(`export function f() { const k = {}; const m = new Map(); m.set(k, 1); m.delete(k); return m.size; }`),
    ).toEqual({ ok: true, value: 0 });
    expect(
      val(`export function f() { const k = {}; const m = new Map(); m.set(k, 1); m.delete(k); return m.get(k); }`),
    ).toEqual({ ok: true, value: undefined });
    expect(
      val(`export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); m.delete(j); return m.size; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); m.delete(j); return m.get(k); }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const k = {}; const j = {}; const m = new Map(); m.set(k, 1); m.delete(j); return m.has(k); }`),
    ).toEqual({ ok: true, value: true });
  });

  it("controls：字面量键去重 / 覆盖写不受影响", () => {
    expect(val(`export function f() { return new Map([["a", 1], ["a", 2]]).size; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { return new Map([["a", 1], ["a", 2]]).get("a"); }`)).toEqual({
      ok: true,
      value: 2,
    });
    expect(val(`export function f() { return new Map([["a", 1], ["b", 2]]).size; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("拷贝构造保持身份条目：new Map(m).size === 1", () => {
    expect(
      val(`export function f() { const k = {}; const m = new Map([[k, 1]]); return new Map(m).size; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("健全性：抽象键 delete → 身份条目降级，size/has 不折 exact", () => {
    const r = call(
      `export function f(x, o) { const m = new Map(); m.set(o, 1); m.delete(x); return m.size; }`,
      "f",
      [anyArg(), objArg()],
    );
    // 原生 x 可能就是 o → 条目可能被删——size 不可 exact
    expect(r.result.conf).not.toBe("exact");
    const h = call(
      `export function f(x, o) { const m = new Map(); m.set(o, 1); m.delete(x); return m.has(o); }`,
      "f",
      [anyArg(), objArg()],
    );
    expect(h.result.conf).not.toBe("exact");
  });

  it("Set 方法族 union 含对象键（Bug 28 面 × 身份去重）", () => {
    expect(
      val(`export function f() { const k = {}; const s1 = new Set([k]); const s2 = new Set([k]); return s1.union(s2).size; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});
