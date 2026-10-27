/**
 * 模块顶层**作用域边界**的直接 const 别名（fork / pack 绑定集的别名展开）。
 *
 * 背景：直接 const 别名（`const a = {...}; const b = a;`）的**身份**要跨
 * fork / pack 保持——臂内写 `a` 时快照须带上 `b`，否则臂结束重绑 `a` 会
 * 断开 `b` 的引用（自信错值）。别名组此前只在**函数体 / 方法体 / 嵌套块**
 * 三个边界上计算（fn-body.ts 的 transpileFnBodyStmts）——**模块顶层不是**
 * 其中之一：模块体是**逐语句**发射的（transpile.ts 的
 * transpileFileDetailed），从不经过 transpileFnBodyStmts ⇒ 模块作用域
 * **没有**别名组 ⇒ 顶层 fork（`if (…) { a.x = … }`）只快照 / 重绑 `a`
 * ⇒ 别名伙伴 `b` 仍指向 fork 前的对象 ⇒ 后续经 `a` 的写对 `b` 不可见
 * （native 5 / 引擎 1 —— **自信错值**）。
 *
 * 修法：模块顶层按**同一口径**算本层自有组（前导连续 const 声明里的直接
 * 别名）并下发（TranspileOptions.aliasGroups）；嵌套函数体按既有口径
 * **继承**该组并按自身遮蔽名过滤（未被遮蔽 ⇒ 保持身份；被遮蔽 ⇒ 丢组）。
 *
 * 钉：Gap A 程序与原生逐值一致（native 5）；无顶层别名的模块**不**把非
 * 别名伙伴拉进 fork 绑定集（护栏：发射产物不得出现多余的快照名）；嵌套
 * 继承 / 嵌套遮蔽 / 模块级块遮蔽 / import 前导 / export const 别名各钉
 * 一条。
 */
import { describe, it, expect } from "vitest";
import vm from "node:vm";

import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { transpileSource } from "../transpile.ts";
import { litValue } from "../../abs.ts";

/** 引擎侧：跑模块并调用导出函数，取字面量值（非字面量 ⇒ 抛，测试即红）。 */
function engineValue(src: string, fn: string, ...args: unknown[]): unknown {
  const exports = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(exports, fn, args as never);
  const v = litValue(r.result);
  if (!v.ok) {
    throw new Error(
      `expected literal result for ${fn}, got non-literal (conf=${r.result.conf})`,
    );
  }
  return v.value;
}

/**
 * 原生侧：同程序在 vm 里跑（script 口径——`export` 引导词剥掉），取同一
 * 表达式的值——native 是地真值。程序须是**无 import** 的（vm 不解析模块）。
 */
function nativeValue(src: string, expr: string): unknown {
  const script = src.replace(/^export\s+/gm, "");
  return vm.runInNewContext(`${script}\n${expr}`, Object.create(null), { timeout: 2000 });
}

/** 引擎值与原生值逐值对账（native 值在括号里）。 */
function expectParity(src: string, fn: string, expr: string): void {
  expect(engineValue(src, fn)).toBe(nativeValue(src, expr));
}

