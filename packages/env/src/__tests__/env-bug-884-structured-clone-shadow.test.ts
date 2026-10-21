/**
 * Bug 884 — `@nudo:env node` 的**全局 `structuredClone`** **遮蔽**宿主内建 ⇒
 * 引擎改走 env 声明路径 ⇒ **throws 面整个消失** ⇒ 假绿（原生对不可克隆值抛
 * DataCloneError，引擎却说「不抛」）。
 *
 * 修法：**删掉 node env 里的 `structuredClone` 声明**（packages/env/src/node.ts）⇒
 * 回落宿主路径 ⇒ 宿主那侧的 throws 面回来。
 *
 * 说明（勘误）：宿主路径目前把 structuredClone 的错误记成 **TypeError**（宿主
 * 实际抛 DOMException/DataCloneError）——那是 core 侧「宿主全局字面量守卫」
 * 的保守口径（Bug 288 / 750 家族），**不在本条范围**；本条只保证
 * 「throws 面不再消失」（假绿修掉）。
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
    const r = check(`export function s1() { return structuredClone({ a: 1 }); }`);
    const sig = r.signatures[0];
    expect(sig, "无签名").toBeTruthy();
    // throws 面回来了（宿主全局字面量守卫的 may-throw 口径）
    expect(sig!.throws, "structuredClone 应带 throws 面").toBeTruthy();
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(true);
  });

  it("引擎探针：不开 env 时结论一致（env 不再改变门禁结论）", () => {
    const withEnv = check(`export function s1() { return structuredClone({ a: 1 }); }`);
    const withoutEnv = checkSource("/t/env-bug-884.js", `export function s1() { return structuredClone({ a: 1 }); }`, pTrue, {});
    expect(withoutEnv.signatures[0]?.throws).toBeTruthy();
    expect(withEnv.signatures[0]?.throws).toBeTruthy();
  });
});
