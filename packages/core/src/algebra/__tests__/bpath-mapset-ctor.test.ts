/**
 * B 路径 Set/Map 构造器 iterable 语义：
 * - new Set(str) 按 code point 展开字符串（此前 elementsFrom 只认 tuple/arr →
 *   恒空集 size=0 假精确）
 * - new Set(set)/new Map(map) 拷贝条目表（此前同样空）
 * - new Map(entries) 的条目必须是对象——prim 条目原生 TypeError
 *   （"Iterator value … is not an entry object"），此前静默忽略/部分吞掉
 * - 非可迭代实参（number/bool/symbol、闭对象）原生 TypeError，此前折空容器
 * 修复：elementsFrom 增 string/Set/Map 分支；ctorArgDefinitelyInvalid 判定
 * 确定非法实参，B 路径 $new 硬抛 NudoThrow(TypeError)（catch 可吸收），
 * ast-eval（evalNewCtor）同判定折 unknown（THROW 域口径）。
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

function throwsTypeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "TypeError";
}

describe("B-path Set/Map constructors", () => {
  it("new Set(string) iterates code points", () => {
    expect(litValue(call(`export function f() { return new Set('aab').size; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return [...new Set('aab')].length; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return [...new Set('aab')][0]; }`).result)).toBe("a");
    expect(litValue(call(`export function f() { return [...new Set('aab')][1]; }`).result)).toBe("b");
    expect(litValue(call(`export function f() { return new Set('').size; }`).result)).toBe(0);
    expect(litValue(call(`export function f() { return new Set('😀😀').size; }`).result)).toBe(1);
  });

  it("new Set(set) copies entries", () => {
    expect(litValue(call(`export function f() { return new Set(new Set([1,2,2])).size; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return [...new Set(new Set([3,1]))][0]; }`).result)).toBe(3);
    expect(litValue(call(`export function f() { return [...new Set(new Set([3,1]))][1]; }`).result)).toBe(1);
  });

  it("new Map(map) copies entries", () => {
    expect(litValue(call(`export function f() { return new Map(new Map([[1,'a']])).size; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return new Map(new Map([[1,'a']])).get(1); }`).result)).toBe("a");
  });

  it("Map with primitive entries throws TypeError", () => {
    for (const src of [
      `export function f() { return new Map([1]).size; }`,
      `export function f() { return new Map([[1,2],3]).size; }`,
      `export function f() { return new Map('ab').size; }`,
      `export function f() { return new Map([['a',1],'b']).size; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(true);
    }
  });

  it("Map TypeError is catchable", () => {
    expect(
      litValue(
        call(
          `export function f() { try { new Map([1]); } catch(e) { return 'caught'; } return 'missed'; }`,
        ).result,
      ),
    ).toBe("caught");
  });

  it("non-iterable Set args throw TypeError", () => {
    for (const src of [
      `export function f() { return new Set(5).size; }`,
      `export function f() { return new Set({}).size; }`,
      `export function f() { return new Set(true).size; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsTypeError(r.throws), src).toBe(true);
    }
  });

  it("empty-string Map is valid (zero items)", () => {
    expect(litValue(call(`export function f() { return new Map('').size; }`).result)).toBe(0);
  });

  it("null/undefined iterable stay empty containers", () => {
    expect(litValue(call(`export function f() { return new Set(null).size; }`).result)).toBe(0);
    expect(litValue(call(`export function f() { return new Map(undefined).size; }`).result)).toBe(0);
  });

  it("entry tuple shapes still fill literal maps (regression)", () => {
    expect(litValue(call(`export function f() { return new Map([[1,2],[1,3]]).get(1); }`).result)).toBe(3);
    expect(litValue(call(`export function f() { return new Map([[1,2],[1,3]]).size; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return new Map([['a',1]]).get('a'); }`).result)).toBe(1);
  });
});