describe("模块顶层作用域边界：直接 const 别名跨 fork 保持身份", () => {
  it("Gap A：顶层 fork 后经 a 的写对别名伙伴 b 可见（native 5）", () => {
    const src = `const a = { v: 1 };
const b = a;
export function bump(v) { a.v = v; }
if (bump) { a.v = 3; }
a.v = 5;
export function read() { return b.v; }`;
    expectParity(src, "read", "read()");
    expect(engineValue(src, "read")).toBe(5);
  });

  it("Gap A（export const 形态）：别名组跨导出包装仍然成立（native 5）", () => {
    const src = `export const a = { v: 1 };
export const b = a;
export function bump(v) { a.v = v; }
if (bump) { a.v = 3; }
a.v = 5;
export function read() { return b.v; }`;
    expectParity(src, "read", "read()");
  });

  it("Gap A（import 前导）：import 声明不打断前导 const 别名 run（native 5）", () => {
    // import 的依赖模块求值发生在模块体之前，不观察本模块的别名绑定 ⇒
    // 别名声明仍在任何后续语句之前初始化 ⇒ 无 TDZ 风险 ⇒ 组仍成立。
    const src = `import { x } from "./m.js";
const a = { v: 1 };
const b = a;
export function bump(v) { a.v = v; }
if (bump) { a.v = 3; }
a.v = 5;
export function read() { return b.v; }`;
    expect(engineValue(src, "read")).toBe(5);
  });

  it("护栏：非别名的同名伙伴**不得**进 fork 绑定集（native 2）", () => {
    // `b` 是独立对象（不是 `a` 的别名）⇒ 顶层 fork 写 `a` 时不得把 `b`
    // 拉进快照 / 重绑集合（否则复制 / 重绑了一个无关绑定）。
    const src = `const a = { v: 1 };
const b = { v: 2 };
export function bump(v) { a.v = v; }
if (bump) { a.v = 3; }
a.v = 5;
export function read() { return b.v; }`;
    const code = transpileSource(src, { mode: "analyze" });
    expect(code).toContain("const __fk0_a = $copy(a, __fkCopyMemo);");
    expect(code).not.toContain("__fk0_b");
    expectParity(src, "read", "read()");
  });

  it("护栏：模块**无**顶层别名 ⇒ 发射产物逐字节不变（无多余快照名）", () => {
    const src = `const a = { v: 1 };
export function bump(v) { a.v = v; }
if (bump) { a.v = 3; }
a.v = 5;
export function read() { return a.v; }`;
    const code = transpileSource(src, { mode: "analyze" });
    // 只有被写的绑定进快照集（模块作用域没有别名组 ⇒ 不多不少）
    expect(code).toContain("const __fk0_a = $copy(a, __fkCopyMemo);");
    const snapshots = [...code.matchAll(/const (__fk0_\w+) = \$copy/g)].map((m) => m[1]);
    expect(snapshots).toEqual(["__fk0_a"]);
    expectParity(src, "read", "read()");
  });

  it("嵌套函数体**继承**模块组（未遮蔽）⇒ 写外层别名伙伴保持身份（native 5）", () => {
    // 模块组下发到嵌套函数体 ⇒ 体内 fork 写 `b` 时把 `a` 一起快照 /
    // 重绑 ⇒ 外层 a/b 身份不断 ⇒ 后续经 a 的写对 b 可见。
    const src = `const a = { v: 1 };
const b = a;
export function outer() {
  function inner(q) { if (q) { b.v = 3; } }
  inner(true);
  a.v = 5;
  return b.v;
}`;
    expectParity(src, "outer", "outer()");
  });

  it("嵌套函数体**遮蔽**别名成员 ⇒ 丢组（影子绑定是不同对象，native 3）", () => {
    const src = `const a = { v: 1 };
const b = a;
export function outer() {
  let b = { v: 9 };
  if (b) { b.v = 3; }
  a.v = 5;
  return b.v;
}`;
    expectParity(src, "outer", "outer()");
  });

  it("模块级块**遮蔽**别名成员 ⇒ 块内 fork 不得拉进模块伙伴（native 5）", () => {
    const src = `const a = { v: 1 };
const b = a;
{ let a = { v: 99 }; a.v = 3; }
a.v = 5;
export function read() { return b.v; }`;
    expectParity(src, "read", "read()");
  });

  it("模块级三元分支写别名成员 ⇒ 别名身份保持（native 5）", () => {
    const src = `const a = { v: 1 };
const b = a;
export function t(p) { p ? (a.v = 3) : 0; a.v = 5; return b.v; }`;
    expectParity(src, "t", "t(true)");
  });

  it("三级别名链（a → b → c）⇒ 并查集把整条链收进同一组（native [5, 5]）", () => {
    const src = `const a = { v: 1 };
const b = a;
const c = b;
export function bump(v) { a.v = v; }
if (bump) { a.v = 3; }
a.v = 5;
export function readB() { return b.v; }
export function readC() { return c.v; }`;
    expect(engineValue(src, "readB")).toBe(5);
    expect(engineValue(src, "readC")).toBe(5);
    expect(nativeValue(src, "[readB(), readC()]")).toEqual([5, 5]);
    // 组内三个成员都在快照集里
    const code = transpileSource(src, { mode: "analyze" });
    expect(code).toContain("const __fk0_a = $copy(a, __fkCopyMemo);");
    expect(code).toContain("const __fk0_b = $copy(b, __fkCopyMemo);");
    expect(code).toContain("const __fk0_c = $copy(c, __fkCopyMemo);");
  });
});
