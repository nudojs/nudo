/**
 * B 路径 Object() 装箱：Object(prim) 返回包装对象（ToObject），不是原值。
 * 此前 evalGlobalFn 无 "Object" 分支——调用落到真实 JS Object(absObj)：
 * Abs 都是对象，恒等返回 → typeof Object(5) 折 "number"（原生 "object"）、
 * String(Object(null)) 折 "null"（原生 "[object Object]"）。
 * 修复：evalGlobalFn 增 Object 分支——字面量 prim 装箱为对应 brand
 * （String 箱带 length/下标槽），null/undefined/无参 → 空对象，
 * 对象形态恒等返回（ToObject 不变式），抽象 prim → open 对象。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path Object() boxing", () => {
  it("Object(number) is a boxed object", () => {
    expect(litValue(call(`export function f() { return typeof Object(5); }`).result)).toBe("object");
  });

  it("Object(null) / Object(undefined) / Object() are plain objects", () => {
    expect(litValue(call(`export function f() { return typeof Object(null); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { return typeof Object(undefined); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { return typeof Object(); }`).result)).toBe("object");
  });

  it("Object(string) keeps string-wrapper reads", () => {
    expect(litValue(call(`export function f() { return typeof Object('s'); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { return Object('ab').length; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return Object('ab')[0]; }`).result)).toBe("a");
  });

  it("Object(boolean) is a boxed object", () => {
    expect(litValue(call(`export function f() { return typeof Object(true); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { return typeof Object(false); }`).result)).toBe("object");
  });

  it("nested Object() boxing stays object", () => {
    expect(litValue(call(`export function f() { return typeof Object(Object(5)); }`).result)).toBe("object");
  });

  it("Object on object shapes is identity (ToObject)", () => {
    expect(litValue(call(`export function f() { return typeof Object([]); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { return Object({a: 1}).a; }`).result)).toBe(1);
    expect(litValue(call(`export function f() { return typeof Object({a: 1}); }`).result)).toBe("object");
  });

  it("new Object(prim) stays object-shaped", () => {
    expect(litValue(call(`export function f() { return typeof new Object(5); }`).result)).toBe("object");
    expect(litValue(call(`export function f() { return typeof new Object(); }`).result)).toBe("object");
  });
});

describe("B-path new String() wrapper slots", () => {
  // $new 通用 branch 折空 slots 包装——new String('ab')['0'] / .length
  // 折 undefined（原生 'a' / 2），Object.assign({}, boxed) 折 {}。
  it("new String(string) keeps length and index slots", () => {
    expect(litValue(call(`export function f() { return new String('ab').length; }`).result)).toBe(2);
    expect(litValue(call(`export function f() { return new String('ab')['0']; }`).result)).toBe("a");
    expect(litValue(call(`export function f() { return new String('ab')['1']; }`).result)).toBe("b");
    expect(litValue(call(`export function f() { return new String('ab')['2']; }`).result)).toBe(undefined);
    expect(litValue(call(`export function f() { return typeof new String('ab'); }`).result)).toBe("object");
  });

  it("new String(string) is an assignable wrapper source", () => {
    expect(litValue(call(`export function f() { return Object.assign({}, new String('ab'))['0']; }`).result)).toBe("a");
    expect(
      litValue(call(`export function f() { return Object.keys(Object.assign({}, new String('ab'))).length; }`).result),
    ).toBe(2);
  });

  it("non-literal arg stays conservative", () => {
    const r = call(`export function f(s) { return new String(s).length; }`);
    expect(litValue(r.result)).toBeUndefined();
  });
});
