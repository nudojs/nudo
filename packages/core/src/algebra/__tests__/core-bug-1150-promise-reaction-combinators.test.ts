/**
 * Bug 1150 回归钉：**promise 反应面**（.then/.catch）与**其它组合子**
 * （race / any / allSettled）不得抢跑、不得取调用期快照。
 *
 * 原生（node v26.10.0 实测，见交付报告的原生基线表）：
 * - `await inner().then((v) => v + 1)`（inner 含 2 个 await）→ **3**
 * - `await Promise.all([inner(), inner()]).then((r) => r[0] + r[1])` → **4**
 * - `await Promise.race([inner(), Promise.resolve(9)])` → **9**（已 settle 的
 *   元素先赢——原生 race 是「首个 settle 赢」）
 * - `await Promise.any([inner(), Promise.resolve(9)])` → **9**（首个 fulfilled 赢）
 * - `await Promise.any([Promise.reject(1), innerRej()])` → **AggregateError**
 *   （全拒才拒）
 * - `await Promise.allSettled([inner(), Promise.resolve(9)])` →
 *   **fulfilled:2,fulfilled:9**（等全部 settle，逐项记 fulfilled/rejected）
 * - 兑现序：`log` = "a,a,b,b,then:2,after"（then 回调在 all 兑现**之后**跑）
 *
 * 修前（假绿）：
 * - `.then` / `.catch` 在 **pending 接收者**上按「已 fulfilled」处理 ⇒ 反应
 *   **抢跑**（回调读到占位符 `unknown`）⇒ `inner().then(v => v + 1)` 得
 *   `promise<number | string>`（原生 `promise<3>`）。
 * - `Promise.race` / `Promise.any` / `Promise.allSettled` 对元素 promise 取
 *   **调用期快照**（`elementSettle` 读 `shape.inner`）⇒ 兑现值被占位符
 *   **永久冻住**（原生 9 / 9 / fulfilled:2，引擎 unknown | 9 / unknown | 9 /
 *   fulfilled:unknown）。
 *
 * 根因：反应调度（`evalPromiseMethod` 的 `settledFulfilled` 判定 +
 * `queuePromiseMicro`）与组合子聚合都把 **pending 活通道**当「已 settle」⇒
 * 在元素 settle **之前**就把占位符读成终值。
 *
 * 修法（`builtins/promise.ts`）：**同一套** pending/waiter 机制
 * （`registerPendingPromise` / `isPendingPromiseShape` / `onPromiseSettled` /
 * `flushPromiseWaiters`——与 `exec/runtime/async.ts` 的 await 恢复点共用，
 * 不另造第二套）：
 * - 1150-a：接收者 pending ⇒ 反应**登记为 waiter**（待 settle 后再跑），
 *   结果 promise 自身是 live pending（`inner` 就地填）⇒ `await` 方排在
 *   settle 之后恢复；拒绝 ⇒ 走 rejection 通道（catch 臂可达）。
 * - 1150-b：race / any / allSettled 按原生语义建模（race 首个 settle 赢；
 *   any 首个 fulfilled 赢、全拒才 AggregateError；allSettled 等全部 settle
 *   并逐项记 fulfilled/rejected）；元素**全部已 settle** 时保留原快路径
 *   （金标零漂移）。
 *
 * 已知遗留（**不在本条归属**——悬挂元素建模缺口，见交付报告 1150-c 方案
 * 草案）：元素**永不 settle** 时组合子永不 settle，await 方永不恢复，且调用
 * 方 promise 停在 `inner=unknown` 且**不带 `unsettled` 标记**。
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

/** 2 个 await 的 inner（原生：兑现值 2） */
const INNER_TWO_AWAIT = `async function inner() { await null; await null; return 2; }`;

/** 2 个 await 后抛错的 inner（原生：拒绝 reason = Error("boom")） */
const INNER_REJECT = `async function innerRej() { await null; await null; throw new Error("boom"); }`;

