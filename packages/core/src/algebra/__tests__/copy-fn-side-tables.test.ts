/**
 * `$copy` 的函数/实例快照必须保留**侧表身份**。
 *
 * 修复前 fn 分支（fork/loop 快照）只迁移 impl/invariants：
 * - null-proto 标记丢失 ⇒ `Object.setPrototypeOf(f, null)` 后经 fork 副本
 *   读 `f.__proto__` 从 undefined 翻成 Function.prototype；
 * - 新鲜实例 id 丢失 ⇒ 快照副本与另一次创建事件比较从 `false` 退化成
 *   unknown（strictEq 只在双方都有 id 时折 false）。
 * brand 分支同样缺 fresh-id 迁移。
 */
import { describe, it, expect } from "vitest";
import { abs, litValue, numLit, unknown, type Abs } from "../abs.ts";
import { absFunction } from "../abs-fn.ts";
import { objOf, isNullProtoObj, markNullProtoObj, makeSum } from "../objects.ts";
import { markFreshInstance, freshInstanceIdOf } from "../instance-id.ts";
import { $copy } from "../exec/runtime/containers/obj.ts";
import { call } from "./eval-helpers.ts";

describe("$copy fn：null-proto 标记随快照迁移", () => {
  it("直接探针：副本仍是 null-proto", () => {
    const f = markNullProtoObj(absFunction([], { apply: () => numLit(1) }));
    expect(isNullProtoObj(f)).toBe(true);
    const c = $copy(f);
    expect(c).not.toBe(f);
    expect(isNullProtoObj(c)).toBe(true);
  });

  it("端到端：fork 后 f.__proto__ 仍为 undefined", () => {
    const r = call(
      `export function f(cond) {
        const g = () => 1;
        Object.setPrototypeOf(g, null);
        if (cond) { g.x = 1; } else { g.x = 2; }
        return g.__proto__ === undefined ? "undef" : "not-undef";
      }`,
      "f",
      [unknown],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "undef" });
  });
});

describe("$copy 新鲜实例 id 随快照迁移", () => {
  it("fn：副本沿用同一 id", () => {
    const f = markFreshInstance(absFunction([], { apply: () => numLit(1) }));
    const id = freshInstanceIdOf(f);
    expect(id).toBeDefined();
    const c = $copy(f);
    expect(freshInstanceIdOf(c)).toBe(id);
  });

  it("brand：副本沿用同一 id", () => {
    const inst = markFreshInstance(
      abs({ k: "brand", name: "C", shape: objOf({}) }, undefined, undefined, "exact"),
    );
    const id = freshInstanceIdOf(inst);
    expect(id).toBeDefined();
    const c = $copy(inst);
    expect(freshInstanceIdOf(c)).toBe(id);
  });

  it("端到端：分支写过的实例与另一次创建 === → false（此前 unknown）", () => {
    const r = call(
      `export function f(cond) {
        class C {}
        const a = new C();
        if (cond) { a.x = 1; } else { a.x = 1; }
        const b = new C();
        return a === b;
      }`,
      "f",
      [unknown],
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: false });
  });

  it("负控：同一实例的两份快照代表同一值（不折 false）", () => {
    const f: Abs = markFreshInstance(absFunction([], { apply: () => numLit(1) }));
    // makeSum 同一 impl ⇒ 单成员；这里直接验证 id 相同即可
    const c1 = $copy(f);
    const c2 = $copy(f);
    expect(freshInstanceIdOf(c1)).toBe(freshInstanceIdOf(f));
    expect(freshInstanceIdOf(c2)).toBe(freshInstanceIdOf(f));
    expect(makeSum(f, f)).toBe(f);
  });
});
