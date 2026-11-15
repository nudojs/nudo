// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): eval-bug-311-promise-static-this-wiring.test.ts + eval-bug-311-promise-static-this.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue, absLit } from "../abs.ts";
import { type Abs, abs, numLit } from "@nudojs/core";
import { call, throwsError, isNever } from "./eval-helpers.ts";
import { evalNamespaceCall } from "../builtins/error.ts";

describe("[merged] eval-bug-311-promise-static-this-wiring.test.ts", () => {
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
});

describe("[merged] eval-bug-311-promise-static-this.test.ts", () => {
/**
 * Bug 311：Promise 静态方法忽略 `this` 绑定。
 *
 * 原生（node v26）：Promise 的静态（resolve / reject / all / race / allSettled /
 * any / withResolvers）在规范里都是**以 `this` 为接收者**的普通函数——
 * `PromiseResolve` / `NewPromiseCapability` 要求 `this` 是构造器，否则 TypeError：
 *   Promise.resolve.call(null, 1) → TypeError: PromiseResolve called on non-object
 *   Promise.all.call({}, [])     → TypeError: #<Object> is not a constructor
 *
 * 修法分两跳：
 * 1) 本分片（promise.ts / error/namespace.ts）：命名空间静态派发带 this 绑定，
 *    非构造器接收者按原生抛 TypeError（`checkPromiseStaticThis`）。
 * 2) 越界一行（**exec/runtime/containers/member.ts:847**，分片 A 的地盘）：
 *    成员读出的静态方法值须把 this 转发进命名空间派发——
 *      apply: (args) => evalNamespaceCall(ns, key, args) ?? unknown
 *    → apply: (args, thisVal) => evalNamespaceCall(ns, key, args, thisVal) ?? unknown
 *    合并前端到端仍是「静态派发无接收者」（返回 promise<1>、L2 假绿）。
 */







/** 抛 TypeError 的探针（NudoThrow 载荷是 brand TypeError） */
function throwsTypeError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    const err = e as { absValue?: Abs; name?: string };
    if (err?.absValue) return (err.absValue.shape as { name?: string }).name === "TypeError";
    return err?.name === "TypeError" || err?.name === "NudoThrow";
  }
}

describe("Bug 311: Promise 静态的 this 绑定", () => {
  it("机制面：命名空间派发带 this → 非构造器接收者抛 TypeError", () => {
    expect(
      throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)], absLit(null))),
    ).toBe(true);
    expect(
      throwsTypeError(() =>
        evalNamespaceCall("Promise", "all", [], abs({ k: "obj", slots: {} }, undefined, undefined, "exact")),
      ),
    ).toBe(true);
  });

  it("机制面：直接命名空间调用（this 缺席）合法 → 不抛", () => {
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)]))).toBe(false);
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "reject", [numLit(1)]))).toBe(false);
  });

  it("机制面：构造器接收者合法（Promise 的 Abs 面 = fn + ctor:true）", () => {
    const ctor = abs(
      { k: "fn", params: ["arg0"], name: "Promise", ctor: true },
      undefined,
      undefined,
      "exact",
    );
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)], ctor))).toBe(
      false,
    );
  });

  it("机制面：不可判接收者（any）→ 记 may-throw，不硬抛（不制造假抛）", () => {
    const anyv = abs({ k: "any" }, undefined, undefined, "path");
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)], anyv))).toBe(
      false,
    );
  });

  it("机制面：this 为 undefined（undefAbs 形态）→ TypeError（原生 PromiseResolve 非对象）", () => {
    // 该形态要求 member.ts 的转发写成 `thisVal ?? undefAbs()`（this 为
    // undefined 时与「无 this 信息」区分）——见报告的越界诉求。
    expect(
      throwsTypeError(() =>
        evalNamespaceCall("Promise", "resolve", [numLit(1)], absLit(undefined)),
      ),
    ).toBe(true);
  });

  it("端到端：Promise.resolve.call(null, 1)（待 member.ts 转发 this 的越界一行）", () => {
    const r = call(`export function f() { return Promise.resolve.call(null, 1); }`);
    const thrown = r.throws?.shape?.k === "brand" && (r.throws.shape as { name?: string }).name === "TypeError";
    if (thrown) {
      // 越界一行合并后：定抛 TypeError（原生）
      expect(r.throws).toBeDefined();
    } else {
      // 合并前：静态派发无接收者 → 返回 promise<1> 且不记抛（L2 假绿）
      expect(r.throws?.shape?.k).toBe("never");
    }
  });

  it("负控制：直接调用与构造器接收者不抛（原生合法路径）", () => {
    const direct = call(`export function f() { return Promise.resolve(1); }`);
    expect(direct.throws?.shape?.k).toBe("never");
    const viaCtor = call(`export function f() { return Promise.resolve.call(Promise, 1); }`);
    expect(viaCtor.throws?.shape?.k).toBe("never");
  });

  it("负控制：其它命名空间静态不因 this 通道受影响（Math.max.call(null, …) 合法）", () => {
    const r = call(`export function f() { return Math.max.call(null, 1, 2); }`);
    expect(r.throws?.shape?.k).toBe("never");
  });
});
});
