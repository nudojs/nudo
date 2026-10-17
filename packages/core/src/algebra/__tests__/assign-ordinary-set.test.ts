/**
 * Bug 128 回归：Object.assign 逐键 [[Set]]（OrdinarySet）语义。
 *
 * 原生 Object.assign 对目标逐键执行 Set(target, key, value, throw=true)：
 * - "__proto__" 键非自有且目标非 null-proto → Object.prototype 的原型
 *   setter：null / 对象值设原型、原始值静默忽略（原型污染面——
 *   JSON.parse 源键此前被折成自有数据键）
 * - 自有访问器 → setter 调用（getter-only → TypeError）
 * - 自有 / 继承非可写数据属性 → TypeError
 * 此前引擎只写自有槽：继承面全忽略。分类共享 descriptor.ts 的
 * classifyAssignSet（evaluator mergeObj 与 evalObjectMethod("assign") 双路）。
 *
 * 注：spread 是 CreateDataPropertyOrThrow（拷自有键，不走 [[Set]]）——
 * 对照组锚定该分野（proto-slot-key.test.ts 同源）。
 */
import { describe, it, expect } from "vitest";
import { val, call, throwsError } from "./eval-helpers.ts";

describe("Bug 128: __proto__ source key goes through the prototype setter", () => {
  it("primitive value is silently ignored (no own key)", () => {
    expect(
      val(`export function f() { return Object.keys(Object.assign({}, JSON.parse('{"__proto__":1}'))).length; }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("object value sets the prototype (inherited read stays unknown)", () => {
    const r = call(`export function f() { const t = {}; Object.assign(t, JSON.parse('{"__proto__": {"a":1}}')); return t.a; }`);
    const isExactUndef =
      !!r.result &&
      r.result.shape.k === "unknown" &&
      r.result.term?.op === "lit" &&
      r.result.term.value === undefined &&
      r.result.conf === "exact";
    expect(isExactUndef).toBe(false);
  });

  it("null value makes the target null-proto", () => {
    expect(
      val(`export function f() { const t = {}; Object.assign(t, JSON.parse('{"__proto__": null}')); return Object.getPrototypeOf(t); }`),
    ).toEqual({ ok: true, value: null });
  });

  it("null-proto target has no setter: __proto__ becomes an own key", () => {
    expect(
      val(`export function f() { const t = Object.create(null); Object.assign(t, JSON.parse('{"__proto__":1}')); return Object.keys(t).join(","); }`),
    ).toEqual({ ok: true, value: "__proto__" });
  });

  it("spread keeps copying __proto__ as an own data key (CreateDataProperty)", () => {
    expect(
      val(`export function f() { return Object.keys({ ...JSON.parse('{"__proto__":1}') }).length; }`),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 128: own accessor targets dispatch setters", () => {
  it("setter runs with the target as receiver", () => {
    expect(
      val(`export function f() { const t = { set x(v) { this.y = v; } }; Object.assign(t, { x: 5 }); return t.y; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("getter-only target throws TypeError", () => {
    const r = call(`export function f() { const t = { get x() { return 1; } }; Object.assign(t, { x: 5 }); return 0; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});

describe("Bug 128: non-writable data targets throw", () => {
  it("own writable:false throws", () => {
    const r = call(`export function f() { const t = {}; Object.defineProperty(t, "x", { value: 1, writable: false }); Object.assign(t, { x: 2 }); return 0; }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("inherited non-writable throws (prototype chain walk)", () => {
    const r = call(
      `export function f() { const p = {}; Object.defineProperty(p, "x", { value: 1, writable: false }); const t = Object.create(p); Object.assign(t, { x: 2 }); return 0; }`,
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("inherited writable data allows the own write", () => {
    expect(
      val(`export function f() { const t = Object.create({ x: 1 }); Object.assign(t, { x: 2 }); return t.x; }`),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("Bug 128: plain assign semantics are unchanged (controls)", () => {
  it("multi-source merge and enumerable filtering", () => {
    expect(val(`export function f() { return Object.assign({ a: 1 }, { b: 2 }, { a: 3 }).a; }`)).toEqual({ ok: true, value: 3 });
    expect(val(`export function f() { return Object.assign({ a: 1 }, { b: 2 }).b; }`)).toEqual({ ok: true, value: 2 });
    const s: string = `export function f() { const s = {}; Object.defineProperty(s, "a", { value: 1, enumerable: false }); return Object.keys(Object.assign({}, s)).length; }`;
    expect(val(s)).toEqual({ ok: true, value: 0 });
  });

  it("tuple source keeps writing index keys", () => {
    expect(
      val(`export function f() { return Object.assign({}, ["a", "b"])[1]; }`),
    ).toEqual({ ok: true, value: "b" });
  });
});
