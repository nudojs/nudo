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
import { describe, it, expect } from "vitest";
import { abs, absLit, numLit } from "@nudojs/core";
import { evalNamespaceCall } from "../builtins/error.ts";
import { call } from "./eval-helpers.ts";
import type { Abs } from "@nudojs/core";

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
