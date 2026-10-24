/**
 * Bug 1155：转译器拒绝的构造落在**模块装载期**（module-init）代码里 ⇒
 * L2 fail-closed 归因给**每个**入口。
 *
 * 根因：Bug 380 / Bug 1153 的归因只认「入口自身跨度 ∪ 入口**可达**的顶层绑定」，
 * 而装载期代码（顶层语句体 / 顶层初始化表达式 / 类定义期的 `static {}`、
 * 静态字段初始化器、计算键、`extends` 表达式）不在任何入口的执行路径里 ⇒
 * 无人背账 ⇒ L2 静默转绿：
 *   `export function f(a) { return a.b; }`              → f 有 1 条真实 TypeError
 *   `const g = () => ({x:1}); g().x++;` 加上面两行     → 零 error（假绿）
 * 但装载期代码先于**任何**入口调用执行 ⇒ 转译器拒绝装载期构造时，每个入口的
 * total 性都不可判定（同一条 fail-closed 证据形状，`@nudo:throws` /
 * `--ignore-throws` 照常放行）。
 *
 * 边界：函数体 / 参数默认值（调用时跑）、实例字段初始化器 / 构造器 / 方法体
 * （`new` / 调用时跑）**不**算装载期 ⇒ 仍按 Bug 1153 的可达性归因（不可达
 * 的陪葬入口不背账）。
 *
 * **TS-only 声明语句例外（Bug 895）**：`namespace` / `import x = require()` 这类
 * 类型层 / 声明层语法的转译拒绝**不**是「入口可能抛」的证据（`.ts` 源码必须
 * 保持零诊断；`namespace` 体里「程序自己的抛」属 module-throw 族，门禁面已
 * 静默）⇒ 不做装载期归因，`nudo check` 与干净模块同判 OK。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts, l2Count, sigOf } from "./nudo-constraints.ts";

const G = `const g = () => ({ x: 1 });`;
const ENTRIES = `export function f(a) { return a.b; }
export function safe() { return 1; }`;

describe("Bug 1155：装载期的转译拒绝归因给每个入口", () => {
  it("顶层裸语句里的不支持构造 ⇒ f / safe 各 1 条 L2（改前：零 error）", () => {
    const src = `${G}
g().x++;
${ENTRIES}`;
    const r = checkSource("b1155-1.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
    expect(l2Count(r)).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("对照：干净孪生模块 ⇒ 只有 f 自己的 TypeError，safe 为 0", () => {
    const src = `${G}
${ENTRIES}`;
    const r = checkSource("b1155-2.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(0);
    expect(sigOf(r, "f")).toContain("TypeError");
  });

  it("顶层 const 初始化表达式（装载期求值）⇒ 每个入口各 1", () => {
    const src = `${G}
const z = g().y++;
${ENTRIES}`;
    const r = checkSource("b1155-3.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("**未被引用**的类的 static 块 ⇒ 每个入口各 1（类定义期就执行）", () => {
    const src = `${G}
class U { static { g().x++; } }
${ENTRIES}`;
    const r = checkSource("b1155-4.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
  });

  it("**未被引用**的类的静态字段初始化器 ⇒ 每个入口各 1", () => {
    const src = `${G}
class U { static z = g().y++; }
${ENTRIES}`;
    const r = checkSource("b1155-5.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
  });

  it("类定义期的计算键 / extends 表达式 ⇒ 每个入口各 1", () => {
    const key = checkSource(
      "b1155-6.js",
      `${G}
class U { [g().y++]() {} }
${ENTRIES}`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(key, "f")).toBe(1);
    expect(l2Count(key, "safe")).toBe(1);
    const ext = checkSource(
      "b1155-7.js",
      `${G}
class U extends (g().x++ ? Object : Object) {}
${ENTRIES}`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(ext, "f")).toBe(1);
    expect(l2Count(ext, "safe")).toBe(1);
  });

  it("负控：不可达 helper / 顶层函数声明的**函数体**（调用时才跑）⇒ 每个入口 0", () => {
    for (const src of [
      `${G}
function h() { return g().x++; }
${ENTRIES}`,
      `${G}
function h() { return delete (g() + 1); }
${ENTRIES}`,
    ]) {
      const r = checkSource("b1155-8.js", src, pTrue, stdOpts);
      expect(l2Count(r, "f")).toBe(0);
      expect(l2Count(r, "safe")).toBe(0);
      expect(r.ok).toBe(true);
    }
  });

  it("负控：实例字段初始化器 / 构造器 / 方法体、static 字段里的箭头体 ⇒ 每个入口 0", () => {
    for (const decl of [
      `class U { z = g().y++; }`,
      `class U { constructor() { g().y++; } m() { return g().y++; } }`,
      `class U { static z = () => g().y++; }`,
    ]) {
      const r = checkSource("b1155-9.js", `${G}
${decl}
${ENTRIES}`, pTrue, stdOpts);
      expect(l2Count(r, "f")).toBe(0);
      expect(l2Count(r, "safe")).toBe(0);
    }
  });

  it("Bug 895 回归：TS-only 声明语句（enum / namespace / 抽象类）⇒ 每个入口 0，ok 与干净同构一致", () => {
    const src = `export enum Color { Red = 1, Green = 2 }
export namespace NS { export const v = 1; }
export abstract class B { abstract m(): void; }
export const c = Color.Red;
export const n = NS.v;
export function f() { return 1; }
export function safe() { return 2; }`;
    const r = checkSource("b1155-13.ts", src, pTrue, stdOpts);
    const clean = checkSource(
      "b1155-14.ts",
      `export function f() { return 1; }
export function safe() { return 2; }`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(r)).toBe(0);
    expect(l2Count(r, "B")).toBe(0);
    expect(r.ok).toBe(clean.ok);
    expect(r.ok).toBe(true);
  });

  it("`import x = require()`（另一 TS-only 声明语句）同样不归因", () => {
    const r = checkSource(
      "b1155-15.ts",
      `import x = require("./nope.js");
export function f() { return 1; }
export function safe() { return 2; }`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("对照：namespace 之前的**非 TS** 顶层不支持构造仍每个入口 1", () => {
    const src = `${G}
g().x++;
export namespace NS { export const v = 1; }
export function f() { return 1; }
export function safe() { return 2; }`;
    const r = checkSource("b1155-16.ts", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("@nudo:throws Error 只放行申报的入口（safe 仍 1 条；证据上屏）", () => {
    const src = `${G}
g().x++;
/**
 * @nudo:throws Error
 */
export function f(a) { return a.b; }
export function safe() { return 1; }`;
    const r = checkSource("b1155-10.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
    expect(l2Count(r, "safe")).toBe(1);
    // 门禁过滤 ≠ 藏事实
    expect(sigOf(r, "f")).toContain("throws");
  });

  it("--ignore-throws Error 放行全部入口（证据仍上屏）", () => {
    const src = `${G}
g().x++;
${ENTRIES}`;
    const r = checkSource("b1155-11.js", src, pTrue, { ...stdOpts, ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "f")).toContain("throws");
    expect(sigOf(r, "safe")).toContain("throws");
  });

  it("干净模块对照：零 L2 / ok（归因扩面不假红）", () => {
    const r = checkSource(
      "b1155-12.js",
      `export function f() { return 1; }
export function safe() { return 2; }`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.ok).toBe(true);
  });
});
