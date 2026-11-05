/**
 * Bug 884 — `@nudo:env node` 的**全局 `structuredClone`** **遮蔽**宿主内建 ⇒
 * 引擎改走 env 声明路径 ⇒ **throws 面整个消失** ⇒ 假绿（原生对不可克隆值抛
 * DataCloneError，引擎却说「不抛」）。
 *
 * 修法：**删掉 node env 里的 `structuredClone` 声明**（packages/env/src/node.ts）⇒
 * 回落宿主路径 ⇒ 宿主那侧的 throws 面回来。
 *
 * 说明（勘误）：宿主路径曾把 structuredClone 的错误记成 **TypeError**（宿主
 * 实际抛 DOMException/DataCloneError）——那是 core 侧「宿主全局字面量守卫」
 * 的保守口径（Bug 288 / 750 家族），**不在本条范围**；本条只保证
 * 「throws 面不再消失」（假绿修掉）。
 *
 * Bug 288 落地后的探针口径（2026-10）：宿主路径已按**实参可克隆性**分档
 * ——可克隆实参（{ a: 1 } / 数组 / Date / Map…）**不记抛**（native 也不抛），
 * 不可克隆实参（函数 / Symbol / WeakMap / Promise）记 **DataCloneError**。
 * ⇒ 本文件的「throws 面还在不在」探针**必须用不可克隆实参**，否则会把
 * 「假绿」修成「假红」（原生 oracle：structuredClone({ a: 1 }) 不抛）。
 *
 * 证据口径：原生 oracle（同进程真实 structuredClone）+ 引擎探针。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { defineEnv } from "../node.ts";

const env = defineEnv();

function check(src: string) {
  return checkSource("/t/env-bug-884.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 884 — node env 不再声明 structuredClone（宿主 throws 面不再被遮蔽）", () => {
  it("原生 oracle：structuredClone 对不可克隆值抛错（不是恒不抛）", () => {
    expect(structuredClone({ a: 1 })).toEqual({ a: 1 });
    expect(() => structuredClone(Symbol("x"))).toThrow();
  });

  it("env：node env 不声明 structuredClone（回落宿主路径）", () => {
    expect(env.globals.structuredClone, "structuredClone 不应被 node env 声明").toBeUndefined();
  });

  it("引擎探针：带 node env 时 structuredClone 仍有 throws 面（假绿修掉）", () => {
    // 探针实参取**不可克隆**值（函数）：宿主对不可克隆值抛 DataCloneError ⇒
    // throws 面必须存在（Bug 288 口径：可克隆实参不记抛，见下一例）。
    const r = check(`export function s1() { return structuredClone(() => 1); }`);
    const sig = r.signatures[0];
    expect(sig, "无签名").toBeTruthy();
    // throws 面回来了（宿主全局字面量守卫的 may-throw 口径）
    expect(sig!.throws, "structuredClone 应带 throws 面").toBeTruthy();
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(true);
  });

  it("引擎探针：不开 env 时结论一致（env 不再改变门禁结论）", () => {
    const withEnv = check(`export function s1() { return structuredClone(() => 1); }`);
    const withoutEnv = checkSource("/t/env-bug-884.js", `export function s1() { return structuredClone(() => 1); }`, pTrue, {});
    expect(withoutEnv.signatures[0]?.throws).toBeTruthy();
    expect(withEnv.signatures[0]?.throws).toBeTruthy();
  });

  it("Bug 288 口径：可克隆实参（{ a: 1 }）native 不抛 ⇒ 引擎不得记 throws 面", () => {
    const r = check(`export function s1() { return structuredClone({ a: 1 }); }`);
    expect(r.signatures[0]?.throws, "可克隆实参不应带 throws 面").toBeUndefined();
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});
