import { describe, it, expect } from "vitest";
import { checkWeb, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 889 — env 把 JS **类**（`TextEncoder` / `TextDecoder`）建模成普通
 * 可调用函数 ⇒ 不带 `new` 的调用被判「成功返回、恒不抛」⇒ **L2 门禁假绿**。
 *
 * 根因：`envFn` 的 facet 面只能表达「可 `new`」（`ctor: true`），**不能**表达
 * 「不可裸调」⇒ 声明侧把类与函数混为一谈：
 * - `new TextDecoder(...)` 走「fn 无 ctor ⇒ 记 may-throw」分支 ⇒ 假红（Bug 860）；
 * - `TextDecoder(...)`（不写 `new`）走「普通 fn 可调」分支 ⇒ 恒不抛 ⇒ 假绿（本条）。
 *
 * 修法（已实测）：**删掉 web env 的 `TextEncoder` / `TextDecoder` 声明** ⇒
 * 回落宿主 ⇒ 裸调用记 TypeError、`new` 调用干净。
 *
 * 原生 oracle（node v26.10.0）：
 *   TextEncoder()          → TypeError: Class constructor TextEncoder cannot be
 *                            invoked without 'new'
 *   TextDecoder("utf-8")   → TypeError: Class constructor TextDecoder cannot be
 *                            invoked without 'new'
 *   new TextEncoder()      → OK
 *
 * 反向钉：把 TextEncoder / TextDecoder 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("Bug 889 — TextEncoder / TextDecoder are classes, not plain functions", () => {
  it("TextEncoder / TextDecoder are NOT declared in the web env", () => {
    expect(webEnvGlobals()["TextEncoder"]).toBeUndefined();
    expect(webEnvGlobals()["TextDecoder"]).toBeUndefined();
  });

  it("bare TextEncoder() records TypeError (native: class without new)", () => {
    const out = checkWeb(`export function f(){ return TextEncoder(); }`);
    expect(out.throwBrands).toContain("TypeError");
  });

  it("bare TextDecoder('utf-8') records TypeError (native: class without new)", () => {
    const out = checkWeb(`export function f(){ return TextDecoder("utf-8"); }`);
    expect(out.throwBrands).toContain("TypeError");
  });

  it("new TextEncoder() / new TextDecoder() are clean", () => {
    const out = checkWeb(`export function f(){
  const e = new TextEncoder();
  const d = new TextDecoder();
  return [e, d];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("the env path and the host path agree on the bare-call verdict", () => {
    const withEnv = checkWeb(`export function f(){ return TextEncoder(); }`, true);
    const hostOnly = checkWeb(`export function f(){ return TextEncoder(); }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("TypeError");
  });
});
