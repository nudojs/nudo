/**
 * BUG-176 回归：`Reflect.construct(用户类, argsList[, newTarget])` 不得误报
 * may-throw TypeError。
 *
 * 原生（node v26）：用户类值 `class A {}` 恒有 `[[Construct]]`（ClassDefinition-
 * Evaluation 建构造器时装）⇒ `Reflect.construct(A, [])` / `(A, [], B)` **从不抛**。
 * 引擎的类值是 brand + `ctor: true` facet（$class / 类注册表产出）；此前
 * construct 的 **target 侧**只对 fn 形读 ctor facet，brand 一律走「可能不可
 * 构造」⇒ 记 may-throw ⇒ `nudo:entry-may-throw` 假红（exit 1 卡 CI）。
 *
 * 修复：brand + `ctor: true`（类值）⇒ 恒可构造，不记 may；fn 形 ctor 缺省时
 * 先查类注册表（命中 ⇒ 类定义 ⇒ 不记 may）；真·命名空间一等函数（Math.max
 * 等，ctor:false）与实例 brand（无 ctor facet）维持既有保守口径。
 */
import { describe, it, expect } from "vitest";
import { call, effects, isNever, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("BUG-176 — Reflect.construct(用户类, …) 不记假 may-throw", () => {
  it("2 参合法形：target/argsList 均为用户类值 → 不抛、不记 may", () => {
    const src = wrap(`class A { constructor(){ this.t = 1; } } return Reflect.construct(A, []);`);
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
    // 假红来源：target 侧「Reflect.construct target may not be a constructor」
    expect(effects(src)).not.toContain("TypeError");
  });

  it("3 参形（newTarget 亦用户类）→ target/newTarget 两侧均不记 may", () => {
    const src = wrap(
      `class A { constructor(){ this.t = 1; } } class B {} return Reflect.construct(A, [], B);`,
    );
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  });

  it("内建类值控制组（Array）结论不变：不抛、不记 may", () => {
    const src = wrap(`return Reflect.construct(Array, []);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  });

  it("对照：实例 brand 无 ctor facet ⇒ 保守口径保持（不折假不抛）", () => {
    const src = wrap(`class A {} const a = new A(); return Reflect.construct(a, []);`);
    expect(effects(src)).toContain("TypeError");
  });

  it("对照：ctor:false 的宿主一等函数（Math.max）⇒ 定抛 TypeError", () => {
    const src = wrap(`return Reflect.construct(Math.max, []);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(true);
  });
});
