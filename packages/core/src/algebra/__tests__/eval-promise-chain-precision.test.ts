/**
 * R3 promise-chain precision：settle 三分类（确定 fulfilled / 确定 rejected /
 * state 未知）× catch/then/finally。
 *
 * - R3a：确定 fulfilled 接收者的 .catch 回调原生死代码——值原样透传
 *   （此前把 h(unknown reason) 并进值域：promise<1|2> 假臂）。
 * - R3b：确定 fulfilled + effectFree∧closed 回调 → 同步映射 promise<h(v)>
 *   （await p.then(h) 不再塌 unknown）。副作用/读外层态回调保持微任务路径
 *   （同步窗口副作用序不可破——closed/effectFree 双 facet 是同步执行门）。
 * - 混合态控制：fork（resolve|reject 双臂）/ state 未知（any 实参 →
 *   unsettled）保持 sound union。
 */
import { describe, it, expect } from "vitest";
import { formatAbs, anyAbs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { abs, numLit } from "../abs.ts";
import { absFunction } from "../abs-fn.ts";
import { noBody } from "../builtins/shared.ts";
import { evalPromiseMethod, drainPromiseMicros } from "../builtins/promise.ts";

function fmt(a: unknown): string {
  return formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
}

type EffShape = {
  shape?: { k?: string; eff?: string; inner?: unknown; rejected?: unknown; unsettled?: boolean };
};

function promiseShape(r: unknown): { inner: unknown; rejected: unknown; unsettled: boolean } {
  const a = r as EffShape;
  expect(a?.shape?.k, "expected eff shape").toBe("eff");
  expect(a?.shape?.eff, "expected promise eff").toBe("promise");
  return {
    inner: a!.shape!.inner,
    rejected: a!.shape!.rejected,
    unsettled: a!.shape!.unsettled === true,
  };
}

describe("R3a：确定 fulfilled 的 .catch 透传", () => {
  it("Promise.resolve(1).catch(e => 2) → promise<1>（回调死代码，不 join 回调值）", () => {
    expect(fmt(call(`export function f() { return Promise.resolve(1).catch((e) => 2); }`).result)).toBe(
      "promise<1>",
    );
  });

  it("值通道：Promise.resolve(1).catch(e => 2).then(v => v) → promise<1>", () => {
    expect(
      fmt(call(`export function f() { return Promise.resolve(1).catch((e) => 2).then((v) => v); }`).result),
    ).toBe("promise<1>");
  });

  it("executor 单 resolve 同口径：new Promise(r => r(7)).catch(e => 2) → promise<7>", () => {
    expect(fmt(call(`export function f() { return new Promise((r) => r(7)).catch((e) => 2); }`).result)).toBe(
      "promise<7>",
    );
  });

  it("缺省实参 Promise.resolve() → promise<undefined>（native 确定值，非 unknown）", () => {
    expect(fmt(call(`export function f() { return Promise.resolve(); }`).result)).toBe(
      "promise<undefined>",
    );
  });

  it("混合态控制：双通道 catch 保持 union（inner ∪ h(reason)）", () => {
    // 直接喂 {inner:1, rejected:2} 通道（用户态构造 fork 双臂 settle 的上游
    // 收集是另一个既有缺口，不在此钉）：两臂都活——fulfilled 透传 1、
    // rejected 臂 h(2)=12，不得丢臂
    const recv = abs(
      { k: "eff", eff: "promise", inner: numLit(1), rejected: numLit(2) },
      undefined,
      undefined,
      "path",
    );
    const h = absFunction(["e"], { body: noBody, apply: (a) => numLit(12) }, { ctor: false });
    const out = evalPromiseMethod("catch", recv, [h]);
    expect(out).toBeDefined();
    drainPromiseMicros();
    const sh = promiseShape(out);
    expect(fmt(sh.inner)).toBe("1 | 12");
    expect(sh.rejected).toBeUndefined();
  });

  it("state 未知控制：Promise.resolve(any).catch(e => 2) 保持回调臂", () => {
    const r = call(
      `export function f(a) { return Promise.resolve(a).catch((e) => 2); }`,
      "f",
      [anyAbs],
    );
    // any 实参可能 thenable（settle 不可判）→ 回调臂活：join(any, 2)
    expect(fmt(r.result)).toContain("2");
    expect(promiseShape(r.result).unsettled).toBe(true);
  });

  it("确定拒绝控制（既有 Bug 36 面不变）：Promise.reject(1).catch(e => e + 1) → promise<2>", () => {
    expect(fmt(call(`export function f() { return Promise.reject(1).catch((e) => e + 1); }`).result)).toBe(
      "promise<2>",
    );
  });
});

describe("R3b：确定 fulfilled 的 .then 同步映射（effectFree∧closed 回调）", () => {
  it("await p.then(h)：async 体折 exact（此前 promise<unknown>）", () => {
    const r = call(
      `async function g() { const p = Promise.resolve(21); return await p.then((x) => x * 2); }
       export function f() { return g(); }`,
    );
    expect(fmt(r.result)).toBe("promise<42>");
  });

  it("多跳链：.then(x => x * 2).then(y => y + 1) → promise<43>", () => {
    const r = call(
      `async function g() { return await Promise.resolve(21).then((x) => x * 2).then((y) => y + 1); }
       export function f() { return g(); }`,
    );
    expect(fmt(r.result)).toBe("promise<43>");
  });

  it("读外层态控制（closed 门）：回调读外层变量不进同步窗口（drain 时求值）", () => {
    // 原生：then 回调微任务时刻跑（f 返回后）→ 读到 n=10 → 15。
    // 引擎若同步执行非 closed 回调会读到旧值 6——假精确；closed facet 把
    // 读外层态回调留在微任务路径（drain 时 n=10 → 15）。
    const r = call(
      `let n = 1;
       export function f() { const q = Promise.resolve(5).then((v) => v + n); n = 10; return q; }`,
    );
    expect(fmt(r.result)).toBe("promise<15>");
    // await 变体：async 体同步跑完、await 塌 unknown（回调无 closed facet
    // 不同步折）——诚实降级 promise<unknown>，不得假折 6 或 15
    const a = call(
      `let n = 1;
       async function g() { return await Promise.resolve(5).then((v) => v + n); }
       export function f() { const r = g(); n = 10; return r; }`,
    );
    expect(fmt(a.result)).toBe("promise<unknown>");
  });

  it("副作用控制（effectFree 门）：副作用回调不进同步窗口（外层观测序保持）", () => {
    const x = call(
      `let x = 0;
       async function g() { return await Promise.resolve(1).then((v) => { x = 9; return v; }); }
       export function f() { const r = g(); return x; }`,
    );
    // 原生 f 同步返回 0（回调微任务后跑）；诚实降级：await 塌 unknown
    const { result } = x;
    const lv = result as { term?: { op?: string; value?: unknown } };
    expect(lv?.term?.value).toBe(0);
    const pr = call(
      `let x2 = 0;
       async function g2() { return await Promise.resolve(1).then((v) => { x2 = 9; return v; }); }
       export function f() { return g2(); }`,
    );
    expect(fmt(pr.result)).toBe("promise<unknown>");
  });

  it("纯抛错回调 → definite rejection（native：then 回调抛错折 rejection）", () => {
    expect(
      fmt(call(`export function f() { return Promise.resolve(1).then((x) => { throw new Error("boom"); }); }`).result),
    ).toBe("promise<never>");
  });

  it("回调返回 rejected promise → 递归采纳拒绝通道", () => {
    expect(
      fmt(call(`export function f() { return Promise.resolve(1).then((x) => Promise.reject(9)); }`).result),
    ).toBe("promise<never>");
  });

  it("then 第二实参 audit：确定 fulfilled 时 onRejected 死代码", () => {
    expect(
      fmt(call(`export function f() { return Promise.resolve(1).then((v) => v + 1, (e) => 99); }`).result),
    ).toBe("promise<2>");
  });

  it("then 第二实参 audit：双通道 join（f(v) ∪ g(reason)）", () => {
    const recv = abs(
      { k: "eff", eff: "promise", inner: numLit(1), rejected: numLit(2) },
      undefined,
      undefined,
      "path",
    );
    const f = absFunction(["v"], { body: noBody, apply: (a) => numLit(10) }, { ctor: false });
    const g = absFunction(["e"], { body: noBody, apply: (a) => numLit(102) }, { ctor: false });
    const out = evalPromiseMethod("then", recv, [f, g]);
    expect(out).toBeDefined();
    drainPromiseMicros();
    expect(fmt(promiseShape(out).inner)).toBe("10 | 102");
  });

  it("then 第二实参 audit：双通道 + 缺省 g → 拒绝透传通道保留", () => {
    const recv = abs(
      { k: "eff", eff: "promise", inner: numLit(1), rejected: numLit(2) },
      undefined,
      undefined,
      "path",
    );
    const f = absFunction(["v"], { body: noBody, apply: (a) => numLit(10) }, { ctor: false });
    const out = evalPromiseMethod("then", recv, [f]);
    expect(out).toBeDefined();
    drainPromiseMicros();
    const sh = promiseShape(out);
    // fulfilled 臂 f(1)=10；rejected 臂透传 reason 2（不静默吞）
    expect(fmt(sh.inner)).toBe("10");
    expect(fmt(sh.rejected)).toBe("2");
  });

  it("state 未知控制：Promise.resolve(any).then(x => x) 结果 unsettled", () => {
    const r = call(
      `export function f(a) { return Promise.resolve(a).then((x) => x); }`,
      "f",
      [anyAbs],
    );
    expect(promiseShape(r.result).unsettled).toBe(true);
  });
});

describe("finally audit（确定态 + effectFree∧closed 回调真执行）", () => {
  it("值透传：Promise.resolve(21).finally(() => 5) → promise<21>", () => {
    expect(fmt(call(`export function f() { return Promise.resolve(21).finally(() => 5); }`).result)).toBe(
      "promise<21>",
    );
  });

  it("回调定抛 → definite rejection（reason 替换，native 语义）", () => {
    expect(
      fmt(call(`export function f() { return Promise.resolve(21).finally(() => { throw 9; }); }`).result),
    ).toBe("promise<never>");
  });

  it("确定拒绝 + 正常回调：拒绝透传不变", () => {
    expect(fmt(call(`export function f() { return Promise.reject(1).finally(() => 3); }`).result)).toBe(
      "promise<never>",
    );
  });
});
