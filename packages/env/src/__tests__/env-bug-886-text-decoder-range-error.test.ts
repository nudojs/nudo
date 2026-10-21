import { describe, it, expect } from "vitest";
import { checkWeb, displayOf, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 886 — web env 的 `TextDecoder` 声明**遮蔽** core 精确的 `RangeError`。
 *
 * 根因：env 的 `TextDecoder` 只是一条**无 impl 的类型声明** ⇒ 引擎走 env 声明
 * 路径 ⇒ core 的 `makeTextDecoderAbs`（非法 encoding label ⇒ **RangeError**）
 * 从未被调用 ⇒ 落到 env 通用构造兜底（`new` 一个「可调用性未知的函数值」）
 * ⇒ 记 **TypeError** ⇒ `@nudo:throws` 门禁**双向翻转**
 * （RangeError 假红 / TypeError 假绿）。
 *
 * 修法（已实测）：**删掉 web env 的 `TextDecoder` 声明** ⇒ 回落宿主 ⇒ core 的
 * `makeTextDecoderAbs` 生效 ⇒ 记 **RangeError**。
 *
 * 原生 oracle（node v26.10.0）：`new TextDecoder("bad-$$")` →
 * `RangeError: The "bad-$$" encoding is not supported`。
 *
 * 反向钉：把 `TextDecoder` 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("Bug 886 — TextDecoder keeps core's precise RangeError", () => {
  it("TextDecoder is NOT declared in the web env (it shadowed core's exact model)", () => {
    expect(webEnvGlobals()["TextDecoder"]).toBeUndefined();
  });

  it("new TextDecoder('bad-$$') records RangeError (not TypeError)", () => {
    const out = checkWeb(`export function f(){ return new TextDecoder("bad-$$"); }`);
    expect(out.throwBrands).toContain("RangeError");
    expect(out.throwBrands).not.toContain("TypeError");
  });

  it("new TextDecoder() is clean", () => {
    const out = checkWeb(`export function f(){ return new TextDecoder(); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("the env path and the host path agree on the error brand", () => {
    const withEnv = checkWeb(`export function f(){ return new TextDecoder("bad-$$"); }`, true);
    const hostOnly = checkWeb(`export function f(){ return new TextDecoder("bad-$$"); }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("RangeError");
  });

  it("core's exact model still folds a known label (encoding slot)", () => {
    const out = checkWeb(`export function f(){ const d = new TextDecoder("utf-8"); return d.encoding; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^"utf-8"/);
  });
});
