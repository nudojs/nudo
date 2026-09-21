/**
 * 对象 spread 的非对象源未建模（假精确）：
 * 原生 {...'ab'} → {0:'a', 1:'b'}（code point 数字键）、{...[1,2]} →
 * {0:1, 1:2}（下标键、hole 跳过）、{...5}/{...null} → {}（prim 忽略）。
 * B-path $spread 与 ast-eval ObjectExpression 对非 obj 源只标 open——
 * 空对象字面量 base 折 {}（假精确）。
 * 修复：spread 对字符串字面量/元组源投影数字键槽合并；prim 字面量源
 * 忽略；不可判定（抽象字符串/arr）保持 open 保守。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, unknown } from "@nudojs/core";
import { analyzeFn } from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path object spread of non-object sources", () => {
  it("string source spreads code-point index keys", () => {
    expect(
      litValue(call(`export function f() { return JSON.stringify({...'ab'}); }`).result),
    ).toBe('{"0":"a","1":"b"}');
    expect(litValue(call(`export function f() { return ({...'ab'})['1']; }`).result)).toBe("b");
    // surrogate pair 按 code point（𠮷 一个键）
    expect(
      litValue(call(`export function f() { return Object.keys({...'a\u{20BB7}'}).length; }`).result),
    ).toBe(2);
  });

  it("tuple source spreads index keys, holes skipped", () => {
    expect(
      litValue(call(`export function f() { return JSON.stringify({...[1,2]}); }`).result),
    ).toBe('{"0":1,"1":2}');
    expect(litValue(call(`export function f() { return ({...[1,2]})[0]; }`).result)).toBe(1);
    expect(
      litValue(call(`export function f() { return JSON.stringify({...[1,,3]}); }`).result),
    ).toBe('{"0":1,"2":3}');
  });

  it("primitive literal sources are ignored (spread of nothing)", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({...5}); }`).result)).toBe("{}");
    expect(litValue(call(`export function f() { return JSON.stringify({...null}); }`).result)).toBe("{}");
    expect(litValue(call(`export function f() { return JSON.stringify({...true}); }`).result)).toBe("{}");
  });

  it("later spread wins on index-key collisions", () => {
    expect(
      litValue(call(`export function f() { return JSON.stringify({...'ab', ...['X','Y','Z']}); }`).result),
    ).toBe('{"0":"X","1":"Y","2":"Z"}');
    expect(
      litValue(call(`export function f() { return JSON.stringify({0:'keep', ...'ab'}); }`).result),
    ).toBe('{"0":"a","1":"b"}');
  });

  it("unknown-length sources stay open (conservative)", () => {
    const src = `export function f(x) { return JSON.stringify({...x}); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const x = { shape: { k: "arr", element: unknown }, conf: "path" } as never;
    expect(litValue(callTranspiledExportFull(exports, "f", [x]).result)).toBe(undefined);
  });
});

describe("ast-eval parity", () => {
  it("spreads like B-path", () => {
    expect(litValue(analyzeFn(`function f() { return ({...'ab'})['1']; }`, "f", []))).toBe("b");
    expect(litValue(analyzeFn(`function f() { return ({...[1,2]})[0]; }`, "f", []))).toBe(1);
    expect(litValue(analyzeFn(`function f() { return JSON.stringify({...5}); }`, "f", []))).toBe("{}");
  });
});
