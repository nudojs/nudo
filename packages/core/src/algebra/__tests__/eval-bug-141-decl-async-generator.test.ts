/**
 * Bug 141 回归（续作）：async generator 的**声明面**
 * （`async function* g(){}` 语句形态）。
 *
 * ES 语义：`async function*` 返回 AsyncGenerator——next()/return()/throw()
 * 返回 **promise**、装 `@@asyncIterator` 自返方法、`Object.prototype.toString`
 * 折 "[object AsyncGenerator]"，且**不**有 `@@iterator`（同步迭代面缺席）。
 *
 * 修复前：声明面仍被编成**同步** generator（`$gen(() => {…})` 未透 async 位）
 * ⇒ next() 返回裸 iterResult（无 then）、无 @@asyncIterator、tag 折
 * "[object Object]"，且错误地带上了同步迭代面（@@iterator）。
 *
 * 声明面与函数**表达式**面 / class **方法**面（已修，见
 * eval-bug-141-async-generator.test.ts）同属一条语义线；本文件只补声明面。
 *
 * 不变量（负控制钉住）：同步 generator 声明仍是同步协议（无 then、有
 * @@iterator）；async **函数**（非 generator）声明仍返回 promise。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 嵌套声明（函数体内的 `async function* g(){}`） */
const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 141 — async generator 声明面：async 面（promise 迭代协议）", () => {
  it("嵌套声明：next() 返回 promise（typeof next().then === function）", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("嵌套声明：next() 的结果是 Promise 实例", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("嵌套声明：装 @@asyncIterator 自返方法", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g()[Symbol.asyncIterator];`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("嵌套声明：Object.prototype.toString 折 [object AsyncGenerator]", () => {
    expect(
      v(
        wrap(
          `async function* g(){ yield 1; } return Object.prototype.toString.call(g());`,
        ),
      ),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  });

  it("嵌套声明：同步迭代面缺席（原生无 @@iterator）", () => {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g()[Symbol.iterator];`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("模块级声明：next() 返回 promise", () => {
    expect(
      v(`async function* g(){ yield 1; }
         export function f() { return typeof g().next().then; }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("模块级声明：装 @@asyncIterator + tag 折 [object AsyncGenerator]", () => {
    expect(
      v(`async function* g(){ yield 1; }
         export function f() { return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  });
});

describe("Bug 141 — 负控制：同步 generator / async 函数声明不得回归", () => {
  it("同步 generator 声明：next() 不是 promise", () => {
    expect(
      v(wrap(`function* g(){ yield 1; } return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("同步 generator 声明：仍有 @@iterator", () => {
    expect(
      v(wrap(`function* g(){ yield 1; } return typeof g()[Symbol.iterator];`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("同步 generator 声明：next() 仍是裸函数（无 then）", () => {
    expect(
      v(wrap(`function* g(){ yield 1; } return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("async 函数（非 generator）声明：仍返回 promise", () => {
    expect(
      v(wrap(`async function g(){ return 1; } return typeof g().then;`)),
    ).toEqual({ ok: true, value: "function" });
  });
});
