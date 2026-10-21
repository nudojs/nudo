/**
 * Bug 325 回归（**主 agent 接线面**）：函数**种类**戳（async × generator 四象限）
 * 驱动的 `Object.prototype.toString.call(f)` 标签。
 *
 * 接线（主 agent 已落地，本文件只钉行为，不改源码）：
 * - `algebra/abs-fn.ts`：`AbsFnImpl` 新增独立字段 `fnKind`
 *   （"function" | "async" | "generator" | "async-generator"）——与 `impl.kind`
 *   **分开**（`kind` 是「派发角色」维度，如 "protoMethod"）；
 * - `exec/runtime/state.ts`：`$fnVal` 的 opts 新增 `fnKind`，透传到 impl；
 * - `exec/transpile/helpers.ts`：新增 `fnKindSrc(fn)`（发射 `, fnKind: "..."`
 *   源码片段）与 `fnKindOf(fn)`（纯值）；
 * - `exec/transpile/expr/function.ts`（函数表达式）、
 *   `exec/transpile/expr/object.ts`（方法简写 + 方法型函数表达式）、
 *   `exec/transpile/class-emit.ts`（类方法 / 静态类方法，种类随 spec 的
 *   `methodKinds` / `staticMethodKinds` 下传）三条产生路径都打戳；
 * - `builtins/object-proto.ts`：`Object.prototype.toString.call(f)` 按
 *   `impl.fnKind` 给标签。
 *
 * 原生依据（node v26.10.0 实测，`Object.prototype.toString.call(x)`）：
 * - `function(){}`          → "[object Function]"；
 * - `async function(){}`    → "[object AsyncFunction]"；
 * - `function*(){}`         → "[object GeneratorFunction]"；
 * - `async function*(){}`   → "[object AsyncGeneratorFunction]"；
 * - 箭头 `() => 1` → "[object Function]"、`async () => 1` → "[object AsyncFunction]"；
 * - `{m(){}}.m`             → "[object Function]"；
 * - `{async m(){}}.m`       → "[object AsyncFunction]"；
 * - `{*m(){}}.m`            → "[object GeneratorFunction]"；
 * - `{async *m(){}}.m`      → "[object AsyncGeneratorFunction]"；
 * - `class A{m(){}}` 的 `A.prototype.m` → "[object Function]"；
 * - `class A{async m(){}}` 的 `A.prototype.m` → "[object AsyncFunction]"；
 * - `class A{*m(){}}` 的 `A.prototype.m` → "[object GeneratorFunction]"；
 * - `class A{static async m(){}}` 的 `A.m` → "[object AsyncFunction]"；
 * - `class A{static m(){}}` / `{static *m(){}}` / `{static async *m(){}}` 的
 *   `A.m` → "[object Function]" / "[object GeneratorFunction]" /
 *   "[object AsyncGeneratorFunction]"；
 * - `Object` / `Array.prototype.slice` → "[object Function]"（宿主内建无种类戳）。
 *
 * 已知缺口（**不在本文件钉**）：**函数声明**形态（`export async function f(){}`）
 * 仍是 "[object Function]"（原生 "[object AsyncFunction]"）——转译后是宿主
 * 函数、无法回推 async 种类；该缺口在族 05 收尾时作遗留记录。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 端到端取 `Object.prototype.toString.call(x)` 的标签字面量（body 形态） */
function tag(body: string): { ok: boolean; value?: unknown } {
  return litValue(
    call(`export function f() { ${body} }`, "f").result,
  );
}

/** 期望值：原生标签字符串 */
const FUNCTION = "[object Function]";
const ASYNC = "[object AsyncFunction]";
const GENERATOR = "[object GeneratorFunction]";
const ASYNC_GENERATOR = "[object AsyncGeneratorFunction]";

describe("Bug 325 — 函数种类标签（async × generator 四象限）", () => {
  it("函数表达式：四种象限各折原生标签", () => {
    expect(tag(`return Object.prototype.toString.call(function () {});`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(async function () {});`)).toEqual({
      ok: true,
      value: ASYNC,
    });
    expect(tag(`return Object.prototype.toString.call(function* () {});`)).toEqual({
      ok: true,
      value: GENERATOR,
    });
    expect(tag(`return Object.prototype.toString.call(async function* () {});`)).toEqual({
      ok: true,
      value: ASYNC_GENERATOR,
    });
  });

  it("箭头函数：同步折 Function、async 折 AsyncFunction（原生同款）", () => {
    expect(tag(`return Object.prototype.toString.call(() => 1);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(async () => 1);`)).toEqual({
      ok: true,
      value: ASYNC,
    });
  });

  it("对象方法简写：种类随 async × generator 变", () => {
    expect(tag(`return Object.prototype.toString.call(({ m() {} }).m);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(({ async m() {} }).m);`)).toEqual({
      ok: true,
      value: ASYNC,
    });
    expect(tag(`return Object.prototype.toString.call(({ *m() {} }).m);`)).toEqual({
      ok: true,
      value: GENERATOR,
    });
    expect(tag(`return Object.prototype.toString.call(({ async *m() {} }).m);`)).toEqual({
      ok: true,
      value: ASYNC_GENERATOR,
    });
  });

  it("类实例方法：种类随 async × generator 变", () => {
    expect(
      tag(`class A { m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: FUNCTION });
    expect(
      tag(`class A { async m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: ASYNC });
    expect(
      tag(`class A { *m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: GENERATOR });
    expect(
      tag(`class A { async *m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: ASYNC_GENERATOR });
  });

  it("类静态方法：staticMethodKinds 下传的种类戳生效", () => {
    expect(tag(`class A { static m() {} } return Object.prototype.toString.call(A.m);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(
      tag(`class A { static async m() {} } return Object.prototype.toString.call(A.m);`),
    ).toEqual({ ok: true, value: ASYNC });
    expect(
      tag(`class A { static *m() {} } return Object.prototype.toString.call(A.m);`),
    ).toEqual({ ok: true, value: GENERATOR });
    expect(
      tag(`class A { static async *m() {} } return Object.prototype.toString.call(A.m);`),
    ).toEqual({ ok: true, value: ASYNC_GENERATOR });
  });

  it("负控制：宿主内建函数（无种类戳）仍折 [object Function]", () => {
    expect(tag(`return Object.prototype.toString.call(Object);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(Array.prototype.slice);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
  });
});
