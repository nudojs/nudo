/**
 * Bug 1153：L2 fail-closed **归因按可达性**（不是只按入口自身的源码跨度）。
 *
 * 根因：Bug 380 的 fail-closed 只对「不支持构造落在**入口自己的**跨度内」
 * 的入口发证据 ⇒ 同一段代码内联在入口里是红的，拆到顶层 helper 里就绿：
 *   `export function f(g) { return g().x++; }`              → L2（Bug 380）
 *   `export function f(g) { return h(g); } function h(g) { return g().x++; }`
 *                                                           → 零 error（假绿）
 *
 * 修法：归因 = 入口自身跨度 ∪ 入口**可达**的顶层绑定（`reachableTopBindings`
 * 的传递闭包：辅助函数 / 类；互递归靠 `seen` 收敛）。不可达的陪葬入口仍
 * **不**背账（不做过度断言）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts, l2Count, sigOf } from "./nudo-constraints.ts";

const CLEAN = `export function f() { return 1; }
export function safe() { return 2; }`;

describe("Bug 1153：fail-closed 归因按可达性（helper / 类 / CJS 形态）", () => {
  it("helper 里的不支持构造 ⇒ 调用它的入口 f 拿 L2；兄弟入口 safe 仍是 0", () => {
    const src = `export function f(g) { return h(g); }
export function safe() { return 1; }
function h(g) { return g().x++; }`;
    const r = checkSource("b1153-1.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(0);
    // 证据上屏（门禁过滤 ≠ 藏事实）
    expect(sigOf(r, "f")).toContain("throws");
    expect(r.ok).toBe(false);
  });

  it("两级 helper 链 ⇒ 传递闭包把构造归因到入口 f", () => {
    const src = `export function f(g) { return h(g); }
function h(g) { return k(g); }
function k(g) { return g().x++; }`;
    const r = checkSource("b1153-2.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("互递归 helper：闭包收敛（不挂死）且仍把环后的构造归因到入口 f", () => {
    const src = `export function f(g) { return a(g); }
function a(g) { return b(g); }
function b(g) { return a(g) || k(g); }
function k(g) { return g().x++; }`;
    const r = checkSource("b1153-3.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("类入口 C：构造器里的不支持构造 ⇒ 整个类入口 C 拿 L2", () => {
    const src = `export class C { constructor(g) { g().x++; } }`;
    const r = checkSource("b1153-4.js", src, pTrue, stdOpts);
    expect(l2Count(r, "C")).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("类方法入口 C.m：构造器里的不支持构造也归因（实例桥要跑构造器）", () => {
    const src = `export class C { constructor(g) { g().x++; } m() { return 1; } }`;
    const r = checkSource("b1153-5.js", src, pTrue, stdOpts);
    expect(l2Count(r, "C.m")).toBe(1);
  });

  it("类方法入口 C.m：**其它**方法的构造不归因（不是它的执行路径）", () => {
    const src = `export class C { m() { return 1; } n(g) { return g().x++; } }`;
    const r = checkSource("b1153-6.js", src, pTrue, stdOpts);
    expect(l2Count(r, "C.m")).toBe(0);
    expect(l2Count(r, "C.n")).toBe(1);
  });

  it("CJS exports.f = function …：入口形态可识别（改前：零 error）", () => {
    const src = `exports.f = function (g) { return g().x++; };`;
    const r = checkSource("b1153-7.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("CJS module.exports.f = 箭头 / module.exports = { f: … }：同口径", () => {
    const arrow = checkSource(
      "b1153-8.js",
      `module.exports.f = (g) => g().x++;`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(arrow, "f")).toBe(1);
    const obj = checkSource(
      "b1153-9.js",
      `module.exports = { f: function (g) { return g().x++; } };`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(obj, "f")).toBe(1);
  });

  it("负控：没人引用的 helper 里的构造 ⇒ 入口 f 仍是 0，ok 与干净模块一致", () => {
    const src = `function h(g) { return g().x++; }
export function f() { return 1; }`;
    const r = checkSource("b1153-10.js", src, pTrue, stdOpts);
    const clean = checkSource("b1153-clean.js", CLEAN, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.ok).toBe(clean.ok);
  });

  it("负控：只有不可达的类里含构造 ⇒ 入口 f 是 0", () => {
    const src = `export function f() { return 1; }
class D { constructor(g) { g().x++; } }`;
    const r = checkSource("b1153-11.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
  });

  it("正控：构造可达的类（f → helper → new K()）⇒ K 构造器里的构造归因到 f", () => {
    const src = `export function f() { return h(); }
function h() { return new K(); }
class K { constructor(g) { g().x++; } }`;
    const r = checkSource("b1153-12.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  });

  it("干净模块对照：零 L2（不因归因扩面而假红）", () => {
    const r = checkSource("b1153-13.js", CLEAN, pTrue, stdOpts);
    expect(l2Count(r)).toBe(0);
    expect(r.ok).toBe(true);
  });
});
