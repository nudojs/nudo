/**
 * B 路径容器引用语义：`const b = a` / 函数参数传递共享同一数组（对象），
 * 一侧 mutator/写必须对另一侧可见。此前 Abs 走值语义——mutator 返回新 Abs
 * 只重绑当前名，别名读旧值（`b.push(4)` 后 a.length 折 3，原生 4）。
 * 修复：容器写就地进行（Abs 对象身份不变，别名自动同步）；fork/switch
 * 快照与循环 pack 必须深拷贝，防止分析分支/迭代互相污染。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { abs } from "../abs.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

/** 抽象条件分支测试：参数是抽象 number（truthy 判定未知 → 两臂都探索） */
function callFork(src: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", [
    abs({ k: "prim", type: "number" }, undefined, undefined, "path"),
  ]);
}

describe("B-path container reference semantics", () => {
  it("alias sees push/pop/unshift/shift", () => {
    const r = call(`export function f() { const a = [1,2,3]; const b = a; b.push(4); return a.length; }`);
    expect(litValue(r.result)).toBe(4);
    const r2 = call(`export function f() { const a = [1,2,3]; const b = a; b.pop(); return a.length; }`);
    expect(litValue(r2.result)).toBe(2);
    const r3 = call(`export function f() { const a = [1,2]; const b = a; a.unshift(0); return b.length; }`);
    expect(litValue(r3.result)).toBe(3);
    const r4 = call(`export function f() { const a = [1,2,3]; const b = a; a.shift(); return b[0]; }`);
    expect(litValue(r4.result)).toBe(2);
  });

  it("alias sees index and length writes", () => {
    const r = call(`export function f() { const a = [1,2,3]; const b = a; b[0] = 9; return a[0]; }`);
    expect(litValue(r.result)).toBe(9);
    const r2 = call(`export function f() { const a = [1]; const b = a; b.length = 5; return a.length; }`);
    expect(litValue(r2.result)).toBe(5);
    const r3 = call(`export function f() { const a = [1,2,3]; const b = a; b.length = 5; return 4 in a; }`);
    expect(litValue(r3.result)).toBe(false);
  });

  it("object alias sees slot writes", () => {
    const r = call(`export function f() { const o = {x:1}; const b = o; b.x = 5; return o.x; }`);
    expect(litValue(r.result)).toBe(5);
  });

  it("function parameter mutation is visible at the caller", () => {
    const r = call(
      `export function f() { const a = [1,2]; function g(arr) { arr.push(3); } g(a); return a.length; }`,
    );
    expect(litValue(r.result)).toBe(3);
    const r2 = call(
      `export function f() { const a = [1,2]; const g = (arr) => { arr[0] = 9; }; g(a); return a[0]; }`,
    );
    expect(litValue(r2.result)).toBe(9);
  });

  it("copy methods stay independent (no aliasing)", () => {
    const r = call(`export function f() { const a = [1,2,3]; const b = a.slice(); b.push(4); return a.length; }`);
    expect(litValue(r.result)).toBe(3);
  });

  it("fork branches do not pollute each other", () => {
    // 抽象条件：两臂各自 push 一次，join 后长度恒 2（共享引用会折 2|3）
    const r = callFork(
      `export function f(x) { const a = [1]; if (x) { a.push(2); } else { a.push(3); } return a.length; }`,
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("fork branches isolate nested containers (deep copy)", () => {
    // 嵌套数组元素必须深拷贝：真臂 pop 不得污染假臂的 o.arr
    const r = callFork(
      `export function f(x) { const o = { arr: [1, 2, 30] }; if (x) { o.arr.pop(); } return o.arr[2]; }`,
    );
    expect([undefined, 30]).toContain(litValue(r.result)); // undefined | 30
    const r2 = callFork(
      `export function f(x) { const o = { arr: [1, 2, 30] }; if (x) { o.arr.pop(); } return o.arr.length; }`,
    );
    expect(litValue(r2.result)).toBe(undefined); // 2 | 3 非具体（sound）
    // 隔离生效的标志：两臂长度不同 → 非具体；浅拷贝污染会折精确 2
    const r3 = callFork(
      `export function f(x) { const m = [[1], [2]]; if (x) { m[0].push(9); } return m[0].length; }`,
    );
    expect(litValue(r3.result)).toBe(undefined); // 2 | 1 非具体
  });

  it("switch arms do not pollute each other", () => {
    const r = callFork(
      `export function f(x) { const a = [1]; switch (x) { case 1: a.push(2); break; default: a.push(3); } return a.length; }`,
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("loop iterations keep the accumulated state", () => {
    const r = call(`export function f() { const acc = []; for (let i = 0; i < 3; i++) { acc.push(i); } return acc.length; }`);
    expect(litValue(r.result)).toBe(3);
    const r2 = call(`export function f() { const acc = []; for (let i = 0; i < 3; i++) { acc.push(i); } return acc[2]; }`);
    expect(litValue(r2.result)).toBe(2);
  });

  it("regression: read paths stay value-like", () => {
    const r = call(`export function f() { const a = [1,2,3]; const b = a; return b[1]; }`);
    expect(litValue(r.result)).toBe(2);
    const r2 = call(`export function f() { const a = [1,2,3]; const b = a; b.push(4); return b.length; }`);
    expect(litValue(r2.result)).toBe(4);
  });
});
