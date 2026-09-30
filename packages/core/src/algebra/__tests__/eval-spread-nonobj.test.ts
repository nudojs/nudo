/**
 * 对象 spread 的非对象源未建模（假精确）：
 * 原生 {...'ab'} → {0:'a', 1:'b'}（code unit 数字键）、{...[1,2]} →
 * {0:1, 1:2}（下标键、hole 跳过）、{...5}/{...null} → {}（prim 忽略）。
 * evaluator $spread 与 ast-eval ObjectExpression 对非 obj 源只标 open——
 * 空对象字面量 base 折 {}（假精确）。
 * 修复：spread 对字符串字面量/元组源投影数字键槽合并；prim 字面量源
 * 忽略；不可判定（抽象字符串/arr）保持 open 保守。
 * 字符串 own keys 是 UTF-16 code unit（astral 两键），不是 for-of code point。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, unknown } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("evaluator object spread of non-object sources", () => {
  it("string source spreads code-unit index keys", () => {
    expect(
      litValue(call(`export function f() { return JSON.stringify({...'ab'}); }`).result),
    ).toEqual({ ok: true, value: '{"0":"a","1":"b"}' });
    expect(litValue(call(`export function f() { return ({...'ab'})['1']; }`).result)).toEqual({ ok: true, value: "b" });
    // surrogate pair 按 code unit（𠮷 两个键），与 Object.keys 一致
    expect(
      litValue(call(`export function f() { return Object.keys({...'a\u{20BB7}'}).length; }`).result),
    ).toEqual({ ok: true, value: 3 });
  });

  it("tuple source spreads index keys, holes skipped", () => {
    expect(
      litValue(call(`export function f() { return JSON.stringify({...[1,2]}); }`).result),
    ).toEqual({ ok: true, value: '{"0":1,"1":2}' });
    expect(litValue(call(`export function f() { return ({...[1,2]})[0]; }`).result)).toEqual({ ok: true, value: 1 });
    expect(
      litValue(call(`export function f() { return JSON.stringify({...[1,,3]}); }`).result),
    ).toEqual({ ok: true, value: '{"0":1,"2":3}' });
  });

  it("primitive literal sources are ignored (spread of nothing)", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({...5}); }`).result)).toEqual({ ok: true, value: "{}" });
    expect(litValue(call(`export function f() { return JSON.stringify({...null}); }`).result)).toEqual({ ok: true, value: "{}" });
    expect(litValue(call(`export function f() { return JSON.stringify({...true}); }`).result)).toEqual({ ok: true, value: "{}" });
  });

  it("later spread wins on index-key collisions", () => {
    expect(
      litValue(call(`export function f() { return JSON.stringify({...'ab', ...['X','Y','Z']}); }`).result),
    ).toEqual({ ok: true, value: '{"0":"X","1":"Y","2":"Z"}' });
    expect(
      litValue(call(`export function f() { return JSON.stringify({0:'keep', ...'ab'}); }`).result),
    ).toEqual({ ok: true, value: '{"0":"a","1":"b"}' });
  });

  it("unknown-length sources stay open (conservative)", () => {
    const src = `export function f(x) { return JSON.stringify({...x}); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const x = { shape: { k: "arr", element: unknown }, conf: "path" } as never;
    expect(litValue(callTranspiledExportFull(exports, "f", [x]).result)).toEqual({ ok: false });
  });
});

