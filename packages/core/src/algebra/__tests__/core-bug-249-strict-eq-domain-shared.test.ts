/**
 * BUG-249 —— `strictEqAbs` 的「同一 Abs 引用 ⇒ 同值」折叠缺**域共享门**。
 *
 * 根因：`arr` shape 只有一个元素域 Abs，`$idx` 等**分发位**把同一对象交给
 * 两个下标位（`xs[0]` / `xs[1]` 共享 `shape.element`，`arr-index.ts` 用
 * `markDomainShared` 标记）。`strictEqAbs` 的 `a === b` 分支只看对象身份
 * ⇒ 折 `true` ⇒ `if (xs[0] === xs[1])` 恒真 ⇒ **另一臂被当死代码删掉**
 * ⇒ 引擎自信返回 `"same"`（`conf: exact`），而宿主真值是 `"diff"` ⇒
 * guard / schema 产物只接受 `"same"`（拒绝真实返回值）。
 *
 * 修复：`a === b` 与「同 var 恒等」两支都补 `isDomainShared` 门（与
 * `arithmetic/addsub.ts` 的 sub 自反折叠门同一不变量）⇒ 不可判定
 * （`undefined`），不是 `true`。
 */
import { describe, it, expect } from "vitest";
import { strictEqAbs } from "../surface.ts";
import { markDomainShared } from "../len-sharing.ts";
import { abs, litValue, numLit, type Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** 契约元素域的代表形状（obj：非字面量、无 var 项 ⇒ 只走「同 Abs」支） */
const item = (): Abs =>
  abs({ k: "obj", slots: { id: { value: numLit(1) } } }, undefined, undefined, "exact");

describe("BUG-249 — 域共享元素 Abs 不得折「同值」", () => {
  it("同一 Abs 引用：非域共享仍折 true，域共享折 undefined", () => {
    const el = item();
    // 同一绑定重复出现（真同值）——既有精度：保持 true
    expect(strictEqAbs(el, el)).toBe(true);
    // 元素域分发产物（xs[0] / xs[1] 的同一个对象）——不保证同值
    expect(strictEqAbs(markDomainShared(el), el)).toBeUndefined();
  });

  it("契约类型数组的 xs[0] === xs[1] 不得删掉 false 臂", () => {
    const xs = abs({ k: "arr", element: item() }, undefined, undefined, "exact");
    const src = `export function f(xs) {
  if (xs[0] === xs[1]) { return "same"; }
  return "diff";
}`;
    const r = call(src, "f", [xs]);
    const v = litValue(r.result);
    // 修复前：exact "same"（宿主不可能产出的错值）⇒ 此断言必挂
    expect(v.ok ? v.value : undefined).not.toBe("same");
  });

  it("字面量数组（元素各自铸造、非域共享）仍精确判 diff", () => {
    const src = `export function f() {
  const xs = [{ id: 1 }, { id: 2 }];
  if (xs[0] === xs[1]) { return "same"; }
  return "diff";
}`;
    const r = call(src, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: "diff" });
  });
});
