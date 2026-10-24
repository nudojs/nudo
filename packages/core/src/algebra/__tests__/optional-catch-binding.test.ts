/**
 * 可选 catch 绑定（`catch { … }`）不引入绑定回归（报告 Bug 175）。
 *
 * ES2019 的可选 catch 绑定**不引入任何绑定**。此前转译把载体名回落成
 * **硬编码 `"e"`**：
 * ① 遮蔽外层同名绑定 → 自信错值（`catch { return e }` 读到引擎凭空造的
 *    异常值，而不是外层的 "outer"）；
 * ② 顶掉未声明名的 ReferenceError → 漏抛 / 假绿（签名里没有 throws）；
 * ③ 与用户自己的 `let e` 撞车 → 同一块重复声明 → 转译崩溃、类型塌成
 *    unknown + 误导诊断（"path not covered, or native"）。
 *
 * 修法：可选绑定**不发射用户可见绑定**——catch 体按原样解析外层名字。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

describe("可选 catch 绑定不引入绑定（catch { … }）", () => {
  it("① 不遮蔽外层同名绑定：读到外层的 \"outer\"（修前折 Error）", () => {
    const r = call(
      `export function f() { const e = "outer"; try { throw new Error("x"); } catch { return e; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "outer" });
  });

  it("② 未声明名仍抛 ReferenceError（修前签名里没有 throws = 假绿）", () => {
    const r = call(
      `export function f() { try { throw new Error("x"); } catch { return e; } }`,
      "f",
    );
    expect(throwsError(r.throws, "ReferenceError")).toBe(true);
  });

  it("③ 用户自己的 let e 不再撞车：返回 1（修前转译崩溃 → unknown）", () => {
    const r = call(
      `export function f() { try { throw new Error("x"); } catch { let e = 1; return e; } }`,
      "f",
    );
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("可选绑定的普通 catch：返回 \"caught\"", () => {
    const r = call(`export function f() { try { throw new Error("x"); } catch { return "caught"; } }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "caught" });
  });

  it("具名 catch 不受影响：e.message → \"x\"", () => {
    const r = call(
      `export function f() { try { throw new Error("x"); } catch (e) { return e.message; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });

  it("具名 catch 仍遮蔽外层同名绑定（原生口径）：e.message → \"x\"", () => {
    const r = call(
      `export function f() { const e = "outer"; try { throw new Error("x"); } catch (e) { return e.message; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });

  it("模式 catch 不受影响：catch ({ message }) → \"x\"", () => {
    const r = call(
      `export function f() { try { throw new Error("x"); } catch ({ message }) { return message; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });
});
