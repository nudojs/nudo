/**
 * Bug 141 回归：async generator 的 **async 面**。
 *
 * ES 语义：`async function*`（及 `async *` 方法）返回 AsyncGenerator——
 * next()/return()/throw() 返回 **promise**（promise<iterResult>）、装
 * `@@asyncIterator` 自返方法、`Object.prototype.toString` 折
 * "[object AsyncGenerator]"，且**不**有 `@@iterator`（同步迭代面缺席）。
 *
 * 修复前：async generator 与同步 generator 同编（$gen 同步协议对象）——
 * next() 返回裸 iterResult（无 then）、无 @@asyncIterator、tag 折
 * "[object Object]"。
 *
 * 覆盖面：函数**表达式**面与 class **方法**面（async generator 声明面
 * `async function* g(){}` 走 transpile/stmt/statement.ts 的声明分支——
 * 不在本批修复范围，见交付报告）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 141 — async generator：async 面（promise 迭代协议）", () => {
  describe("函数表达式面", () => {
    it("next() 返回 promise（typeof next().then === function）", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g().next().then;`)),
      ).toEqual({ ok: true, value: "function" });
    });

    it("next() 的结果是 Promise 实例", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return g().next() instanceof Promise;`)),
      ).toEqual({ ok: true, value: true });
    });

    it("装 @@asyncIterator 自返方法", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g()[Symbol.asyncIterator];`)),
      ).toEqual({ ok: true, value: "function" });
    });

    it("Object.prototype.toString 折 [object AsyncGenerator]", () => {
      expect(
        v(
          wrap(
            `const g = async function*(){ yield 1; }; return Object.prototype.toString.call(g());`,
          ),
        ),
      ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
    });

    it("同步迭代面缺席（原生无 @@iterator）", () => {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g()[Symbol.iterator];`)),
      ).toEqual({ ok: true, value: "undefined" });
    });
  });

  describe("class 方法面", () => {
    it("async *m(){}：next() 返回 promise", () => {
      expect(
        v(wrap(`class A { async *m(){ yield 1; } } return typeof new A().m().next().then;`)),
      ).toEqual({ ok: true, value: "function" });
    });

    it("async *m(){}：装 @@asyncIterator", () => {
      expect(
        v(
          wrap(
            `class A { async *m(){ yield 1; } } return typeof new A().m()[Symbol.asyncIterator];`,
          ),
        ),
      ).toEqual({ ok: true, value: "function" });
    });

    it("async *m(){}：tag 折 [object AsyncGenerator]", () => {
      expect(
        v(
          wrap(
            `class A { async *m(){ yield 1; } } return Object.prototype.toString.call(new A().m());`,
          ),
        ),
      ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
    });
  });

  describe("负控制：同步 generator 不得回归", () => {
    it("next() 仍是裸函数（非 promise）", () => {
      expect(v(wrap(`function* g(){ yield 1; } return typeof g().next;`))).toEqual({
        ok: true,
        value: "function",
      });
    });

    it("同步 generator 仍有 @@iterator", () => {
      expect(v(wrap(`function* g(){ yield 1; } return typeof g()[Symbol.iterator];`))).toEqual({
        ok: true,
        value: "function",
      });
    });

    it("同步 generator 的 next() 不是 promise", () => {
      expect(
        v(wrap(`function* g(){ yield 1; } return g().next() instanceof Promise;`)),
      ).toEqual({ ok: true, value: false });
    });
  });
});
