/**
 * Bug 47（计算 Symbol 键解构静默丢绑定）：emitDestructure 的
 * ObjectPattern 此前只认静态字符串键（staticKeyOf null → continue）——
 * `{[Symbol.iterator]: it} = [1,2,3]` 的计算键被整条跳过，`it` 从未绑定
 * （typeof 折 "undefined"、裸读 ReferenceError 面）。
 *
 * 修复：计算键三级回退——[Symbol.X] → "@@X" 投影（$get 读，镜像对象
 * 字面量计算键口径）；其余计算键 → $idx 计算读（键不可判定时槽并
 * undefined，sound）；键也不进 $objRest 排除面之外的静默丢弃。
 */
import { describe, it, expect } from "vitest";
import { litValue, anyAbs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

describe("Bug 47: 计算 Symbol 键解构绑定", () => {
  it("const {[Symbol.iterator]: it} = [1,2,3]; typeof it → function", () => {
    const r = call(
      `export function f() { const {[Symbol.iterator]: it} = [1,2,3]; return typeof it; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("const {[Symbol.toStringTag]: t} = {a:1}; return t → undefined（不再 ReferenceError）", () => {
    const r = call(
      `export function f() { const {[Symbol.toStringTag]: t} = {a:1}; return t; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("赋值解构（kw 为空）同样绑定", () => {
    const r = call(
      `export function f() { let it; ({[Symbol.iterator]: it} = [1,2,3]); return typeof it; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("符号键解构 + rest：rest 排除投影键（镜像原生排除 @@iterator）", () => {
    const r = call(
      `export function f() { const {[Symbol.iterator]: it, ...rest} = {a:1, b:2}; return Object.keys(rest).join(","); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a,b" });
  });

  it("计算字符串键 ['x'] 静态解析不回归", () => {
    const r = call(
      `export function f() { const {["x"]: v} = {x: 7}; return v; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("非字面量计算键 [k]（k 缺参 → undefined 键）：绑定存在且读面 native 一致", () => {
    const r = call(
      `export function f(k) { const {[k]: v} = {x: 9}; return v === undefined; }`,
    );
    // k 缺参 → $idx 键折 "undefined" → 闭对象 miss → v = undefined（native 同）
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("any 实参计算键：绑定不丢（无 ReferenceError/never 面）", () => {
    const r = call(
      `export function f(k) { const {[k]: v} = {x: 9}; return typeof v === "undefined"; }`,
      "f",
      [anyAbs],
    );
    // 键不可判定 → 槽 ∪ undefined 域；typeof any 不折假精确（sound）
    expect(r.result.shape.k === "never").toBe(false);
  });

  it("符号键 + 默认值：{[Symbol.iterator]: it = null} = {} → null", () => {
    const r = call(
      `export function f() { const {[Symbol.iterator]: it = null} = {}; return it; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: null });
  });
});

describe("Bug 47: differential native 对照（隐式 return 体）", () => {
  const corpus = [
    `const {[Symbol.iterator]: it} = [1,2,3]; return typeof it;`,
    `const {[Symbol.toStringTag]: t} = {a:1}; return t;`,
    `let it; ({[Symbol.iterator]: it} = [1]); return typeof it;`,
    `const {[Symbol.iterator]: it = "d"} = {}; return it;`,
    `const {["x"]: v} = {x: 7}; return v;`,
  ];
  it.each(corpus.map((body, i) => [i, body] as const))(
    "语料 #%i 与 native 一致",
    (_i, body) => {
      expect(diffBody(body)).toBeNull();
    },
  );
});
