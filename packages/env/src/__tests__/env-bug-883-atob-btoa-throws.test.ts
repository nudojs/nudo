import { describe, it, expect } from "vitest";
import { checkWeb, displayOf, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 883 — `@nudo:env web` 的 `atob` / `btoa` 吞掉宿主的
 * `DOMException(InvalidCharacterError)` ⇒ 恒不抛 ⇒ **L2 门禁假绿**。
 *
 * 根因：web env 把宿主实现包在 `try/catch` 里（catch 分支 `return undefined`）
 * ⇒ 「抛」与「不抛」塌成同一个返回值；再叠加 `envFn` 的 apply 包装的
 * `catch { return returnType }` ⇒ 第二层吞异常 ⇒ 无论宿主抛不抛都记「不抛」。
 *
 * 修法（已实测）：**删掉 env 的 atob / btoa 声明** ⇒ 回落宿主路径 ⇒ core 的
 * `GLOBAL_FNS` 分派给出**精确**语义（字面量真折叠 + 非法 base64 记
 * `InvalidCharacterError`）。
 *
 * 原生 oracle（node v26.10.0）：
 *   atob("!!!")  → THROW DOMException name=InvalidCharacterError
 *   btoa("✓")   → THROW DOMException name=InvalidCharacterError
 *   atob("YWJj") → "abc"
 *
 * 反向钉：把 atob / btoa 加回 env 全局表 ⇒ 本文件必挂。
 */
describe("Bug 883 — atob / btoa keep the host's InvalidCharacterError throws面", () => {
  it("atob / btoa are NOT declared in the web env (host fallback)", () => {
    expect(webEnvGlobals()["atob"]).toBeUndefined();
    expect(webEnvGlobals()["btoa"]).toBeUndefined();
  });

  it("atob('!!!') records InvalidCharacterError", () => {
    const out = checkWeb(`export function f(){ return atob("!!!"); }`);
    expect(out.throwBrands).toContain("InvalidCharacterError");
  });

  it("btoa('✓') records InvalidCharacterError", () => {
    const out = checkWeb(`export function f(){ return btoa("✓"); }`);
    expect(out.throwBrands).toContain("InvalidCharacterError");
  });

  it("valid base64 still folds to the exact string (no precision loss)", () => {
    const out = checkWeb(`export function f(){ return atob("YWJj"); }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^"abc"/);
  });

  it("the host-fallback path and the env path agree (same source, same verdict)", () => {
    const withEnv = checkWeb(`export function f(){ return atob("!!!"); }`, true);
    const hostOnly = checkWeb(`export function f(){ return atob("!!!"); }`, false);
    expect(withEnv.throwBrands).toEqual(hostOnly.throwBrands);
    expect(withEnv.throwBrands).toContain("InvalidCharacterError");
  });
});
