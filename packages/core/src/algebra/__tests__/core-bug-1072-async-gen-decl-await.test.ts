/**
 * Bug 1072 回归：async generator **声明**体里的 `await` 不得发射成裸 `yield`。
 *
 * 背景：`async function*` 声明（`export async function* f(){}` /
 * `export default async function*(){}` / 嵌套声明）的体被编译成
 * `$gen(() => {…}, true)`——体是**普通箭头**，不是宿主生成器 ⇒ 体里的
 * `await` 若按 async **函数**口径发射成裸 `yield`（`(yield …)`），产物
 * **不是合法 JS** ⇒ `new Function` 编译期 SyntaxError（Unexpected strict
 * mode reserved word）⇒ **整模块**求值失败（fail-closed）⇒ 全部导出退化
 * unknown/opaque ⇒ **L2 门禁（`nudo:entry-may-throw`）不再触发 ⇒ 门禁假绿**。
 *
 * 三条兄弟路径（函数**表达式** / 对象**方法** / class **方法**）都有
 * `generator !== true` 守卫（async generator 的体不是宿主生成器 ⇒ await
 * 走 `$await(…)` 兜底），**只有声明路径漏了**。
 *
 * 修法：`transpile/stmt/statement.ts` 的声明面 async 挂起判定与兄弟路径
 * 对齐——`stmt.async === true && stmt.generator !== true` 才做 async 挂起
 * 计划 ⇒ async generator 体走 `$await(…)`（不再是裸 `yield`）。
 *
 * 断言口径：
 * - 门禁面：同文件的**其它**导出（`risky()`）仍报 `nudo:entry-may-throw`
 *   （error 级）⇒ 修前整模块 fail-closed ⇒ 该诊断消失（假绿）。
 * - 产物面：转译产物里 async generator 体内**不得有裸 `yield`**（`$yield(…)`
 *   是显式 `yield` 表达式的正常发射，与 await 无关）。
 * - 产出面：async generator 自身的元素仍正确（for-await 累加精确）。
 */
import { describe, it, expect } from "vitest";
import { transpileSource, checkSource, pTrue } from "../index.ts";
import { litValue } from "../abs.ts";
import type { Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { l2Count, sigOf } from "./nudo-constraints.ts";

/** 剥外层 promise（async 函数面：返回值恒 promise<内层>） */
function unwrapPromise(a: Abs): Abs {
  return a.shape.k === "eff" && a.shape.eff === "promise" ? a.shape.inner : a;
}

/** async 函数体的求值结果（剥 promise 后的字面量值） */
function v(src: string, fnName = "f") {
  return litValue(unwrapPromise(call(src, fnName).result));
}

/** check 门禁的整文件报告 */
function report(src: string) {
  return checkSource("/t/async-gen-decl.js", src, pTrue, {});
}

/** 诊断码集 */
function codes(src: string): string[] {
  return report(src).issues.map((i) => i.code);
}

/** 触发源：async generator 声明 + 另一个必抛导出（L2 门禁探针） */
const SRC = `export function risky(){ throw new Error("boom"); }
export async function* f(){ await Promise.resolve(1); yield 1; }`;

describe("Bug 1072 — async generator 声明体的 await 不发射裸 yield", () => {
  it("转译产物里 async generator 体内没有裸 yield（修前：`(yield …)` ⇒ 非法 JS）", () => {
    const js = transpileSource(SRC, { source: SRC });
    expect(js).not.toContain("(yield ");
    // 显式 `yield` 表达式仍走 $yield（与 await 无关）
    expect(js).toContain("$yield(");
    // await 走 $await 兜底（async generator 体不是宿主生成器）
    expect(js).toContain("$await(");
  });

  it("整模块不再 fail-closed：其它导出的 L2 门禁仍触发（修前：诊断消失 ⇒ 假绿）", () => {
    const r = report(SRC);
    expect(l2Count(r, "risky")).toBe(1);
    expect(r.issues.find((i) => i.code === "nudo:entry-may-throw")?.severity).toBe("error");
  });

  it("其它导出的签名不退化 unknown（修前：risky 退成 `risky() => unknown`）", () => {
    expect(sigOf(report(SRC), "risky")).not.toBe("unknown");
    expect(sigOf(report(SRC), "risky")).toBe(sigOf(report(`export function risky(){ throw new Error("boom"); }`), "risky"));
  });

  it("无假 nudo:opaque-result（修前：整模块 unknown ⇒ 假 opaque 诊断）", () => {
    expect(codes(SRC)).not.toContain("nudo:opaque-result");
  });

  it("async generator 自身的产出仍正确（for-await 累加精确 7）", () => {
    const src = `export async function* f(){ await Promise.resolve(1); yield 7; }
export async function g(){ let t = 0; for await (const v of f()) t += v; return t; }`;
    expect(v(src, "g")).toEqual({ ok: true, value: 7 });
  });

  it("async generator 声明仍是 AsyncGenerator 协议（next() 返 promise）", () => {
    const src = `export async function* f(){ await Promise.resolve(1); yield 1; }
export function g(){ return typeof f().next().then; }`;
    expect(v(src, "g")).toEqual({ ok: true, value: "function" });
  });

  it("export default async function* 形态：整模块不再 fail-closed", () => {
    const src = `export function risky(){ throw new Error("boom"); }
export default async function* g(){ await Promise.resolve(1); yield 1; }`;
    const js = transpileSource(src, { source: src });
    expect(js).not.toContain("(yield ");
    expect(l2Count(report(src), "risky")).toBe(1);
  });

  it("嵌套声明形态（函数体内的 async function*）：整模块不再 fail-closed", () => {
    const src = `export function risky(){ throw new Error("boom"); }
export function h(){ async function* g(){ await Promise.resolve(1); yield 1; } return typeof g().next().then; }`;
    const js = transpileSource(src, { source: src });
    expect(js).not.toContain("(yield ");
    expect(l2Count(report(src), "risky")).toBe(1);
    expect(v(src, "h")).toEqual({ ok: true, value: "function" });
  });
});

describe("Bug 1072 负控制：兄弟路径与同步/async 声明不得回归", () => {
  it("同步 generator 声明：体里的 yield 仍走 $yield（不是 $await）", () => {
    const src = `export function* g(){ yield 1; }`;
    const js = transpileSource(src, { source: src });
    expect(js).toContain("$yield(");
    expect(js).not.toContain("(yield ");
  });

  it("async **函数**（非 generator）声明：await 仍发射裸 yield（真挂起点）", () => {
    const src = `export async function h(){ await Promise.resolve(1); return 2; }`;
    const js = transpileSource(src, { source: src });
    expect(js).toContain("(yield ");
  });

  it("async generator **表达式**面（兄弟路径）不受影响：await 走 $await", () => {
    const src = `export function f(){ const g = async function*(){ await Promise.resolve(1); yield 1; }; return typeof g().next().then; }`;
    const js = transpileSource(src, { source: src });
    expect(js).not.toContain("(yield ");
  });
});
