/**
 * String.replace/replaceAll 折叠缺失（假精确 + 精度缺口）：
 * callAbsMethod 此前对 replace/replaceAll 恒折 strPrim——回调从未被调用
 * （'a1b2'.replace(/\d/g, () => n++) 副作用计数折 0，原生 2，假精确）、
 * 字符串替换串不折叠、replaceAll 非全局正则原生 TypeError 不抛。
 * 修复：字面量 receiver + 字面量 pattern（字符串/RegExp brand）真执行——
 * 字符串 repl 按 $ 模式展开；fn repl 逐命中桥接 Abs 回调（副作用真实
 * 执行，参数 (match, ...groups, offset, whole)，返回值 ToString，非具体
 * 结果整体保守 strPrim）；replaceAll 非全局正则硬抛 NudoThrow(TypeError)。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { analyzeFn } from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("B-path string replace folding", () => {
  it("string patterns fold", () => {
    expect(litValue(call(`export function f() { return 'abc'.replace('b', 'X'); }`).result)).toBe("aXc");
    expect(litValue(call(`export function f() { return 'abc'.replace('z', 'X'); }`).result)).toBe("abc");
    expect(litValue(call(`export function f() { return 'a-b-c'.replaceAll('-', '+'); }`).result)).toBe("a+b+c");
    expect(litValue(call(`export function f() { return 'aaa'.replaceAll('a', 'b'); }`).result)).toBe("bbb");
  });

  it("regex patterns fold with $ substitution", () => {
    expect(litValue(call(`export function f() { return 'abc'.replace(/b/, 'X'); }`).result)).toBe("aXc");
    expect(litValue(call(`export function f() { return 'abc'.replace(/b/g, 'X'); }`).result)).toBe("aXc");
    expect(litValue(call(`export function f() { return 'abc'.replace(/(b)(c)/, '$2$1'); }`).result)).toBe("acb");
    expect(litValue(call(`export function f() { return 'xyz'.replace(/y/, '<$&>'); }`).result)).toBe("x<y>z");
    // 未匹配的 $n 保留字面（ES GetSubstitution：无对应捕获组不改写）
    expect(litValue(call(`export function f() { return 'abc'.replace(/b/, '[$1]'); }`).result)).toBe("a[$1]c");
    expect(litValue(call(`export function f() { return 'abc'.replace(/(b)/, '[$1][$2]'); }`).result)).toBe("a[b][$2]c");
  });

  it("callback repl is invoked per match with (match, ...groups, offset, whole)", () => {
    expect(
      litValue(call(`export function f() { return 'abc'.replace('b', (m, i) => String(i)); }`).result),
    ).toBe("a1c");
    expect(
      litValue(call(`export function f() { return 'a1b2'.replace(/\\d/g, (m, i) => m + '@' + i); }`).result),
    ).toBe("a1@1b2@3");
    expect(
      litValue(
        call(`export function f() { return 'ab'.replace(/(a)(b)/, (m, p1, p2, off, whole) => p1 + '|' + p2 + '|' + off + '|' + whole); }`).result,
      ),
    ).toBe("a|b|0|ab");
  });

  it("callback side effects run (no more fake zero count)", () => {
    expect(
      litValue(
        call(`export function f() { let n = 0; 'a1b2c3'.replace(/\\d/g, () => { n++; return 'X'; }); return n; }`).result,
      ),
    ).toBe(3);
    expect(
      litValue(call(`export function f() { let n = 0; 'aaa'.replace('a', () => { n++; return 'X'; }); return n; }`).result),
    ).toBe(1);
    expect(
      litValue(call(`export function f() { let n = 0; 'aaa'.replaceAll('a', () => { n++; return 'X'; }); return n; }`).result),
    ).toBe(3);
  });

  it("callback return value is ToStringed", () => {
    expect(litValue(call(`export function f() { return 'a1'.replace(/\\d/, () => 99); }`).result)).toBe("a99");
    expect(litValue(call(`export function f() { return 'abc'.replace('b', () => null); }`).result)).toBe("anullc");
  });

  it("replaceAll with non-global regex throws TypeError", () => {
    expect(
      litValue(call(`export function f() { try { 'a-b'.replaceAll(/-/, (m) => m); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toBe("caught");
    expect(
      litValue(call(`export function f() { try { 'a-b'.replaceAll(/-/, 'X'); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toBe("caught");
    const r = call(`export function f() { return 'a-b'.replaceAll(/-/, 'X'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsTypeError(r.throws)).toBe(true);
  });
});

describe("ast-eval replace parity", () => {
  it("folds and throws like B-path", () => {
    expect(litValue(analyzeFn(`function f() { return 'abc'.replace('b', 'X'); }`, "f", []))).toBe("aXc");
    expect(
      litValue(analyzeFn(`function f() { return 'a1b2'.replace(/\\d/g, (m, i) => m + '@' + i); }`, "f", [])),
    ).toBe("a1@1b2@3");
    // 回调副作用写回是 ast-eval 既有缺口（非本类）；折叠与 THROW 同 B-path
    expect(
      litValue(analyzeFn(`function f() { try { 'a-b'.replaceAll(/-/, 'X'); } catch(e) { return 'caught'; } return 'missed'; }`, "f", [])),
    ).toBe("caught");
  });
});
