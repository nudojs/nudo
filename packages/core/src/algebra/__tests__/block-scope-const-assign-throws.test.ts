/**
 * Bug 148（族 01）——块作用域里的 `const` 重assign 必须 TypeError。
 *
 * 回归背景：`constNames` 名单只在「函数体 / BlockStatement 臂」上由
 * `computeConstScope` 计算；try / catch / finally / 循环体这些**同样是块作用域**
 * 的发射点直接 `body.map(transpileStatement)`，`opts.constNames` 原样传下去 ⇒
 * 这些作用域里声明的 const 不在名单里 ⇒ 赋值静默直写（错值）+ throws 域折 never
 * ⇒ 签名给错值、L2 门禁假绿。
 *
 * 修法：所有块作用域发射点与 `BlockStatement` 臂同口径——对该作用域语句列表跑
 * `computeConstScope(bodyStmts, opts.constNames)` 再并入该作用域 opts。
 *
 * 原生对拍（node strict/ESM）：try/catch/finally 与 for / for-of / for-in /
 * while / do-while 体里的 `const` 重赋一律抛 TypeError；块作用域里的 `let` /
 * `var` 仍可再赋；内层 `let` 遮蔽外层 `const` 仍可再赋。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function expectTypeError(src: string, fnName = "f") {
  const r = call(src, fnName);
  expect(isNever(r.result)).toBe(true);
  expect(throwsError(r.throws, "TypeError")).toBe(true);
}

describe("Bug 148：块作用域 const 重赋抛 TypeError", () => {
  it("try 体：const 重赋被 catch 接住", () => {
    const r = call(
      `export function f() { try { const c = 1; c = 2; return c; } catch (e) { return "caught"; } }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
    expect(isNever(r.throws)).toBe(true);
  });

  it("try 体：抛出的错误类型是 TypeError", () => {
    const r = call(
      `export function f() { try { const c = 1; c = 2; } catch (e) { return e.constructor.name; } return "no"; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "TypeError" });
  });

  it("try 体：自增 / 复合赋值 / 解构 const 同样抛", () => {
    for (const body of [
      `try { const c = 1; c++; } catch (e) { return "caught"; }`,
      `try { const c = 1; c += 1; } catch (e) { return "caught"; }`,
      `try { const [a] = [1]; a = 2; } catch (e) { return "caught"; }`,
      `try { const { a } = { a: 1 }; a = 2; } catch (e) { return "caught"; }`,
      `try { const c = 1; const g = () => { c = 2; }; g(); } catch (e) { return "caught"; }`,
    ]) {
      const r = call(`export function f() { ${body} }`);
      expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
    }
  });

  it("catch 体：const 重assign 未捕获 → TypeError", () => {
    expectTypeError(
      `export function f() { try { throw 1; } catch (e) { const c = 1; c = 2; } return "no"; }`,
    );
  });

  it("finally 体：const 重赋未捕获 → TypeError", () => {
    expectTypeError(`export function f() { try { } finally { const c = 1; c = 2; } }`);
  });

  it("for 循环体：const 重赋未捕获 → TypeError", () => {
    expectTypeError(`export function f() { for (let i = 0; i < 1; i++) { const c = 1; c = 2; } }`);
  });

  it("for-of / for-in 体：const 重赋未捕获 → TypeError", () => {
    expectTypeError(`export function f() { for (const x of [1]) { const c = 1; c = 2; } }`);
    expectTypeError(`export function f() { for (const k in { a: 1 }) { const c = 1; c = 2; } }`);
  });

  it("while / do-while 体：const 重赋未捕获 → TypeError", () => {
    expectTypeError(`export function f() { while (true) { const c = 1; c = 2; break; } }`);
    expectTypeError(`export function f() { do { const c = 1; c = 2; } while (false); }`);
  });

  it("块作用域里的 let / var 仍可再赋（不得误伤）", () => {
    expect(
      litValue(
        call(`export function f() { try { let c = 1; c = 2; return c; } catch (e) { return "caught"; } }`)
          .result,
      ),
    ).toEqual({ ok: true, value: 2 });
    expect(
      litValue(
        call(`export function f() { for (let i = 0; i < 1; i++) { let c = 1; c = 2; } return "ok"; }`)
          .result,
      ),
    ).toEqual({ ok: true, value: "ok" });
    expect(
      litValue(
        call(`export function f() { for (let i = 0; i < 1; i++) { var c = 1; c = 2; } return "ok"; }`)
          .result,
      ),
    ).toEqual({ ok: true, value: "ok" });
  });

  it("内层 let 遮蔽外层 const 仍可再赋", () => {
    expect(
      litValue(call(`export function f() { const c = 1; { let c = 2; c = 3; return c; } }`).result),
    ).toEqual({ ok: true, value: 3 });
    expect(
      litValue(call(`export function f() { const c = 1; { let c = 2; c = 3; } return c; }`).result),
    ).toEqual({ ok: true, value: 1 });
  });

  it("for 头 let 变量遮蔽外层 const → 体内再赋合法", () => {
    const r = call(
      `export function f() { const i = 1; for (let i = 0; i < 1; i++) { i = 5; } return "ok"; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("外层 const 在 try 体里被重赋 → 抛（作用域可见性不因 try 失效）", () => {
    const r = call(
      `export function f() { const c = 1; try { c = 2; } catch (e) { return "caught"; } return "ok"; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });
});
