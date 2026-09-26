/**
 * JSON.parse / JSON.stringify 折叠与失败 THROW：
 * 此前 evalJsonMethod 恒返回 unknown（parse）/ strPrim（stringify）——
 * 字面量实参不折叠、非法输入不抛：
 * - JSON.parse('{bad') 原生 SyntaxError，B-path 静默成功 → catch 不进入，
 *   r 保持旧值（假精确）
 * - JSON.stringify(1n) 原生 TypeError，同样被静默吞掉
 * - JSON.parse('{"a":1}').a 原生 1，B-path 折 unknown（精度缺口）
 * 修复：字面量实参真执行（JSON 值 ↔ Abs 双向折叠）；语法失败硬抛
 * NudoThrow(SyntaxError)、序列化失败硬抛 NudoThrow(TypeError)——
 * B-path catch 经 $catchVal 吸收，ast-eval 在 namespace 调用点吸收为
 * EvalResult{threw}。抽象实参保持保守（parse → unknown，stringify →
 * strPrim）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

describe("B-path JSON.parse folding", () => {
  it("folds literal object/array/primitive results", () => {
    expect(litValue(call(`export function f() { return JSON.parse('{"a":1}').a; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return JSON.parse('[1,2,3]').length; }`).result)).toBe(3);
    expect(litValue(call(`export function f() { return JSON.parse('[1,2,3]')[1]; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return JSON.parse('42'); }`).result)).toBe(42);
    expect(litValue(call(`export function f() { return JSON.parse('"hi"'); }`).result)).toBe("hi");
    expect(litValue(call(`export function f() { return JSON.parse('true'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return JSON.parse('null'); }`).result)).toBe(null);
    expect(litValue(call(`export function f() { return JSON.parse('{"a":[1,{"b":2}]}').a[1].b; }`).result)).toBe(2);
  });

  it("__proto__ key is an own data property, not prototype pollution", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = JSON.parse('{"__proto__":{"p":1}}'); return o.p === undefined && "toString" in o; }`,
        ).result,
      ),
    ).toBe(true);
  });

  it("ToStrings non-string literal args (JSON.parse(42) ≡ 42)", () => {
    expect(litValue(call(`export function f() { return JSON.parse(42); }`).result)).toBe(42);
    expect(litValue(call(`export function f() { return JSON.parse(true); }`).result)).toBe(true);
  });
});

describe("B-path JSON.parse invalid input throws SyntaxError", () => {
  it("malformed literal string is caught", () => {
    for (const src of [
      `export function f() { try { JSON.parse('{bad'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse('nope'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse(''); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse('null x'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse(); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse(undefined); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });

  it("uncaughced parse failure interrupts with SyntaxError", () => {
    const r = call(`export function f() { return JSON.parse('{bad'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });
});

describe("B-path JSON.stringify folding", () => {
  it("folds literal values", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({a:1}); }`).result)).toBe(
      '{"a":1}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify([1,2]); }`).result)).toBe(
      "[1,2]",
    );
    expect(litValue(call(`export function f() { return JSON.stringify(null); }`).result)).toBe("null");
    expect(litValue(call(`export function f() { return JSON.stringify(42); }`).result)).toBe("42");
    expect(litValue(call(`export function f() { return JSON.stringify('x'); }`).result)).toBe('"x"');
    expect(litValue(call(`export function f() { return JSON.stringify(true); }`).result)).toBe("true");
  });

  it("NaN/Infinity serialize as null; sparse holes too", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({a:NaN}); }`).result)).toBe(
      '{"a":null}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify({a:Infinity}); }`).result)).toBe(
      '{"a":null}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify([1,,3]); }`).result)).toBe(
      "[1,null,3]",
    );
  });

  it("undefined/function slots are skipped; top-level undefined stays undefined", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({a:undefined,b:1}); }`).result)).toBe(
      '{"b":1}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify([undefined,null,1]); }`).result)).toBe(
      "[null,null,1]",
    );
    const r = call(`export function f() { return JSON.stringify(undefined); }`);
    const t = r.result as unknown as { term?: { op: string; value: unknown } };
    expect(t.term?.op).toBe("lit");
    expect(t.term?.value).toBe(undefined);
  });

  it("respects literal space/replacer args", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({x:1},null,2); }`).result)).toBe(
      '{\n  "x": 1\n}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify({a:1,b:2},['a']); }`).result)).toBe(
      '{"a":1}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify({a:1},null,'\\t'); }`).result)).toBe(
      '{\n\t"a": 1\n}',
    );
    // 非数组非函数的 replacer 原生忽略（照常序列化）
    expect(litValue(call(`export function f() { return JSON.stringify({a:1},5); }`).result)).toBe(
      '{"a":1}',
    );
    expect(litValue(call(`export function f() { return JSON.stringify({a:1},null); }`).result)).toBe(
      '{"a":1}',
    );
  });

  it("reviver arg stays conservative (per-key transform unmodeled)", () => {
    expect(
      litValue(
        call(
          `export function f() { return JSON.parse('{"a":1}', (k,v) => k === 'a' ? 9 : v).a; }`,
        ).result,
      ),
    ).toBe(undefined);
    expect(
      litValue(call(`export function f() { return JSON.parse('5', (k,v) => v + 1); }`).result),
    ).toBe(undefined);
  });

  it("skips non-enumerable slots (defineProperty descriptor honored)", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = {}; Object.defineProperty(o, 'x', {value: 1, enumerable: false}); return JSON.stringify(o); }`,
        ).result,
      ),
    ).toBe("{}");
    expect(
      litValue(
        call(
          `export function f() { const o = {}; Object.defineProperty(o, 'x', {value: 1, enumerable: false}); o.y = 2; return JSON.stringify(o); }`,
        ).result,
      ),
    ).toBe('{"y":2}');
  });

  it("stringify bigint throws TypeError (catchable)", () => {
    expect(
      litValue(call(`export function f() { try { JSON.stringify(1n); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toBe("caught");
    const r = call(`export function f() { return JSON.stringify(1n); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("abstract args stay conservative", () => {
    const src = `export function f(x) { return JSON.parse(x); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const x = { shape: { k: "prim", type: "string" }, conf: "path" } as never;
    expect(litValue(callTranspiledExportFull(exports, "f", [x]).result)).toBe(undefined);
  });
});

