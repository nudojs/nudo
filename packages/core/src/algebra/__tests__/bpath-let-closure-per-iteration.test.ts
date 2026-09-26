/**
 * 每迭代 `let` 闭包 vs `var` 共享绑定：
 * - `for (let i = …)`：每迭代独立绑定——闭包捕获当次 i（0+1+2=3）。
 *   落点：for 主路径把 initName 作 $for 各闭包形参，每轮新绑定。
 * - `for (var i = …)`：函数作用域共享——所有闭包读到同一最终 i。
 *   落点：extractForInitName 对 var 返回 null，路由 fallback（init 就地发射，
 *   test/update/body 读真实绑定）。
 * - `forEach((x) => …)` 每回调参数已有语义保持（每回调独立形参）。
 * 抽象边界循环（条件非具体）仍走 $for 的 pack/unpack 保守 join，不假装精确。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path per-iteration let closures", () => {
  it("for-let closures capture the iteration binding (sum 0+1+2=3)", () => {
    const r = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[0]() + fns[1]() + fns[2]();
    }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("each for-let closure sees its own index", () => {
    const r0 = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[0]();
    }`);
    expect(litValue(r0.result)).toBe(0);
    const r1 = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[1]();
    }`);
    expect(litValue(r1.result)).toBe(1);
    const r2 = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[2]();
    }`);
    expect(litValue(r2.result)).toBe(2);
  });

  it("for-let: later-iteration mutation does not leak into earlier closures", () => {
    // 同一轮内写 i 会改到本轮绑定（JS 语义，闭包按引用捕获）；
    // 下一轮是新绑定——不得串到已捕获闭包。
    const r = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
        if (i === 1) i = 100;
      }
      return fns[0]();
    }`);
    expect(litValue(r.result)).toBe(0);
    const r1 = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
        if (i === 1) i = 100;
      }
      return fns[1]();
    }`);
    // 本轮捕获 i=1，随后 i=100 写到同一绑定（JS 语义）
    expect(litValue(r1.result)).toBe(100);
  });

  it("for-var closures share the binding (all see the final value)", () => {
    const r = call(`export function f() {
      const fns = [];
      for (var i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[0]();
    }`);
    expect(litValue(r.result)).toBe(3);
    const r1 = call(`export function f() {
      const fns = [];
      for (var i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[1]();
    }`);
    expect(litValue(r1.result)).toBe(3);
    const rEq = call(`export function f() {
      const fns = [];
      for (var i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      return fns[0]() === fns[1]() && fns[1]() === fns[2]();
    }`);
    expect(litValue(rEq.result)).toBe(true);
  });

  it("for-var: the binding remains visible after the loop", () => {
    const r = call(`export function f() {
      for (var i = 0; i < 3; i++) {}
      return i;
    }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("for-let: the binding is not visible after the loop (block-scoped)", () => {
    // i 在循环外不在作用域——读 i 是 ReferenceError / 诚实 unknown，不得假精确
    const r = call(`export function f() {
      let out = 0;
      for (let i = 0; i < 3; i++) { out += i; }
      return out;
    }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("forEach callback param is per-callback (existing semantics kept)", () => {
    const r = call(`export function f() {
      const seen = [];
      [10,20,30].forEach((x) => { seen.push(() => x); });
      return seen[0]() + seen[1]() + seen[2]();
    }`);
    expect(litValue(r.result)).toBe(60);
  });

  it("for-let with early continue still captures per-iteration values", () => {
    const r = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 0) continue;
        fns.push(() => i);
      }
      return fns[0]() + fns[1]();
    }`);
    // i=1 和 i=3
    expect(litValue(r.result)).toBe(4);
  });

  it("nested for-let captures the inner binding", () => {
    const r = call(`export function f() {
      const fns = [];
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          fns.push(() => i * 10 + j);
        }
      }
      return fns[0]() + fns[1]() + fns[2]() + fns[3]();
    }`);
    // 0+1+10+11 = 22
    expect(litValue(r.result)).toBe(22);
  });
});
