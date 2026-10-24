/**
 * Bug 311 回归（**主 agent 接线面**）：Promise 静态方法的 `this` 绑定转发。
 *
 * 接线（主 agent 已落地，本文件只钉行为，不改源码）：
 * - `exec/runtime/containers/member.ts`：命名空间成员读出的静态方法值，
 *   `apply: (args) => evalNamespaceCall(ns, key, args)`
 *   → `apply: (args, thisVal) => evalNamespaceCall(ns, key, args, thisVal ?? undef())`
 *   （this 缺席 = 「this 是 undefined」，与「无 this 信息」区分）；
 * - `builtins/error/namespace.ts`：`evalNamespaceCall` 收第 4 参 `thisVal`
 *   并转给 `evalPromiseStatic`；
 * - `builtins/promise.ts`：`checkPromiseStaticThis` —— this nullish ⇒ TypeError；
 *   this 非构造器 ⇒ TypeError；this 是构造器（`shape.k === "fn" | "brand"`
 *   且 `ctor === true`）⇒ 合法。
 *
 * 原生依据（node v26.10.0 实测，ES262：Promise 的静态是以 `this` 为接收者
 * 的普通函数，`PromiseResolve` / `NewPromiseCapability` 要求 this 是构造器）：
 * - `Promise.resolve(1)`               → 合法，返回 promise；
 * - `Promise.resolve.call(null, 1)`    → TypeError: PromiseResolve called on non-object；
 * - `Promise.resolve.call({}, 1)`      → TypeError: #<Object> is not a constructor；
 * - `Promise.resolve.call(Promise, 1)` → 合法，返回 promise；
 * - `const r = Promise.resolve; r(1)` → TypeError（this ≡ undefined ⇒ 非构造器）；
 * - `Promise.resolve.call(undefined,1)`→ TypeError;
 * - 负控制 `Math.max.call(null, 1, 2)` → 合法，返回 2（命名空间静态的 this
 *   判定**只对 Promise 生效**）。
 *
 * 同族已由 `eval-bug-311-promise-static-this.test.ts` 钉机制面
 * （`evalNamespaceCall` 直调），本文件钉**端到端接线面**（成员读 → this
 * 转发 → 静态派发）。
 */
import { describe, it, expect } from "vitest";
import { litValue, type Abs } from "@nudojs/core";
import { call, throwsError, isNever } from "./eval-helpers.ts";

type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs; rejected?: Abs; unsettled?: boolean };
};

/** 结果的 promise 面（eff/promise）+ 兑现域字面量 */
function promiseFace(src: string): { inner: { ok: boolean; value?: unknown }; throws: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  expect(sh?.k, "expected eff shape (promise)").toBe("eff");
  expect(sh?.eff, "expected promise eff").toBe("promise");
  return { inner: litValue(sh!.inner as Abs), throws: r.throws };
}

/** 端到端跑一段表达式，返回调用记录 */
function run(body: string) {
  return call(`export function f() { ${body} }`, "f");
}

describe("Bug 311 — Promise 静态的 this 绑定转发（接线面）", () => {
  it("Promise.resolve(1)：直接命名空间调用不抛，值域是 promise<1>", () => {
    const { inner, throws } = promiseFace(
      `export function f() { return Promise.resolve(1); }`,
    );
    expect(isNever(throws), "原生合法路径不得抛").toBe(true);
    expect(inner).toEqual({ ok: true, value: 1 });
  });

  it("Promise.resolve.call(null, 1)：this 为 nullish ⇒ TypeError", () => {
    const r = run(`return Promise.resolve.call(null, 1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("Promise.resolve.call({}, 1)：this 非构造器 ⇒ TypeError", () => {
    const r = run(`return Promise.resolve.call({}, 1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("Promise.resolve.call(Promise, 1)：this 是构造器 ⇒ 合法，值域是 promise<1>", () => {
    const { inner, throws } = promiseFace(
      `export function f() { return Promise.resolve.call(Promise, 1); }`,
    );
    expect(isNever(throws), "构造器接收者是原生合法路径").toBe(true);
    expect(inner).toEqual({ ok: true, value: 1 });
  });

  it("const r = Promise.resolve; r(1)：this 缺席（undefined）⇒ TypeError", () => {
    // 接线面关键：成员读出的静态方法被**单独读出再调用**时，this 转发必须
    // 带上「this 是 undefined」（原生同款 ⇒ TypeError）。
    const r = run(`const r = Promise.resolve; return r(1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("Promise.resolve.call(undefined, 1)：this 显式 undefined ⇒ TypeError", () => {
    const r = run(`return Promise.resolve.call(undefined, 1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("负控制：Math.max.call(null, 1, 2) 不抛且返回 2（this 判定只对 Promise 生效）", () => {
    const r = run(`return Math.max.call(null, 1, 2);`);
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("全族：7 个 Promise 静态 × {null, {}, Promise} 接收者与原生逐格一致", () => {
    // 原生（node v26 实测）：7 个静态在 this = null / {} 时**全部**抛
    // TypeError，this = Promise 时**全部**合法。
    const statics = [
      "resolve",
      "reject",
      "all",
      "race",
      "allSettled",
      "any",
      "withResolvers",
    ] as const;
    for (const m of statics) {
      for (const recv of ["null", "{}", "Promise"] as const) {
        const r = run(`return Promise.${m}.call(${recv});`);
        if (recv === "Promise") {
          expect(throwsError(r.throws, "TypeError"), `${m}.call(Promise) 不得抛`).toBe(
            false,
          );
        } else {
          expect(
            throwsError(r.throws, "TypeError"),
            `${m}.call(${recv}) 须抛 TypeError`,
          ).toBe(true);
        }
      }
    }
  });
});
