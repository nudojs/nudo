/**
 * Bug 61：Symbol.for 容器键此前走抽象键臂 → fresh 未注册 symbol →
 * `Symbol.for([1]) === Symbol.for("1")` 错折 false。修复：键 ToString
 * 具体化（闭 tuple join(",") / 闭普通对象 "[object Object]"，复用模板
 * ToString 投影）→ 按具体串入注册表（与同串调用同一符号）；不可判定键
 * → 键 Abs 身份驻留（=== 退化 unknown 而非假 false），keyFor 保守
 * 抽象 string（不折 undefined）。
 */
import { describe, it, expect } from "vitest";
import { litValue, formatShape, anyAbs, unknown } from "@nudojs/core";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { call } from "./eval-helpers.ts";

describe("Bug 61: Symbol.for container-literal keys intern by ToString", () => {
  it("Symbol.for([1]) === Symbol.for(\"1\")", () => {
    expect(litValue(call(`export function f() { return Symbol.for([1]) === Symbol.for("1"); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("Symbol.for([1]) === Symbol.for([1]) — same-key interning", () => {
    expect(litValue(call(`export function f() { return Symbol.for([1]) === Symbol.for([1]); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("Symbol.for([1, 2]) === Symbol.for(\"1,2\")", () => {
    expect(litValue(call(`export function f() { return Symbol.for([1, 2]) === Symbol.for("1,2"); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("Symbol.for([]) === Symbol.for(\"\")", () => {
    expect(litValue(call(`export function f() { return Symbol.for([]) === Symbol.for(""); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("Symbol.for({a: 1}) === Symbol.for(\"[object Object]\")", () => {
    expect(litValue(call(`export function f() { return Symbol.for({a: 1}) === Symbol.for("[object Object]"); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("variable holding a container interns identically", () => {
    expect(litValue(call(`export function f() { const a = [1]; return Symbol.for(a) === Symbol.for("1"); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("primitive-literal keys stay correct (control)", () => {
    expect(litValue(call(`export function f() { return Symbol.for(123) === Symbol.for("123"); }`).result))
      .toEqual({ ok: true, value: true });
  });

  it("description reflects the stringified key", () => {
    expect(litValue(call(`export function f() { return Symbol.for([1]).description; }`).result))
      .toEqual({ ok: true, value: "1" });
  });

  it("keyFor reverses the interned container key", () => {
    expect(litValue(call(`export function f() { return Symbol.keyFor(Symbol.for([1])); }`).result))
      .toEqual({ ok: true, value: "1" });
  });

  it("abstract key: same Abs reuses one symbol (=== true), no wrong-definite false", () => {
    const exports = runTranspiled(
      `export function f(x) { return Symbol.for(x) === Symbol.for(x); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyAbs]);
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("distinct abstract keys degrade to unknown, never definite false", () => {
    // 原生：两个抽象键的串可能相等 → === 不可判（boolean 域），不得折 false
    const exports = runTranspiled(
      `export function f(x, y) { return Symbol.for(x) === Symbol.for(y); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyAbs, unknown]);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(false);
    expect(formatShape(r.result)).toBe("boolean");
  });

  it("keyFor on an abstract-key symbol stays an abstract string (not undefined)", () => {
    // 原生 keyFor 恒返注册 key 字符串——不得折 undefined（wrong-definite）
    const exports = runTranspiled(
      `export function f(x) { return Symbol.keyFor(Symbol.for(x)); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyAbs]);
    const lv = litValue(r.result);
    expect(lv.ok).toBe(false);
    expect(formatShape(r.result)).toBe("string");
  });
});
