/**
 * BUG-008 回归：`Object/Reflect.getOwnPropertyDescriptor(fn, key)` 不得被建模成
 * 「必定抛」。
 *
 * 根因：`packages/core/src/algebra/builtins/object/methods.ts` 的
 * `case "getOwnPropertyDescriptor"` 有 obj / tuple / string / prim / brand 接收者
 * 臂，但**没有 `fn` 形态接收者臂** ⇒ 函数接收者一路落兜底 `maybeDesc()`
 * （descriptor | undefined 并集）⇒ 再读 `.value` / `.writable` 就成**定抛
 * TypeError** ⇒ 整条表达式折 `never`（假 TypeError——引擎比原生更悲观）。
 * `Reflect.getOwnPropertyDescriptor`（`builtins/reflect.ts`）共用同一 helper，
 * 同样受影响。
 *
 * 修法：为 `fn` 形态接收者补一条描述符臂（`name` / `length` / `prototype` 是
 * 函数**自有属性**，原生恒有描述符 ⇒ 折精确描述符而非并集）。
 */
import { describe, it, expect } from "vitest";
import { call, val, throwsError } from "./eval-helpers.ts";

const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

const wrap = (body: string): string => `export function f() { ${body} }`;

describe("BUG-008：函数 / 类接收者的 getOwnPropertyDescriptor（不再定抛）", () => {
  it("gOPD(function f(){}, \"length\").value ⇒ 0（原生精确值）", () => {
    expect(lit(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "length").value;'))).toBe(0);
  });

  it("gOPD(function f(){}, \"name\").writable ⇒ false（原生 false）", () => {
    expect(
      lit(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "name").writable;')),
    ).toBe(false);
  });

  it("gOPD(function f(){}, \"name\").value ⇒ 字符串（不抛、不折 never）", () => {
    const rec = call(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "name").value;'));
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
    expect(
      lit(wrap('return typeof Object.getOwnPropertyDescriptor(function f(){}, "name").value;')),
    ).toBe("string");
  });

  it("gOPD(class A {}, \"name\").value ⇒ \"A\"（原生精确值）", () => {
    expect(lit(wrap('return Object.getOwnPropertyDescriptor(class A {}, "name").value;'))).toBe("A");
  });

  it("gOPD(function f(){}, \"prototype\").writable ⇒ true（普通函数可写）", () => {
    expect(
      lit(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "prototype").writable;')),
    ).toBe(true);
  });

  it("gOPD(class A {}, \"prototype\").writable ⇒ false（类值不可写）", () => {
    expect(
      lit(wrap('return Object.getOwnPropertyDescriptor(class A {}, "prototype").writable;')),
    ).toBe(false);
  });

  it("Reflect.getOwnPropertyDescriptor(fn, \"name\").value ⇒ 不抛", () => {
    const rec = call(
      wrap('return Reflect.getOwnPropertyDescriptor(function f(){}, "name").value;'),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  });

  it("对照组：普通对象的描述符面仍正确（回归控制）", () => {
    expect(lit(wrap('return Object.getOwnPropertyDescriptor({a:1},"a").value;'))).toBe(1);
  });
});
