/**
 * B 路径 instanceof 的 @@hasInstance 语义：RHS 是对象且带 Symbol.hasInstance
 * 方法时，instanceof 调用它（v instanceof o ≡ o[Symbol.hasInstance](v)），
 * 而非查原型链。此前 \$instanceof 只拿 RHS 的**名字**做内建/class 派发，
 * 自定义 @@hasInstance 完全忽略（5 instanceof o 折 false）。
 * 修复：transpile 对 `Symbol.X` 计算键投影为 "@@X" 字符串槽（镜像
 * m[Symbol.iterator] 投影）；instanceof Identifier RHS 把值作第三参传入，
 * \$instanceof 读到 "@@hasInstance" 可调用槽则调用并把结果布尔化。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path instanceof @@hasInstance", () => {
  it("custom Symbol.hasInstance returning true", () => {
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return true; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toBe(true);
  });

  it("custom Symbol.hasInstance returning false", () => {
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return false; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toBe(false);
  });

  it("hasInstance receives the left operand", () => {
    expect(
      litValue(
        call(
          `export function f() { let got = null; let o = {[Symbol.hasInstance](v){ got = v; return true; }}; 5 instanceof o; return got; }`,
        ).result,
      ),
    ).toBe(5);
  });

  it("hasInstance can discriminate values", () => {
    const src = `export function f(n) { let o = {[Symbol.hasInstance](v){ return v === 5; }}; return n instanceof o; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const abstractNum = { shape: { k: "prim", type: "number" }, conf: "exact" } as never;
    const r = callTranspiledExportFull(exports, "f", [abstractNum]);
    // 抽象 n：v===5 无法判定 → 结果保持抽象 boolean（非具体，不折真/假）
    expect(litValue(r.result)).toBe(undefined);
  });

  it("object without hasInstance falls back to prototype chain", () => {
    expect(
      litValue(call(`export function f() { let o = {}; return 5 instanceof o; }`).result),
    ).toBe(false);
    expect(
      litValue(call(`export function f() { let o = {}; return o instanceof Object; }`).result),
    ).toBe(true);
  });

  it("builtin and class instanceof unaffected", () => {
    expect(litValue(call(`export function f() { return [] instanceof Array; }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return 's' instanceof String; }`).result)).toBe(false);
    expect(
      litValue(call(`export function f() { class A {} return new A() instanceof A; }`).result),
    ).toBe(true);
  });

  it("hasInstance returning non-boolean is coerced", () => {
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return 0; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toBe(false);
    expect(
      litValue(
        call(
          `export function f() { let o = {[Symbol.hasInstance](v){ return 'yes'; }}; return 5 instanceof o; }`,
        ).result,
      ),
    ).toBe(true);
  });
});
