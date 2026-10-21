/**
 * Bug 201 回归钉（**部分**）：async 体的 `await` **挂起点**。
 *
 * 原生：`await` 挂起当前 async 体——`await` 之后的语句在**微任务**里
 * 才跑 ⇒ 调用方在同步窗口看不到 await 之后的副作用。引擎的 async 体
 * 目前是**eager 一把跑**（`$async(() => { ... })` 线性体，`await x` 只是
 * 一次普通调用）⇒ await 之后的副作用对调用方**立即可见**。
 *
 * ── 修法边界（本分片不可闭合）──────────────────────────────────────────
 * 报告的修法是「把 async 体降成分段续跑：每个 await 切成一段，续体
 * 登记到宿主微任务队列」——这要求**转译侧**把 async 体切成段
 * （`exec/transpile/expr/operators.ts` 的 `await x → $await(x)` 降级
 * 与 `exec/transpile/expr/function.ts` 的 async 体包装），续体才能在
 * 运行时被挂起/恢复。转译侧文件**不在本分片可改范围**（只允许改
 * `exec/runtime/async.ts` + `builtins/promise.ts`）⇒ 本条以 todo 记
 * 缺口，不做半吊子的「截断 async 体」（那会丢值域：await 之后的
 * return 值不可判 ⇒ promise 值域退 unknown，破坏既有回归）。
 *
 * 本分片在 `async.ts` 内闭合的是 **await 的取值语义**（Bug 220 双臂
 * promise / Bug 221 thenable 采纳）——见
 * `eval-bug-220-await-rejected-channel.test.ts` 与
 * `eval-bug-221-await-thenable.test.ts`。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue } from "../abs.ts";

describe("Bug 201：await 挂起点（待转译侧分段续跑）", () => {
  it.todo("原生：f() 返回后 await 之前的写可见、之后的写不可见（n = 0）");
  it.todo("原生：await 之后的副作用不进调用方的同步窗口（log = \"a\"）");
  it.todo("原生：for-await 体的 await 之后的效果同样延后");
  it.todo("原生：async 函数返回 pending promise（Promise { 0 }）");

  it("负控制：已 settle 的 promise 的 await 取值仍精确（await Promise.resolve(1) → 1）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve(1);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  });

  it("负控制：async 函数仍返回 promise 形态（值域不被截断成 unknown）", () => {
    const src = `
export async function f() {
  return 42;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 42 });
  });
});
