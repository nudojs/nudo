/**
 * new RegExp(pattern, flags) 非法实参不抛（假精确）+ 字面量不折叠：
 * 此前 B-path $new 的 RegExp 分支只查 pattern 是否为字符串字面量就直接
 * $regex()——非法 pattern（'['）/非法 flags（'z'、'gg'）原生 SyntaxError
 * 被静默吞掉，catch 不进入（r 保持旧值假精确）；无参/数字 pattern 不折叠。
 * ast-eval 侧 evalRegExpCtor 恒 path brand，同样不抛；且 ast-eval 的
 * new Map([1])/new Set(5) 非法实参折 unknown（THROW 域口径）——evalTry
 * 无 soft 记录不 join catch，catch 假精确不进。
 * 修复：tryMakeRegexAbs 共用（字面量真构造验证，非法 SyntaxError/
 * TypeError 硬抛，合法折叠精确 brand；抽象保守）；evalBuiltinNew 的
 * Map/Set 改硬抛 NudoThrow(TypeError)（与 B-path $new 同口径），
 * ast-eval NewExpression 吸收 NudoThrow 为 EvalResult{threw}。
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

describe("B-path new RegExp invalid args throw", () => {
  it("invalid pattern/flags are caught", () => {
    for (const src of [
      `export function f() { try { new RegExp('['); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { new RegExp('a', 'z'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { new RegExp('a', 'gg'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { new RegExp('a', 5); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { new RegExp('a', null); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { new RegExp('a', true); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });

  it("uncaught invalid pattern interrupts with SyntaxError", () => {
    const r = call(`export function f() { return new RegExp('[').test('a'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });
});

describe("B-path new RegExp literal folding", () => {
  it("folds no-arg / number / string patterns", () => {
    expect(litValue(call(`export function f() { return new RegExp().test('x'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return new RegExp().source; }`).result)).toBe("(?:)");
    expect(litValue(call(`export function f() { return new RegExp(5).test('a5b'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { return new RegExp(5).source; }`).result)).toBe("5");
    expect(litValue(call(`export function f() { return new RegExp('a', 'g').flags; }`).result)).toBe("g");
    expect(litValue(call(`export function f() { return new RegExp('', 'g').source; }`).result)).toBe("(?:)");
    expect(litValue(call(`export function f() { return new RegExp('a', undefined).flags; }`).result)).toBe("");
  });

  it("folds exec/test against literal subjects", () => {
    expect(litValue(call(`export function f() { return new RegExp('ab+').test('abb'); }`).result)).toBe(true);
    expect(litValue(call(`export function f() { const m = new RegExp('(a)(b)').exec('ab'); return m[1] + m[2]; }`).result)).toBe("ab");
  });

  it("abstract pattern stays conservative", () => {
    const src = `export function f(p) { return new RegExp(p).test('a'); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const p = { shape: { k: "prim", type: "string" }, conf: "path" } as never;
    expect(litValue(callTranspiledExportFull(exports, "f", [p]).result)).toBe(undefined);
  });
});