describe("Bug 1150：promise 反应面（.then/.catch）与组合子（race/any/allSettled）不抢跑", () => {
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

  // ---------- 1150-a：反应面在 pending 接收者上抢跑 ----------

  it("then 在 pending 接收者上：回调读到终值（原生 3；修前 promise<number | string>）", () => {
    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return inner().then((v) => v + 1); }`),
    ).toContain("promise<3>");
  });

  it("then 在 pending 接收者上：await 面读到终值（原生 3）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await inner().then((v) => v + 1); }`),
    ).toBe(3);
  });

  it("check 面签名：promise<3>（原生 3；修前 promise<number | string>）", () => {
    const r = checkSource(
      "/t/src.js",
      `${INNER_TWO_AWAIT}
        export async function f() { const r = await inner().then((v) => v + 1); return r; }`,
      pTrue,
      {},
    );
    expect(sigOf(r, "f")).toBe("promise<3>");
  });

  it("then 在 pending 接收者上：拒绝 ⇒ onRejected 臂可达（原生 \"rej:boom\"）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() { return await innerRej().then((v) => "no", (e) => "rej:" + e.message); }`),
    ).toBe("rej:boom");
  });

  it("catch 在 pending 接收者上：catch 臂可达（原生 \"caught:boom\"）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() { return await innerRej().catch((e) => "caught:" + e.message); }`),
    ).toBe("caught:boom");
  });

  it("Promise.all(...).then(cb)：回调读到聚合终值（原生 4；修前 promise<number | string>）", () => {
    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.all([inner(), inner()]).then((r) => r[0] + r[1]); }`),
    ).toContain("promise<4>");
  });

  it("Promise.all(...).then(cb)：await 面读到终值（原生 4）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.all([inner(), inner()]).then((r) => r[0] + r[1]); }`),
    ).toBe(4);
  });

  it("兑现序：then 回调在 all 兑现之后（原生 \"a,a,b,b,then:2,after\"）", () => {
    expect(
      awaitedVal(`const log = [];
        async function innerL() { log.push("a"); await null; log.push("b"); await null; return 2; }
        export async function f() {
          const v = await Promise.all([innerL(), innerL()]).then((r) => { log.push("then:" + r[0]); return r[0]; });
          log.push("after");
          return log.join(",") + "|" + v;
        }`),
    ).toBe("a,a,b,b,then:2,after|2");
  });

  it("负控制：已 settle 接收者的反应面产物逐字不变（promise<2> / promise<43>）", () => {
    expect(fmt(`export function f() { return Promise.resolve(1).then((x) => x + 1); }`)).toContain(
      "promise<2>",
    );
    expect(
      fmt(`export function f() { return Promise.resolve(21).then((x) => x * 2).then((y) => y + 1); }`),
    ).toContain("promise<43>");
  });

  // ---------- 1150-b：race / any / allSettled 取调用期快照 ----------

  it("race：已 settle 的元素先赢（原生 9；修前 promise<unknown | 9>）", () => {
    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.race([inner(), Promise.resolve(9)]); }`),
    ).toContain("promise<9>");
  });

  it("race：await 面读到赢家终值（原生 9）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.race([inner(), Promise.resolve(9)]); }`),
    ).toBe(9);
  });

  it("race：pending 元素后 settle 不改写赢家（原生 9）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.race([innerRej(), Promise.resolve(9)]).then((v) => "f:" + v, (e) => "r:" + e.message);
        }`),
    ).toBe("f:9");
  });

  it("any：首个 fulfilled 赢（原生 9；修前 promise<unknown | 9>）", () => {
    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.any([inner(), Promise.resolve(9)]); }`),
    ).toContain("promise<9>");
  });

  it("any：await 面读到赢家终值（原生 9）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.any([inner(), Promise.resolve(9)]); }`),
    ).toBe(9);
  });

  it("any：全拒 ⇒ AggregateError（原生 AggregateError:All promises were rejected）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          try { await Promise.any([Promise.reject(new Error("k")), innerRej()]); return "no"; }
          catch (e) { return e.name + ":" + e.message; }
        }`),
    ).toBe("AggregateError:All promises were rejected");
  });

  it("any：pending 元素 fulfill 赢（原生 2）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.any([Promise.reject(new Error("k")), inner()]); }`),
    ).toBe(2);
  });

  it("allSettled：等全部 settle，逐项记 fulfilled（原生 \"fulfilled:2,fulfilled:9\"）", () => {
    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() {
          return await Promise.allSettled([inner(), Promise.resolve(9)]).then((r) => r[0].status + ":" + r[0].value + "," + r[1].status + ":" + r[1].value);
        }`),
    ).toBe("fulfilled:2,fulfilled:9");
  });

  it("allSettled：逐项记 rejected（原生 \"rejected:boom,fulfilled:9\"）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.allSettled([innerRej(), Promise.resolve(9)]).then((r) => r[0].status + ":" + r[0].reason.message + "," + r[1].status + ":" + r[1].value);
        }`),
    ).toBe("rejected:boom,fulfilled:9");
  });

  it("负控制：race/any/allSettled 快路径产物逐字不变", () => {
    expect(fmt(`export function f() { return Promise.race([1, "a"]); }`)).toContain('promise<1 | "a">');
    expect(fmt(`export function f() { return Promise.any([1]); }`)).toContain("promise<1>");
    expect(fmt(`export function f() { return Promise.allSettled([1]); }`)).toContain(
      'status: "fulfilled" | "rejected"',
    );
  });

  // ---------- 组合子与反应面的交叉面（拒绝臂不丢） ----------

  it("组合子拒绝 ⇒ then 的 onRejected 臂可达（原生 \"rej:boom\"）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.all([innerRej(), innerRej()]).then((v) => "f:" + v, (e) => "rej:" + e.message);
        }`),
    ).toBe("rej:boom");
  });

  it("组合子拒绝 ⇒ catch 臂可达（原生 \"caught:boom\"）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.all([innerRej(), innerRej()]).catch((e) => "caught:" + e.message);
        }`),
    ).toBe("caught:boom");
  });

  it("race 拒绝 ⇒ then 的 onRejected 臂可达（原生 \"rej:r\"）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.race([innerRej(), Promise.reject("r")]).then((v) => "f:" + v, (e) => "rej:" + e);
        }`),
    ).toBe("rej:r");
  });

  it("any 全拒 ⇒ then 的 onRejected 臂拿到 AggregateError（原生同名）", () => {
    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.any([Promise.reject("a"), Promise.reject("b")]).then((v) => "f:" + v, (e) => e.name + ":" + e.message);
        }`),
    ).toBe("AggregateError:All promises were rejected");
  });
});
