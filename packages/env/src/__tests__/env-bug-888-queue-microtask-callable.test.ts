import { describe, it, expect } from "vitest";
import { checkWeb, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 888 — web env 的 `queueMicrotask` 声明**挡掉** core 的可调用实参校验。
 *
 * 根因：env 的 `queueMicrotask` 是一条**纯类型声明** ⇒ 引擎把该全局整体换成
 * env 声明路径 ⇒ core 的 `blockHostSideEffect` / `validateCallableArg`
 * （`packages/core/src/algebra/exec/calls.ts:290-298`）**根本没被调用** ⇒
 * 非可调用实参的 TypeError 丢失 ⇒ L2 门禁**假绿**（去掉 env 指令反而判红）。
 *
 * 修法（已实测）：**删掉 web env 的 `queueMicrotask` 声明** ⇒ 回落宿主 ⇒ core
 * 的 `validateCallableArg` 生效 ⇒ 记 TypeError。
 *
 * 原生 oracle（node v26.10.0）：
 *   queueMicrotask(1) → TypeError: The "callback" argument must be of type
 *                        function. Received type number (1)
 *
 * 反向钉：把 `queueMicrotask` 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("Bug 888 — queueMicrotask keeps core's callable-arg validation", () => {
  it("queueMicrotask is NOT declared in the web env", () => {
    expect(webEnvGlobals()["queueMicrotask"]).toBeUndefined();
  });

  it("queueMicrotask(1) records TypeError (native throws)", () => {
    const out = checkWeb(`export function f(){ queueMicrotask(1); return 1; }`);
    expect(out.throwBrands).toContain("TypeError");
  });

  it("the env path and the host path agree", () => {
    const withEnv = checkWeb(`export function f(){ queueMicrotask(1); return 1; }`, true);
    const hostOnly = checkWeb(`export function f(){ queueMicrotask(1); return 1; }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("TypeError");
  });

  it("a callable callback is not reported as a TypeError", () => {
    const out = checkWeb(`export function f(){ queueMicrotask(function () {}); return 1; }`);
    expect(out.throwBrands).not.toContain("TypeError");
  });
});
