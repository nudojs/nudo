/**
 * Bug 1126 回归钉：async 体的**多 await**（≥2 个挂起点）——callee 未 settle
 * 前 caller 提前恢复，读到占位符 `unknown`。
 *
 * 原生（node v26.10.0 实测）：`await g()` 的恢复点排在 **g 的 promise settle
 * 之后**——callee 有几个 await 都不影响：caller 永远读到 callee 的终值；
 * callee 拒绝时，caller 的恢复点同样在 settle 之后（拒绝臂不丢）。
 *
 * 引擎（Bug 201 的生成器路径）：`await <promise>` 把恢复点**无条件**排进
 * 宿主微任务队列；callee 的续体也排进同一队列 ⇒ 队列 = [callee-resume,
 * caller-resume]。callee 有 **1 个** await 时，callee-resume 跑完即 settle
 * （caller-resume 在其后）⇒ 碰巧正确；callee 有 **≥2 个** await 时，
 * callee 的**第二次**续体排在 caller-resume **之后** ⇒ caller 恢复时 callee
 * 的 live promise 仍是占位符 `inner = unknown` ⇒ caller 读到 `unknown`
 * （拒绝臂同样被跳过 ⇒ 假绿：callee 明明拒绝，caller 却当 fulfilled 继续跑）。
 *
 * 修法（`exec/runtime/async.ts`）：live `$asyncGen` promise 标 **pending**
 * （WeakMap 侧表：pending 态 + waiter 列表）——operand 为 pending 时，恢复点
 * **排到 settle 之后**再跑；体 `return <未 settle 的 promise>` 时，本 promise
 * 同样保持 pending（原生：async 体 return promise ⇒ 递归采纳其兑现值 ⇒ 本
 * promise 的 settle 时刻 = 被采纳 promise 的 settle 时刻）。
 *
 * 口径边界（**已登记，未修**——需改 `builtins/promise.ts`，不在本条归属内）：
 * `await Promise.all([a(), b()])`——组合子对元素 promise 取的是**调用期快照**
 * （`elementSettle` 读 `shape.inner`）⇒ 元素尚未 settle 时取到占位符 ⇒ 组合子
 * 提前兑现（原生：Promise.all 等所有元素 settle 才兑现）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { call } from "./eval-helpers.ts";
import { sigOf } from "./nudo-constraints.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue } from "../abs.ts";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 调用导出的 f，返回同步段观测到的字面量值 */
function syncVal(src: string): unknown {
  const r = call(src, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : lv;
}

/** 调用导出的 f，返回其 promise 兑现值的字面量（await 之后的结果） */
function awaitedVal(src: string, fnName = "f"): unknown {
  const r = call(src, fnName);
  const lv = litValue($await(r.result as never));
  return lv.ok ? lv.value : lv;
}

describe("Bug 1126：async 体的多 await（≥2 个挂起点）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("callee 2 个 await：caller 恢复后读到 callee 的终值（原生 \"1,2,3\"）", () => {
    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); await null; log.push(3); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2,3");
  });

  it("callee 3 个 await：caller 恢复后读到 callee 的终值（原生 \"1,2,3,4\"）", () => {
    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); await null; log.push(3); await null; log.push(4); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2,3,4");
  });

  it("callee 2 个 await 后写 flag：caller 读到 flag=1（原生 1）", () => {
    expect(
      awaitedVal(`let flag = 0;
        async function h() { await null; await null; flag = 1; }
        export async function f() { await h(); return flag; }`),
    ).toBe(1);
  });

  it("return await <2-await callee>：值域是 callee 终值（原生 7）", () => {
    expect(
      awaitedVal(`async function h() { await null; await null; return 7; }
        export async function f() { return await h(); }`),
    ).toBe(7);
  });

  it("嵌套 return await <2-await callee>：值域是 callee 终值（原生 3）", () => {
    expect(
      awaitedVal(`async function g() { await null; await null; return 3; }
        async function h() { return await g(); }
        export async function f() { return await h(); }`),
    ).toBe(3);
  });

  it("体 return <2-await callee 的 promise>：兑现值是 callee 终值（原生 7）", () => {
    expect(
      awaitedVal(`async function g() { await null; await null; return 7; }
        export async function f() { await null; return g(); }`),
    ).toBe(7);
  });

  it("callee 2 个 await 后拒绝：caller 的 catch 臂可达（原生 \"caught\"）", () => {
    expect(
      awaitedVal(`async function g() { await null; await null; throw new Error("boom"); }
        export async function f() { try { await g(); return "no"; } catch (e) { return "caught"; } }`),
    ).toBe("caught");
  });

  it("callee 2 个 await 后拒绝：caller 的 promise 确定拒绝（原生：reject）", () => {
    // 原生：await 一个拒绝的 promise ⇒ 调用方的 promise 拒绝（fulfilled 臂不可能）
    const r = call(
      `async function g() { await null; await null; throw new Error("boom"); }
       export async function f() { await g(); return "no"; }`,
      "f",
    );
    const sh = (r.result as { shape: { inner: { shape: { k: string } }; rejected?: unknown } }).shape;
    expect(sh.inner.shape.k).toBe("never");
    expect(sh.rejected).toBeDefined();
  });

  it("负控制：callee 只有 1 个 await 时行为不变（原生 \"1,2\"）", () => {
    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2");
  });

  it("负控制：callee 无 await 时行为不变（原生 \"1,2\"）", () => {
    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); log.push(2); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2");
  });

  it("负控制：caller 2 个 await、callee 1 个 await（原生 6）", () => {
    expect(
      awaitedVal(`async function g() { await null; return 3; }
        export async function f() { const a = await g(); const b = await g(); return a + b; }`),
    ).toBe(6);
  });

  it("同步窗口口径：caller 的 await 之后的副作用不进同步窗口（原生 \"1\"）", () => {
    expect(
      syncVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); await null; log.push(3); }
        export function f() { g(); return log.join(","); }`),
    ).toBe("1");
  });

  it("求值面（export / test 路径同款）：await 2-await callee 后的 cache 是 \"warm\"", () => {
    // 原报告 F15 的 fixture：修前求值面给 "cold"（caller 抢跑读到占位符）
    expect(
      awaitedVal(
        `let cache = "cold";
        async function warm(){ await null; await null; cache = "warm" }
        export async function readCache(){ await warm(); return cache }`,
        "readCache",
      ),
    ).toBe("warm");
  });
});

describe("Bug 1126：check 面（签名）不受多 await 影响", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    takeRefineDiags();
    resetSidecarLoadFailureCache();
    takeInterfaceDiags();
    resetParseSourceCache();
    resetAbsCallBudget();
    resetEvalForkBudget();
  });

  it("readCache：await 2-await callee 后的 cache 仍是 \"warm\"", () => {
    const src = `let cache = "cold";
      async function warm(){ await null; await null; cache = "warm" }
      export async function readCache(){ await warm(); return cache }`;
    const r = checkSource("/t/src.js", src, pTrue, {});
    expect(sigOf(r, "readCache")).toBe('promise<"warm">');
  });

  it("callee 2 个 await 后拒绝：caller 的 promise 面是 never（与 1-await 同口径）", () => {
    const src = `async function g(){ await null; await null; throw new Error("boom"); }
      export async function f(){ await g(); return 1 }`;
    const r = checkSource("/t/src.js", src, pTrue, {});
    expect(sigOf(r, "f")).toBe("promise<never>");
  });
});
