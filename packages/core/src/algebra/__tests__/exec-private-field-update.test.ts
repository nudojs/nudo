/**
 * Bug 80（私有字段 ++/--/逻辑赋值）：UpdateExpression 与逻辑赋值
 * （||=/&&=/??=）的 MemberExpression 臂只认 memberPathOf——PrivateName
 * 非 computed 且非 Identifier → null → 落 update:++ / assign:||=
 * NudoUnsupportedError，一个 `this.#n++` 令整模块 fail-closed（全导出
 * unknown + nudo:opaque-result）。
 *
 * 修复：operators.ts UpdateExpression / assignment.ts 逻辑赋值补
 * PrivateName 臂——"#x" 混淆键槽读-改-写（与既有普通/复合私有名赋值
 * 同口径）；后缀值 = ToNumeric 旧值且表达式内立刻写回。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { transpileSource } from "../exec/transpile.ts";
import { call } from "./eval-helpers.ts";

const run = (src: string) => litValue(call(src).result);

describe("Bug 80: 私有字段自增/自减（此前整模块 fail-closed）", () => {
  it("this.#x++; return this.#x → 2（写回在表达式内生效）", () => {
    expect(
      run(`export function f() { class C { #x = 1; bump() { this.#x++; return this.#x; } } return new C().bump(); }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("return this.#x++ → 旧值 1（后缀值语义）", () => {
    expect(
      run(`export function f() { class C { #x = 1; bump() { return this.#x++; } } return new C().bump(); }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("return ++this.#x → 新值 2（前缀值语义）", () => {
    expect(
      run(`export function f() { class C { #x = 1; bump() { return ++this.#x; } } return new C().bump(); }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("this.#x-- / --this.#x → 0（自减双形）", () => {
    expect(
      run(`export function f() { class C { #x = 1; dec() { this.#x--; return this.#x; } } return new C().dec(); }`),
    ).toEqual({ ok: true, value: 0 });
    expect(
      run(`export function f() { class C { #x = 1; dec() { return --this.#x; } } return new C().dec(); }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("transpileSource 不再抛 unsupported（此前 update:++ 令模块 fail-close）", () => {
    expect(() =>
      transpileSource(`class C { #x = 1; bump() { this.#x++; } }`),
    ).not.toThrow();
  });
});

describe("Bug 80: 私有字段逻辑赋值（||= / &&= / ??=）", () => {
  it("this.#x ||= v：truthy 保留 / falsy 写入", () => {
    expect(
      run(`export function f() { class C { #x = 1; b() { this.#x ||= 9; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      run(`export function f() { class C { #x = 0; b() { this.#x ||= 9; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("this.#x &&= v：truthy 写入 / falsy 保留", () => {
    expect(
      run(`export function f() { class C { #x = 1; b() { this.#x &&= 9; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 9 });
    expect(
      run(`export function f() { class C { #x = 0; b() { this.#x &&= 9; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 0 });
  });

  it("this.#x ??= v：nullish 写入 / 非 nullish 保留", () => {
    expect(
      run(`export function f() { class C { #x = 1; b() { this.#x ??= 9; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      run(`export function f() { class C { #x = null; b() { this.#x ??= 9; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("静态私有字段 C.#n++（此前同落 unsupported）", () => {
    expect(
      run(`export function f() { class C { #x = 10; static #n = 4; static bump() { C.#n++; return C.#n; } } return C.bump(); }`),
    ).toEqual({ ok: true, value: 5 });
  });
});

describe("Bug 80 controls：既有私有名面不回归", () => {
  it("this.#x += 1 / = 7 / #m() / #x in o（普通/复合赋值与方法面）", () => {
    expect(
      run(`export function f() { class C { #x = 1; b() { this.#x += 1; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      run(`export function f() { class C { #x = 1; b() { this.#x = 7; return this.#x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      run(`export function f() { class C { #m() { return 1; } go() { return this.#m(); } } return new C().go(); }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      run(`export function f() { class C { #x = 1; has(o) { return #x in o; } } return new C().has(new C()); }`),
    ).toEqual({ ok: true, value: true });
  });

  it("公有字段 this.x++（memberPath 臂）不回归", () => {
    expect(
      run(`export function f() { class C { x = 1; b() { this.x++; return this.x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      run(`export function f() { class C { x = 1; b() { return ++this.x; } } return new C().b(); }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("不可写回根（o.m().x++）仍 fail-closed unsupported", () => {
    expect(() => transpileSource(`function f(o) { return o.m().x++; }`)).toThrow(
      /update:/,
    );
  });
});
