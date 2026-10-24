/**
 * Bug 327 回归：JSON.stringify 的**内建 brand 折叠是递归的**（顶层与
 * 对象/数组**成员**同款）。
 *
 * 修前：`foldJsonTotalBrand` 只喂**顶层**接收者 ⇒ **嵌套** brand 一律落
 * 「may carry BigInt / circular / throwing toJSON」⇒ **记 may-throw**
 * ⇒ L1/L2 **假红**（native 全部正常返回）；而同一 brand 放在顶层则完全
 * 正确 ⇒「total brand 白名单只对顶层接收者生效」。
 *
 * 修法（json.ts `jsonBrandFold` 单一事实源 + `absToJsonNative` 的 brand
 * 臂 + `jsonStringifyTotal` 的 brand 臂）：
 * - 精确可折：RegExp/Map/Set 族/Error 族 → {}；Date → ISO 串（Invalid →
 *   null）；URL → href；装箱 Number/String/Boolean → 拆箱后的原始值；
 * - total 但值不可知：TypedArray 家族（元素值未建模）——**恒不抛**；
 * - 不可折（仍记 may-throw）：用户 toJSON 面、BigInt 元素家族
 *   （BigInt64Array/BigUint64Array —— 原生**定抛** TypeError）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, abs } from "@nudojs/core";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../may-throw.ts";
import { call } from "./eval-helpers.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

/** 源级求值（带 any 实参）：{ value, throws, effects } 三面 */
function evalSrc(src: string, fnName = "f"): { value: unknown; throws: unknown; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, [anyAbs] as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    value: result.result,
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 327: JSON.stringify 的嵌套内建 brand（不记 may-throw）", () => {
  it("嵌套 Date → 精确折叠（node: {\"when\":\"1970-01-01T00:00:00.000Z\"}）", () => {
    expect(v(`export function f() { return JSON.stringify({ when: new Date(0) }); }`)).toEqual({
      ok: true,
      value: '{"when":"1970-01-01T00:00:00.000Z"}',
    });
  });

  it("嵌套 Map / Set / RegExp / Error → {}（node）", () => {
    expect(v(`export function f() { return JSON.stringify({ m: new Map([[1,2]]) }); }`)).toEqual({
      ok: true,
      value: '{"m":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ s: new Set([1,2]) }); }`)).toEqual({
      ok: true,
      value: '{"s":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ r: /a(b)/g }); }`)).toEqual({
      ok: true,
      value: '{"r":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ e: new Error("x") }); }`)).toEqual({
      ok: true,
      value: '{"e":{}}',
    });
  });

  it("装箱 prim → 拆箱后的原始值（node: {\"s\":\"ab\"}）", () => {
    expect(v(`export function f() { return JSON.stringify({ s: new String("ab") }); }`)).toEqual({
      ok: true,
      value: '{"s":"ab"}',
    });
    expect(v(`export function f() { return JSON.stringify({ n: new Number(5) }); }`)).toEqual({
      ok: true,
      value: '{"n":5}',
    });
    expect(v(`export function f() { return JSON.stringify({ b: new Boolean(true) }); }`)).toEqual({
      ok: true,
      value: '{"b":true}',
    });
  });

  it("嵌套 brand 不再记 may-throw（负控制：BigInt 元素家族仍记）", () => {
    const ok = evalSrc(`export function f(x) { return JSON.stringify({ when: new Date(0) }); }`);
    expect(ok.effects).not.toContain("TypeError");
    const bi = evalSrc(`export function f(x) { return JSON.stringify({ b: new BigInt64Array([1n]) }); }`);
    expect(bi.effects).toContain("TypeError");
  });

  it("嵌套 brand 的入口不记 may-throw（产品面 L2 假红消失）", () => {
    const r = call(`export function f() { return JSON.stringify({ when: new Date(0) }); }`, "f");
    expect((r.throws as { shape?: { k?: string } }).shape?.k).toBe("never");
  });

  it("深层嵌套（数组 / 多层对象）同样折叠（node）", () => {
    expect(v(`export function f() { return JSON.stringify([[new Date(0)]]); }`)).toEqual({
      ok: true,
      value: '[["1970-01-01T00:00:00.000Z"]]',
    });
    expect(v(`export function f() { return JSON.stringify({ deep: { deeper: new Date(0) } }); }`)).toEqual({
      ok: true,
      value: '{"deep":{"deeper":"1970-01-01T00:00:00.000Z"}}',
    });
  });

  it("URL 嵌套 → href 串（node）", () => {
    expect(
      v(`export function f() { return JSON.stringify({ url: new URL("https://x.test/") }); }`),
    ).toEqual({ ok: true, value: '{"url":"https://x.test/"}' });
  });

  it("replacer 路径同款：嵌套 brand 走 toJSON 步（先于 replacer，node）", () => {
    expect(
      v(`export function f() { return JSON.stringify({ when: new Date(0) }, (k, v) => v); }`),
    ).toEqual({ ok: true, value: '{"when":"1970-01-01T00:00:00.000Z"}' });
    expect(
      v(`export function f() { return JSON.stringify({ m: new Map() }, (k, v) => v); }`),
    ).toEqual({ ok: true, value: '{"m":{}}' });
  });

  it("负控制：顶层 Date 折叠不回归（node）", () => {
    expect(v(`export function f() { return JSON.stringify(new Date(0)); }`)).toEqual({
      ok: true,
      value: '"1970-01-01T00:00:00.000Z"',
    });
  });

  it("负控制：TypedArray 家族 total 但值不可知（元素值未建模）", () => {
    const r = evalSrc(`export function f(x) { return JSON.stringify({ u: new Uint8Array([1,2]) }); }`);
    expect(r.effects).not.toContain("TypeError");
    const r2 = call(`export function f() { return JSON.stringify({ u: new Uint8Array([1,2]) }); }`, "f");
    expect((r2.throws as { shape?: { k?: string } }).shape?.k).toBe("never");
  });

  it("负控制：用户 toJSON 面不折（仍记 may-throw）", () => {
    const r = evalSrc(`export function f(x) { return JSON.stringify(x); }`);
    expect(r.effects).toContain("TypeError");
  });

  it("负控制：普通对象 / 数组序列化不回归", () => {
    expect(v(`export function f() { return JSON.stringify({ a: 1, b: [1, 2] }); }`)).toEqual({
      ok: true,
      value: '{"a":1,"b":[1,2]}',
    });
  });
});
