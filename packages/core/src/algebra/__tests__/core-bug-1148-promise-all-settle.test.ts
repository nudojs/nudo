/**
 * Bug 1148 回归钉：`Promise.all` 不得取**调用期快照**（组合子的兑现值 =
 * **全部元素 settle 之后**的聚合）。
 *
 * 原生（node v26.10.0 实测）：
 * - `await Promise.all([inner(), inner()])`（`inner` 含 2 个 await）→ **4**
 * - `await Promise.all([inner(), inner()])`（`inner` 含 1 个 await）→ **4**
 * - `await Promise.all([inner(), inner()])`（`inner` 无 await）→ **4**
 * - 元素拒绝 → 组合子**拒绝**（`catch` 臂可达："caught:boom"）
 * - 兑现序：`log` = "a,a,b,b,all"（组合子在**两个元素都 settle 之后**才兑现）
 *
 * 修前：组合子对元素 promise 取的是**调用期快照**（`elementSettle` 读
 * `shape.inner`）⇒ 元素尚未 settle 时取到**占位符** `unknown` ⇒ 兑现值被
 * **永久冻住**：`await Promise.all([inner(), inner()])` 得 `number | string`
 * （unknown 派生值），原生是 4。
 *
 * 根因：组合子自身不是 pending——它在**调用点**就把元素的占位符读成兑现值，
 * 之后元素 settle 也无法回填（兑现值 ≠ 元素 settle 后的聚合）。
 *
 * 修法（`builtins/promise.ts`）：元素含 **pending** 的 live promise ⇒ 组合子
 * 自身也是 **pending**（**同一套** pending/waiter 机制——`pendingPromiseWaiters`
 * 侧表与 `exec/runtime/async.ts` 的 `$asyncGen` 共用，不另造第二套）⇒ 元素
 * settle 后**重算**聚合并就地填 `inner`（活通道）⇒ 兑现值不再被快照冻住。
 * 拒绝臂不丢：任一元素**确定拒绝** ⇒ 组合子**短路拒绝**（原生 all 短路）。
 *
 * 口径边界（未改）：
 * - `Promise.all` 只对**可迭代**的元素数组生效；非可迭代输入按原生折
 *   **返回 promise 的 rejection**（不同步抛——Bug 47 node v26 实测口径）。
 * - 元素**全部已 settle** 时走既有快路径（`promise<[1, 2]>` 等金标零漂移）。
 *
 * 已知遗留（**不在本条归属**——`.then` 反应面在 pending 接收者上仍抢跑，
 * 与 `Promise.all` 无关：任何 live async-gen promise 的 `.then(cb)` 都读
 * 到占位符；见交付报告的"剩余风险"）：
 * `Promise.all([...]).then(cb)` 的 `cb` 仍读到占位符（反应面未等 settle）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { call } from "./eval-helpers.ts";
import { sigOf } from "./nudo-constraints.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue, type Abs } from "../abs.ts";
import { formatAbs } from "@nudojs/core";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

/** 调用导出的 f，返回其 promise 兑现值的字面量（await 之后的结果） */
function awaitedVal(src: string, fnName = "f"): unknown {
  const r = call(src, fnName);
  const lv = litValue($await(r.result as never));
  return lv.ok ? lv.value : lv;
}

/** 结果的展示串（签名面） */
function fmt(src: string, fnName = "f"): string {
  return formatAbs(call(src, fnName).result as Abs)?.replace(/\s+#[a-z0-9]+$/, "") ?? "";
}

/** 2 个 await 的 inner（原生：`Promise.all([inner(), inner()])` → [2, 2]） */
const INNER_TWO_AWAIT = `async function inner() { await null; await null; return 2; }`;

describe("Bug 1148：Promise.all 等元素 settle 后才兑现（不取调用期快照）", () => {
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

  it("await Promise.all([inner(), inner()])（inner 2 个 await）= 4（原生 4）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`),
    ).toBe(4);
  });

  it("check 面签名：promise<4>（原生 4；修前是 promise<number | string>）", () => {
    const src = `${INNER_TWO_AWAIT}
      export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`;
    const r = checkSource("/t/src.js", src, pTrue, {});
    expect(sigOf(r, "f")).toBe("promise<4>");
  });

  it("组合子自身：返回值即 [2, 2]（原生 [2, 2]；修前是占位符 unknown）", () => {
    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.all([inner(), inner()]); }`),
    ).toContain("promise<[2, 2]>");
  });

  it("兑现序：组合子在**两个元素都 settle 之后**才兑现（原生 \"a,a,b,b,all\"）", () => {
    // 组合子若在调用期快照 ⇒ "all" 会排在元素体完成之前（提前兑现）
    expect(
      awaitedVal(`const log = [];
        async function inner() { log.push("a"); await null; log.push("b"); await null; return 2; }
        export async function f() {
          const r = await Promise.all([inner(), inner()]);
          log.push("all");
          return log.join(",") + "|" + r[0];
        }`),
    ).toBe("a,a,b,b,all|2");
  });

  it("混合元素（pending + 已 settle）= 7（原生 7）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { const r = await Promise.all([inner(), Promise.resolve(5)]); return r[0] + r[1]; }`),
    ).toBe(7);
  });

  it("元素拒绝 ⇒ 组合子拒绝（catch 臂可达：原生 \"caught:boom\"）", () => {
    expect(
      awaitedVal(`async function inner() { await null; await null; throw new Error("boom"); }
        export async function f() {
          try { await Promise.all([inner(), inner()]); return "no"; }
          catch (e) { return "caught:" + e.message; }
        }`),
    ).toBe("caught:boom");
  });

  it("元素拒绝 ⇒ 组合子的 promise 面确定拒绝（fulfilled 域 never + reason 通道）", () => {
    const r = call(
      `async function inner() { await null; await null; throw new Error("boom"); }
       export async function f() { await Promise.all([inner(), inner()]); return "no"; }`,
      "f",
    );
    const sh = r.result.shape as { k?: string; inner?: { shape: { k: string } }; rejected?: unknown };
    expect(sh.k).toBe("eff");
    expect(sh.inner?.shape.k).toBe("never");
    expect(sh.rejected).toBeDefined();
  });

  it("一个元素拒绝 ⇒ 组合子拒绝（原生 \"caught:boom\"）", () => {
    expect(
      awaitedVal(`async function bad() { await null; await null; throw new Error("boom"); }
        async function good() { await null; await null; return 2; }
        export async function f() {
          try { await Promise.all([good(), bad()]); return "no"; }
          catch (e) { return "caught:" + e.message; }
        }`),
    ).toBe("caught:boom");
  });

  it("负控制：inner 无 await 时行为不变（原生 4）", () => {
    expect(
      awaitedVal(`async function inner() { return 2; }
        export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`),
    ).toBe(4);
  });

  it("负控制：inner 1 个 await 时行为不变（原生 4）", () => {
    expect(
      awaitedVal(`async function inner() { await null; return 2; }
        export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`),
    ).toBe(4);
  });

  it("负控制：元素全部已 settle 时走快路径（金标零漂移：promise<[1, 2]>）", () => {
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1), 2]); }`)).toContain(
      "promise<[1, 2]>",
    );
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1)]); }`)).toContain(
      "promise<[1]>",
    );
  });

  it("负控制：非可迭代输入不同步抛（原生折 rejection：promise<unknown>）", () => {
    expect(fmt(`export function f() { return Promise.all(1); }`)).toContain("promise<unknown>");
  });
});
