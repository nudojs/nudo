/**
 * evaluator 对象不变性差分回归（strict ESM 语义）。
 * 回归背景：Object.freeze/seal/preventExtensions/defineProperty 完全未建模——
 * freeze 后 o.a=2 静默失败（原生 o.a 仍 1）而 evaluator 写入成功。
 * 现按 strict 模块语义建模：不可变/不可扩展/不可写目标的写与删抛
 * TypeError（NudoThrow → never + throws），catch 可吸收；
 * 可写路径（seal 已有键、preventExtensions 已有键、writable:true）照常写入。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, effects } from "./eval-helpers.ts";

function str(src: string) {
  return litValue(call(src, "run").result);
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("evaluator object invariants", () => {
  it("freeze writes to existing slots throw TypeError", () => {
    const r = call(`export function run() { let o = {a: 1}; Object.freeze(o); o.a = 2; return o.a; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("freeze adding new slots throws TypeError", () => {
    const r = call(`export function run() { let o = {a: 1}; Object.freeze(o); o.b = 2; return o.b; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });

  it("freeze delete throws TypeError", () => {
    const r = call(`export function run() { let o = {a: 1}; Object.freeze(o); delete o.a; return o.a; }`, "run");
    expect(isNever(r.result)).toBe(true);
    const r2 = call(`export function run() { let o = {a: 1}; Object.freeze(o); return delete o.a; }`, "run");
    expect(isNever(r2.result)).toBe(true);
  });

  it("isFrozen reflects freeze", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); return Object.isFrozen(o); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { let o = {a: 1}; return Object.isFrozen(o); }`)).toEqual({ ok: true, value: false });
  });

  it("seal allows existing-slot writes; new slots and delete throw", () => {
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); o.a = 2; return o.a; }`)).toEqual({ ok: true, value: 2 });
    expect(isNever(call(`export function run() { let o = {a: 1}; Object.seal(o); o.b = 2; return o.b; }`, "run").result)).toBe(true);
    expect(isNever(call(`export function run() { let o = {a: 1}; Object.seal(o); return delete o.a; }`, "run").result)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; Object.seal(o); return Object.isSealed(o); }`)).toEqual({ ok: true, value: true });
  });

  it("preventExtensions new slots throw; existing writes and delete ok", () => {
    expect(isNever(call(`export function run() { let o = {a: 1}; Object.preventExtensions(o); o.b = 2; return o.b; }`, "run").result)).toBe(true);
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); o.a = 2; return o.a; }`)).toEqual({ ok: true, value: 2 });
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); return delete o.a; }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { let o = {a: 1}; Object.preventExtensions(o); return Object.isExtensible(o); }`)).toEqual({ ok: true, value: false });
    expect(str(`export function run() { let o = {a: 1}; return Object.isExtensible(o); }`)).toEqual({ ok: true, value: true });
  });

  it("defineProperty default writable:false writes throw TypeError", () => {
    expect(isNever(call(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1}); o.p = 2; return o.p; }`, "run").result)).toBe(true);
    expect(str(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1}); return o.p; }`)).toEqual({ ok: true, value: 1 });
    expect(str(`export function run() { let o = {}; Object.defineProperty(o, "p", {value: 1, writable: true}); o.p = 2; return o.p; }`)).toEqual({ ok: true, value: 2 });
  });

  it("defineProperty non-enumerable keys are hidden from Object.keys", () => {
    const r = call(
      `export function run() { let o = {a: 1}; Object.defineProperty(o, "p", {value: 1, enumerable: false}); return Object.keys(o); }`,
      "run",
    ).result;
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k === "tuple") {
      expect(r.shape.elements.map((e) => { const r = litValue(e); return r.ok ? r.value : undefined; })).toEqual(["a"]);
    }
  });

  it("frozen arrays index write throws TypeError", () => {
    const r = call(`export function run() { let a = [1, 2]; Object.freeze(a); a[0] = 9; return a; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
    expect(str(`export function run() { let a = [1, 2]; Object.freeze(a); return Object.isFrozen(a); }`)).toEqual({ ok: true, value: true });
  });

  it("freeze does not change Object.keys or reads", () => {
    const r = call(
      `export function run() { let o = {a: 1}; Object.freeze(o); return Object.keys(o); }`,
      "run",
    ).result;
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k === "tuple") {
      expect(r.shape.elements.map((e) => { const r = litValue(e); return r.ok ? r.value : undefined; })).toEqual(["a"]);
    }
    expect(str(`export function run() { let o = {a: 1}; Object.freeze(o); return o.a; }`)).toEqual({ ok: true, value: 1 });
  });

  it("unfrozen objects keep previous mutability", () => {
    expect(str(`export function run() { let o = {a: 1}; o.a = 2; return o.a; }`)).toEqual({ ok: true, value: 2 });
    expect(str(`export function run() { let o = {a: 1}; o.b = 2; return o.b; }`)).toEqual({ ok: true, value: 2 });
    expect(str(`export function run() { let o = {a: 1}; return delete o.a; }`)).toEqual({ ok: true, value: true });
  });

  // ES 规范：非对象（prim/null/undefined）恒 frozen/sealed、不可扩展（不抛）。
  it("primitives are always frozen/sealed and not extensible", () => {
    expect(str(`export function run() { return Object.isFrozen(5); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isSealed(5); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isExtensible(5); }`)).toEqual({ ok: true, value: false });
    expect(str(`export function run() { return Object.isFrozen('s'); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isSealed(true); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isExtensible(false); }`)).toEqual({ ok: true, value: false });
  });

  it("null/undefined are frozen/sealed and not extensible (no throw)", () => {
    expect(str(`export function run() { return Object.isFrozen(null); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isSealed(null); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isExtensible(null); }`)).toEqual({ ok: true, value: false });
    expect(str(`export function run() { return Object.isFrozen(undefined); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isSealed(undefined); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.isExtensible(undefined); }`)).toEqual({ ok: true, value: false });
  });

  it("freeze/seal/preventExtensions on primitives return the primitive", () => {
    expect(str(`export function run() { return Object.freeze(5); }`)).toEqual({ ok: true, value: 5 });
    expect(str(`export function run() { return Object.seal('s'); }`)).toEqual({ ok: true, value: "s" });
    expect(str(`export function run() { return Object.preventExtensions(true); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { return Object.freeze(null); }`)).toEqual({ ok: true, value: null });
    expect(str(`export function run() { return Object.preventExtensions(undefined); }`)).toEqual({ ok: true, value: undefined });
  });

  // {...frozen} 是**新对象**，不携带 frozen 不变性（原生 identity 也不共享）。
  it("spread of a frozen object produces an unfrozen copy", () => {
    expect(
      str(`export function run() { let o = Object.freeze({a: 1}); return Object.isFrozen({...o}); }`),
    ).toEqual({ ok: true, value: false });
    expect(
      str(`export function run() { let o = Object.freeze({a: 1}); let c = {...o}; return Object.isFrozen(c); }`),
    ).toEqual({ ok: true, value: false });
  });

  it("spread copy is independent (writes do not mutate the source)", () => {
    expect(
      str(
        `export function run() { let o = {a: 1}; let c = {...o}; c.a = 9; return o.a; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("spread still copies slots and preserves later overrides", () => {
    expect(str(`export function run() { let o = {a: 1, b: 2}; let c = {...o, b: 3}; return c.a + ':' + c.b; }`)).toEqual({ ok: true, value: "1:3" });
    expect(str(`export function run() { let o = {a: 1}; return ({...o}).a; }`)).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 120: Object.setPrototypeOf extensibility", () => {
  // ES2024 OrdinarySetPrototypeOf step 4：不可扩展目标改原型 → TypeError
  //（此前无条件 setProtoAbs——frozen/sealed/nonext 目标静默改原型）。
  it("frozen/sealed/non-extensible 目标改原型 → 定抛 TypeError", () => {
    for (const setup of [
      `const o = Object.freeze({});`,
      `const o = Object.seal({a: 1});`,
      `const o = Object.preventExtensions({});`,
    ]) {
      const r = call(`export function run() { ${setup} Object.setPrototypeOf(o, {}); return "no"; }`, "run");
      expect(isNever(r.result)).toBe(true);
      expect(throwsTypeError(r.throws)).toBe(true);
    }
    // null 原型方向同理（sealed + null）
    const r2 = call(
      `export function run() { const o = Object.seal({a: 1}); Object.setPrototypeOf(o, null); return "no"; }`,
      "run",
    );
    expect(isNever(r2.result)).toBe(true);
    expect(throwsTypeError(r2.throws)).toBe(true);
  });

  it("可扩展目标照常改原型 + 返回接收者（control）", () => {
    expect(str(`export function run() { const o = {}; Object.setPrototypeOf(o, {}); return "ok"; }`)).toEqual({ ok: true, value: "ok" });
    expect(str(`export function run() { const o = {}; Object.setPrototypeOf(o, null); return typeof Object.getPrototypeOf(o); }`)).toEqual({ ok: true, value: "object" });
  });

  it("frozen 重设同原型不抛（SameValue 豁免先于 extensible 检查）", () => {
    // 缺省原型 ↔ Object.prototype
    expect(str(`export function run() { const o = Object.freeze({}); Object.setPrototypeOf(o, Object.prototype); return "no"; }`)).toEqual({ ok: true, value: "no" });
    // nullProto ↔ lit null
    expect(str(`export function run() { const o = Object.freeze(Object.create(null)); Object.setPrototypeOf(o, null); return "no"; }`)).toEqual({ ok: true, value: "no" });
    // protoTable 同 Abs 身份（同变量二次设定）
    expect(str(`export function run() { const p = {}; const o = Object.setPrototypeOf({}, p); Object.freeze(o); Object.setPrototypeOf(o, p); return "no"; }`)).toEqual({ ok: true, value: "no" });
    // nullProto frozen 改成对象原型：必抛
    const r = call(`export function run() { const o = Object.freeze(Object.create(null)); Object.setPrototypeOf(o, {}); return "no"; }`, "run");
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });
});

describe("Bug 129: freeze/seal 非空 TypedArray", () => {
  // SetIntegrityLevel 对整数索引异质对象不可行：length > 0 定抛
  //（V8「Cannot freeze|seal array buffer views with elements」）；空 TA 合法。
  it("freeze/seal 非空 TA（数字形态，length 槽可证）→ 定抛 TypeError", () => {
    for (const expr of [
      `Object.freeze(new Uint8Array(2))`,
      `Object.seal(new Uint8Array(2))`,
      `Object.freeze(new Int8Array(1))`,
      `Object.freeze(new BigInt64Array(4))`,
    ]) {
      const r = call(`export function run() { ${expr}; return "ok"; }`, "run");
      expect(isNever(r.result)).toBe(true);
      expect(throwsTypeError(r.throws)).toBe(true);
    }
  });

  it("freeze/seal 非空 TA（字面量源形态）→ 定抛 TypeError；空 TA 合法", () => {
    for (const expr of [
      `Object.freeze(new Uint8Array([1, 2]))`,
      `Object.seal(new Uint8Array([1, 2]))`,
      `Object.freeze(new Float64Array([1.5]))`,
    ]) {
      const r = call(`export function run() { ${expr}; return "ok"; }`, "run");
      expect(isNever(r.result)).toBe(true);
      expect(throwsTypeError(r.throws)).toBe(true);
    }
    // 空 TA：冻结成功 + isFrozen 反映（原生 freeze(Uint8Array(0)) 合法）
    expect(str(`export function run() { const t = Object.freeze(new Uint8Array(0)); return Object.isFrozen(t); }`)).toEqual({ ok: true, value: true });
    expect(str(`export function run() { const t = Object.seal(new Uint8Array([])); return Object.isSealed(t); }`)).toEqual({ ok: true, value: true });
  });

  it("preventExtensions/isFrozen/isSealed 对 TA 不抛（controls）", () => {
    expect(str(`export function run() { Object.preventExtensions(new Uint8Array([1, 2])); return "ok"; }`)).toEqual({ ok: true, value: "ok" });
    expect(str(`export function run() { return typeof Object.isFrozen(new Uint8Array([1, 2])); }`)).toEqual({ ok: true, value: "boolean" });
    expect(str(`export function run() { return typeof Object.isSealed(new Uint8Array([1, 2])); }`)).toEqual({ ok: true, value: "boolean" });
  });

  it("非 TA 内建（ArrayBuffer/DataView/普通对象/数组）freeze 不抛（controls）", () => {
    for (const recv of [
      `new ArrayBuffer(4)`,
      `new DataView(new ArrayBuffer(4))`,
      `{a: 1}`,
      `[1, 2]`,
    ]) {
      expect(str(`export function run() { Object.freeze(${recv}); return "ok"; }`)).toEqual({ ok: true, value: "ok" });
    }
  });

  it("gate：any 接收者 freeze/seal 记 may TypeError；preventExtensions 不记", () => {
    // 原生：freeze(x) 仅当 x 是非空 TA 才抛——any 域 may（非 false-positive）
    expect(effects(`export function f(x) { return Object.freeze(x); }`)).toContain("TypeError");
    expect(effects(`export function f(x) { return Object.seal(x); }`)).toContain("TypeError");
    expect(effects(`export function f(x) { return Object.preventExtensions(x); }`)).not.toContain("TypeError");
  });
});
