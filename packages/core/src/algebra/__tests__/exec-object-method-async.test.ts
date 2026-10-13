/**
 * Bug 70（对象字面量 async 方法）：ObjectMethod 分支此前只包 $gen
 * （generator），无 prop.async 处理——`{ async m() {} }` 丢 async 修饰，
 * 调用返回裸体值（1）而非 Promise（instanceof Promise false、
 * toString [object Number]、constructor !== Promise、两次调用恒等）。
 *
 * 修复：async 方法体包 $async（镜像类方法 stmt.ts 路径；async *m()
 * 双包——$gen 内、$async 外）。
 */
import { describe, it, expect } from "vitest";
import { litValue, formatShape } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { diffBody } from "./differential/harness.ts";

describe("Bug 70: 对象字面量 async 方法返回 Promise", () => {
  it("o.m() instanceof Promise → true", () => {
    const r = call(
      `export function f() { const o = { async m() { return 1; } }; return o.m() instanceof Promise; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.prototype.toString.call(o.m()) → [object Promise]", () => {
    const r = call(
      `export function f() { const o = { async m() { return 1; } }; return Object.prototype.toString.call(o.m()); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "[object Promise]" });
  });

  it("o.m().constructor === Promise → true", () => {
    const r = call(
      `export function f() { const o = { async m() { return 1; } }; return o.m().constructor === Promise; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("o.m() === o.m() 不再恒 true（两个 distinct promise；非字面量折 boolean 域 ⊇ native false）", () => {
    const r = call(
      `export function f() { const o = { async m() { return 1; } }; return o.m() === o.m(); }`,
    );
    // 修复前 wrong-exact true；现与类方法孪生同折抽象 boolean（sound）
    expect(r.result.shape.k).toBe("prim");
  });

  it("o.m().then((x) => x+1) → promise<2>（与类方法/函数表达式孪生同口径）", () => {
    const r = call(
      `export function f() { const o = { async m() { return 1; } }; return o.m().then((x) => x + 1); }`,
    );
    // then 链引擎口径：resolved 通道折 promise<值>（三形态孪生一致）
    expect(formatShape(r.result)).toBe("promise<2>");
  });

  it("computed-key async 方法 {[k]: async …} 同修", () => {
    const r = call(
      `export function f() { const k = "m"; const o = { [k]: async function() { return 2; } }; return o.m() instanceof Promise; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it("类方法孪生不回归（class A { async m() {} }）", () => {
    const r = call(
      `export function f() { class A { async m() { return 1; } } return new A().m() instanceof Promise; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });
});

describe("Bug 70: differential native 对照（隐式 return 体）", () => {
  const corpus = [
    `const o = { async m() { return 1; } }; return o.m() instanceof Promise;`,
    `const o = { async m() { return 1; } }; return Object.prototype.toString.call(o.m());`,
    `const o = { async m() { return 1; } }; return o.m().constructor === Promise;`,
    `const o = { async m() { return 3; }, n: 1 }; return o.n + (o.m() instanceof Promise ? 10 : 0);`,
  ];
  it.each(corpus.map((body, i) => [i, body] as const))(
    "语料 #%i 与 native 一致",
    (_i, body) => {
      expect(diffBody(body)).toBeNull();
    },
  );
});
