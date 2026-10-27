/**
 * Bug「match/exec 结果 JSON 视图」回归：RegExpExecArray 原生是 Array——
 * JSON.stringify 走 SerializeJSONArray，只见下标元素（"abc".match(/b/) →
 * ["b"]）；index/input/groups 虽可枚举但非数组下标、length 是数组 exotic
 * 非枚举自有属性，均不进 JSON 面。修前引擎把结果建模为全槽可枚举 obj →
 * 折 {"0":"b","length":1,"index":1,"input":"abc"}。
 *
 * 修复口径：形状维持 obj（m[0]/m.length/m.index/m.input/m.groups.x 槽读面
 * #136 依赖；容器 arr/tuple 无侧槽），数组性经 **Shape 的 `view: "array"`
 * facet** 标注（BUG-258：单一事实源；此前是 WeakSet 侧表）——json.ts 三消费点
 * （absToJsonNative / jsonStringifyTotal / callable replacer walk）按下标槽
 * 0..n-1 走数组序列化；length 槽单挂
 * enumerable:false（原生数组 length 唯一非枚举——Object.keys/展开面）。
 * matchAll 迭代元素改与 exec 结果同形（matchResultAbs）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

describe("match/exec 结果 JSON 视图（原生 Array：只见下标元素）", () => {
  it('JSON.stringify("abc".match(/b/)) → \'["b"]\'（node 原生）', () => {
    const r = call(`export function f1() { return JSON.stringify("abc".match(/b/)); }`, "f1");
    expect(litValue(r.result)).toEqual({ ok: true, value: '["b"]' });
  });

  it('JSON.stringify(/b/.exec("abc")) → \'["b"]\'（exec 同款结果）', () => {
    const r = call(`export function f2() { return JSON.stringify(/b/.exec("abc")); }`, "f2");
    expect(litValue(r.result)).toEqual({ ok: true, value: '["b"]' });
  });

  it('捕获组：JSON.stringify(/a(b)c/.exec("xabcz")) → \'["abc","b"]\'', () => {
    const r = call(`export function f3() { return JSON.stringify(/a(b)c/.exec("xabcz")); }`, "f3");
    expect(litValue(r.result)).toEqual({ ok: true, value: '["abc","b"]' });
  });

  it("未参与捕获组 → 数组槽 null（JSON.stringify(/a(x)?z/.exec(\"az\")) → '[\"az\",null]'", () => {
    const r = call(`export function f4() { return JSON.stringify(/a(x)?z/.exec("az")); }`, "f4");
    expect(litValue(r.result)).toEqual({ ok: true, value: '["az",null]' });
  });

  it('无匹配 → null：JSON.stringify("abc".match(/x/)) → "null" 串', () => {
    const r = call(`export function f5() { return JSON.stringify("abc".match(/x/)); }`, "f5");
    expect(litValue(r.result)).toEqual({ ok: true, value: "null" });
  });

  it('g 旗标 match = 纯串数组：JSON.stringify("abcabc".match(/b/g)) → \'["b","b"]\'', () => {
    const r = call(`export function f6() { return JSON.stringify("abcabc".match(/b/g)); }`, "f6");
    expect(litValue(r.result)).toEqual({ ok: true, value: '["b","b"]' });
  });

  it("嵌套容器/具名组不回退：JSON.stringify([m]) → '[[\"b\"]]'、m.groups.x 可读", () => {
    const r = call(`export function f7() { return JSON.stringify(["abc".match(/b/)]); }`, "f7");
    expect(litValue(r.result)).toEqual({ ok: true, value: '[["b"]]' });
    const g = call(
      `export function f8() { const m = /(?<x>\\d)/.exec("5"); return m.groups.x; }`,
      "f8",
    );
    expect(litValue(g.result)).toEqual({ ok: true, value: "5" });
  });

  it("callable replacer 桥接同走数组形：JSON.stringify(m, (k,v)=>v) → '[\"b\"]'", () => {
    const r = call(
      `export function f9() { return JSON.stringify("abc".match(/b/), (k, v) => v); }`,
      "f9",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: '["b"]' });
  });

  it("space 实参照常：JSON.stringify(m, null, 2) → '[\\n  \"b\"\\n]'", () => {
    const r = call(`export function f10() { return JSON.stringify(/b/.exec("abc"), null, 2); }`, "f10");
    expect(litValue(r.result)).toEqual({ ok: true, value: '[\n  "b"\n]' });
  });
});

describe("读面不回归（#136 槽读语义，标量行拆断言）", () => {
  it("m[0] → \"b\"", () => {
    const r = call(`export function g1() { const m = /b/.exec("abc"); return m[0]; }`, "g1");
    expect(litValue(r.result)).toEqual({ ok: true, value: "b" });
  });

  it("m.length → 1", () => {
    const r = call(`export function g2() { const m = /b/.exec("abc"); return m.length; }`, "g2");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("m.index → 1", () => {
    const r = call(`export function g3() { const m = /b/.exec("abc"); return m.index; }`, "g3");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("m.input → \"abc\"", () => {
    const r = call(`export function g4() { const m = /b/.exec("abc"); return m.input; }`, "g4");
    expect(litValue(r.result)).toEqual({ ok: true, value: "abc" });
  });

  it('"abc".match(/x/) 折 null 字面量（无匹配不回归）', () => {
    const r = call(`export function g5() { return "abc".match(/x/); }`, "g5");
    expect(litValue(r.result)).toEqual({ ok: true, value: null });
  });

  it("枚举面：length 非枚举（Object.keys({...m}) → 0,index,input,groups，node 原生）", () => {
    const r = call(
      `export function g6() { return Object.keys({..."abc".match(/b/)}).join(","); }`,
      "g6",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "0,index,input,groups" });
  });
});

describe("matchAll：迭代元素与 exec 结果同形", () => {
  it('[..."abc".matchAll(/b/g)].length → 1（已正确用例不回归）', () => {
    const r = call(`export function h1() { return [..."abc".matchAll(/b/g)].length; }`, "h1");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("元素读面：[...ms][0].index → 1（node 原生）", () => {
    const r = call(
      `export function h2() { return [..."abc".matchAll(/b/g)][0].index; }`,
      "h2",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("元素读面：[...ms][0].input → \"abc\"", () => {
    const r = call(
      `export function h3() { return [..."abc".matchAll(/b/g)][0].input; }`,
      "h3",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "abc" });
  });

  it("元素读面：[...ms][0][0] → \"b\"", () => {
    const r = call(
      `export function h4() { return [..."abc".matchAll(/b/g)][0][0]; }`,
      "h4",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "b" });
  });

  it('元素 JSON 视图：JSON.stringify([...ms][0]) → \'["b"]\'', () => {
    const r = call(
      `export function h5() { return JSON.stringify([..."abc".matchAll(/b/g)][0]); }`,
      "h5",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: '["b"]' });
  });

  it("多匹配计数：[...'aba'.matchAll(/a/g)].length → 2（node 原生）", () => {
    const r = call(
      `export function h6() { return [..."aba".matchAll(/a/g)].length; }`,
      "h6",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });
});
