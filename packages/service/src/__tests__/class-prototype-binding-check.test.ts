/**
 * BUG-188 门禁面：`X.prototype` 按绑定驻留。
 *
 * 两个同名但不同绑定的类（不同作用域 / 模块）各有自己的原型对象：
 * 一处 `A.prototype.m = fn` 不得让另一处的 `new A().m()` 变成可调用 ⇒
 * 原生必抛 TypeError 的导出必须报 `nudo:entry-may-throw`（而非假绿）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { l2Count } from "./check-helpers.ts";

function check(label: string, source: string) {
  return checkSource(label, source, pTrue, {});
}

describe("check 门禁：同名不同绑定类的 prototype 不共享", () => {
  it("BUG-188 一处写 A.prototype.m、另一处 new A().m()：caller 报 may throw TypeError", () => {
    const r = check(
      "/t/b188-same.js",
      `export function setup() { class A {} A.prototype.m = function () { return 1; }; return 1; }
export function caller() { class A {} return new A().m(); }`,
    );
    expect(l2Count(r, "caller")).toBe(1);
    const sig = r.signatures.find((s) => s.name === "caller")?.display ?? "(missing)";
    expect(sig).toContain("throws TypeError");
  });

  it("BUG-188 两个同名类各自写自己的 prototype：caller 保持 total 且读回自己的值", () => {
    const r = check(
      "/t/b188-sameclass.js",
      `export function setup() { class A {} A.prototype.m = function () { return 1; }; return 1; }
export function caller() { class A {} A.prototype.m = function () { return 2; }; return new A().m(); }`,
    );
    expect(l2Count(r, "caller")).toBe(0);
    const sig = r.signatures.find((s) => s.name === "caller")?.display ?? "(missing)";
    expect(sig).toContain("2");
  });

  it("BUG-188 function 声明形态同口径：同名 function 的 prototype 写不跨绑定泄漏", () => {
    const r = check(
      "/t/b188-funcs.js",
      `export function setup() { function A() {} A.prototype.m = function () { return "fn"; }; return 1; }
export function caller() { function A() {} return new A().m(); }`,
    );
    expect(l2Count(r, "caller")).toBe(1);
  });
});
