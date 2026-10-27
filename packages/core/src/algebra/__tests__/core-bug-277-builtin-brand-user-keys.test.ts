/**
 * Bug 277 — 内建 brand（Error 家族 / Map / Date / …）上**用户新增的自有可枚
 * 举属性**对 `Object.keys` / `values` / `entries` 与 `JSON.stringify` **完全
 * 隐形**（引擎折「自信的确切空键集」`[]`），而同一引擎的 gOPN / gOPD /
 * `hasOwnProperty` 三个面又说它存在且可枚举 ⇒ **同一引擎多面互斥**。
 *
 * 根因：`BUILTIN_BRAND_NO_ENUM_KEYS` 是**族级常量**，`builtinBrandNoEnumKeys`
 * 判定完全不看接收者的真实槽表 ⇒ 一旦用户在实例上新增属性（`e.code = 42`
 * / `m.foo = 1` / `d.bar = 2`）就被短路面成 exact 空元组。
 *
 * 修法：判定与投影都**先查接收者的内层槽表**——有用户新增的自有可枚举键时
 * 按真实键集投影（`builtinBrandUserEnumEntries` / `builtinBrandUserOwnKeys`），
 * 零键短路只在实例确实没有可枚举自有键时成立；`JSON.stringify` 同步展开。
 * 内层槽表装**内部数据**的家族（RegExp 的 source/flags、URL 的 href、
 * ArrayBuffer 的 byteLength…——原生它们是原型访问器、非自有键）不参与该
 * 投影，保持「零可枚举自有键」口径。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue, type Abs } from "../abs.ts";

const PRELUDE = `
function mkErr() { const e = new TypeError("boom"); e.code = 42; return e; }
function mkMap() { const m = new Map(); m.foo = 1; return m; }
function mkDate() { const d = new Date(0); d.bar = 2; return d; }
`;

function absOf(body: string): Abs {
  return call(`${PRELUDE}\nexport function f() { ${body} }`, "f").result;
}

function tupleLits(a: Abs): unknown[] | undefined {
  if (a.shape.k !== "tuple") return undefined;
  const out = a.shape.elements.map((e) => {
    const v = litValue(e);
    return v.ok ? v.value : undefined;
  });
  return out.some((v) => v === undefined) ? undefined : out;
}

describe("Bug 277 · 内建 brand 上用户新增的自有属性必须进枚举视图", () => {
  it("Object.keys(TypeError + e.code) 折真实键集（改前 []）", () => {
    expect(tupleLits(absOf("return Object.keys(mkErr());"))).toEqual(["code"]);
  });

  it("Object.values / entries 同键集", () => {
    expect(tupleLits(absOf("return Object.values(mkErr());"))).toEqual([42]);
    const a = absOf("return Object.entries(mkErr());");
    const els = (a.shape as { k: string; elements: Abs[] }).elements;
    expect(a.shape.k).toBe("tuple");
    expect(els.length).toBe(1);
    expect(tupleLits(els[0]!)).toEqual(["code", 42]);
  });

  it("JSON.stringify(TypeError + e.code) 折 {\"code\":42}（改前 \"{}\"）", () => {
    expect(litValue(absOf("return JSON.stringify(mkErr());"))).toEqual({
      ok: true,
      value: '{"code":42}',
    });
  });

  it("Error 家族四面一致：keys / gOPN / gOPD / hasOwn 同键集同标志", () => {
    expect(tupleLits(absOf("return Object.keys(mkErr());"))).toEqual(["code"]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mkErr());"))).toEqual([
      "stack",
      "message",
      "code",
    ]);
    expect(
      tupleLits(
        absOf(`
  const e = mkErr();
  const d = Object.getOwnPropertyDescriptor(e, "code");
  return [d.value, d.enumerable, e.hasOwnProperty("code")];
`),
      ),
    ).toEqual([42, true, true]);
  });

  it("Map 实例：keys 与 gOPN 都投影用户新增键（改前两面都折 []）", () => {
    expect(tupleLits(absOf("return Object.keys(mkMap());"))).toEqual(["foo"]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mkMap());"))).toEqual(["foo"]);
    expect(tupleLits(absOf("return Object.values(mkMap());"))).toEqual([1]);
  });

  it("Date 实例：keys 与 gOPN 同样投影", () => {
    expect(tupleLits(absOf("return Object.keys(mkDate());"))).toEqual(["bar"]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mkDate());"))).toEqual(["bar"]);
  });

  it("对照组：未被用户改过的实例仍是零可枚举自有键（不放宽）", () => {
    expect(tupleLits(absOf("return Object.keys(new Map());"))).toEqual([]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(new Map());"))).toEqual([]);
    expect(tupleLits(absOf("return Object.keys(new Date(0));"))).toEqual([]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(new Date(0));"))).toEqual([]);
    expect(tupleLits(absOf('return Object.keys(new TypeError("x"));'))).toEqual([]);
  });

  it("对照组：Error 家族内部槽仍非可枚举（message/stack 不进 keys、不进 JSON）", () => {
    expect(tupleLits(absOf('return Object.getOwnPropertyNames(new TypeError("x"));'))).toEqual([
      "stack",
      "message",
    ]);
    expect(litValue(absOf('return JSON.stringify(new TypeError("x"));'))).toEqual({
      ok: true,
      value: "{}",
    });
  });

  it("对照组：内部数据家族（RegExp）不被误当用户键——keys [] / gOPN [lastIndex]", () => {
    expect(tupleLits(absOf("return Object.keys(/x/);"))).toEqual([]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(/x/);"))).toEqual(["lastIndex"]);
    expect(litValue(absOf("return JSON.stringify(/x/);"))).toEqual({ ok: true, value: "{}" });
  });

  it("用户类实例路径不受影响（仍走内层槽表投影）", () => {
    const a = call(
      `
class A { constructor() { this.p = 1; } }
export function f() {
  return [Object.keys(new A()), Object.getOwnPropertyNames(new A())];
}
`,
      "f",
    ).result;
    const els = (a.shape as { k: string; elements: Abs[] }).elements;
    expect(a.shape.k).toBe("tuple");
    expect(tupleLits(els[0]!)).toEqual(["p"]);
    expect(tupleLits(els[1]!)).toEqual(["p"]);
  });
});
