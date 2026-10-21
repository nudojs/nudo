/**
 * Bug 181 收尾（批次 r21-w15）：解构临时名的**首次分配**也必须避让用户
 * 标识符。
 *
 * 背景：主体修复（Bug 181 本体）把避让接在**解构发射入口**
 * （emit.ts 的 emitDestructure / 形参绑定）——但模块**首条语句**即解构
 * 声明时，`_d{n}` 这个名字在避让生效**之前**就被分配（statement.ts 的
 * 首次取号处）⇒ 用户自己声明了 `_d0` 时，生成码出现**重复词法声明**
 * （`const _d0` + 用户的 `let _d0`）⇒ SyntaxError ⇒ **整个模块**求值
 * 失败 ⇒ 全部导出退化为 unknown（假 nudo:opaque-result）。
 *
 * 修法：共享计数器在**创建处**（transpile.ts）即预置避让（序号推过用户
 * 占用的 `_d{n}` / `_n{n}`），且首次取号处再走一次避让路径（覆盖自带
 * 计数器的转译单元）。
 */
import { describe, it, expect } from "vitest";
import { val, callLit } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import { transpileSource } from "../exec/transpile.ts";

/** 带实参调用 f 的字面量结果 */
const v = (src: string, ...args: unknown[]): { ok: boolean; value?: unknown } =>
  litValue(callLit(src, "f", ...args).result) as { ok: boolean; value?: unknown };

/** 调用具名导出的字面量结果 */
const callName = (
  src: string,
  name: string,
  ...args: unknown[]
): { ok: boolean; value?: unknown } =>
  litValue(callLit(src, name, ...args).result) as { ok: boolean; value?: unknown };

describe("Bug 181 收尾：解构临时名首次分配的避让", () => {
  it("模块首条语句即解构声明 + 用户模块级 _d0：模块可求值且值正确", () => {
    expect(
      val(`const { a } = { a: 1 };
const _d0 = 5;
export function f() { return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("后续语句解构 + 用户模块级 _d0：模块可求值且值正确", () => {
    expect(
      val(`const _d0 = 5;
const { a } = { a: 1 };
export function f() { return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("模块首条语句即嵌套解构 + 用户模块级 _n1：模块可求值且值正确", () => {
    expect(
      val(`const { a: { b } } = { a: { b: 1 } };
const _n1 = 5;
export function f() { return b + _n1; }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("模块级 fail-closed 面解除：无关函数不再被拖成 unknown", () => {
    const src = `const { a } = { a: 1 };
const _d0 = 5;
export function g() { return 42; }
export function f() { return a + _d0; }`;
    // 撞名时整模块求值失败 ⇒ g 也退化；修后 g 可正常调用
    expect(callName(src, "g")).toEqual({ ok: true, value: 42 });
    expect(callName(src, "f")).toEqual({ ok: true, value: 6 });
  });

  it("两处解构 + 用户模块级 _d0：模块可求值且值正确", () => {
    expect(
      val(`const { a } = { a: 1 };
const { c } = { c: 2 };
const _d0 = 5;
export function f() { return a + c + _d0; }`),
    ).toEqual({ ok: true, value: 8 });
  });

  it("产物不与用户同名绑定重复声明（临时名让开）", () => {
    const js = transpileSource(`const { a } = { a: 1 };
const _d0 = 5;
export function f() { return a + _d0; }`);
    // 引擎的解构临时名不得取用户已占用的 _d0（否则重复词法声明）
    expect(js).not.toMatch(/const _d0\b/);
    // 用户自己的声明仍在（转译器把 const 降为 let）
    expect(js).toMatch(/let _d0 =/);
  });

  it("负控制：无撞名时临时名与行为不变", () => {
    expect(val(`const { a } = { a: 1 }; export function f() { return a; }`)).toEqual({
      ok: true,
      value: 1,
    });
    const js = transpileSource(
      `const { a } = { a: 1 }; const { b } = { b: 2 }; export function f() { return a + b; }`,
    );
    const names = [...js.matchAll(/const (_d\d+) =/g)].map((m) => m[1]);
    expect(names).toEqual(["_d0", "_d1"]);
  });

  it("负控制：用户 _d0 在函数体内（跨作用域）不受影响", () => {
    expect(
      val(`const { a } = { a: 1 };
export function f() { let _d0 = 5; return a + _d0; }`),
    ).toEqual({ ok: true, value: 6 });
  });

  it("负控制：形参占位名族（_p0）与 rest 族（_rest0）不受影响", () => {
    expect(
      v(`const { a } = { a: 1 };
export function f({ b }) { let _p0 = 5; return a + b + _p0; }`, { b: 2 }),
    ).toEqual({ ok: true, value: 8 });
    expect(
      v(`const { a } = { a: 1 };
export function f([...xs]) { let _rest0 = 5; return a + xs.length + _rest0; }`, [1, 2]),
    ).toEqual({ ok: true, value: 8 });
  });
});
