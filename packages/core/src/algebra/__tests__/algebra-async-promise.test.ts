/**
 * 模块套件：core algebra 面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { call, objSlots, val, throwsError, isNever, tupleEls, resetEngineCaches } from "./eval-helpers.ts";
import { $await } from "../exec/runtime/async.ts";
import { formatShape, formatAbs as formatAbs_____format_format_ts } from "../format/format.ts";
import { litValue, type Abs, anyAbs, abs, absLit } from "../abs.ts";
import { litValue as litValue___nudojs_core, formatAbs, type Abs as Abs___nudojs_core, abs as abs___nudojs_core, numLit, } from "@nudojs/core";
import { denoteGuard } from "../denote.ts";
import { absToConstraint } from "../contract/projection.ts";
import { aggregateErrorAbs } from "../builtins/promise.ts";
import { errorBrandAbs } from "../builtins/error/error-family.ts";
import { evalNamespaceCall } from "../builtins/error.ts";
import { litValue as litValue_____index_ts, formatShape as formatShape_____index_ts, checkSource, pTrue } from "../index.ts";
import { objOf } from "../objects.ts";
import { $len } from "../exec/runtime/containers/arr-index.ts";
import { sigOf } from "./nudo-constraints.ts";
import { takeRefineDiags } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";

// ---------------------------------------------------------------------------
// [merged] handler-return-thenable
// ---------------------------------------------------------------------------
describe("handler-return-thenable", () => {
// MERGED (topic-related bug pins): handler-return-thenable + thenable-adoption
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * 邻面回归钉：**then / catch / finally 回调返回值**的 thenable 采纳。
 *
 * 原生（ES2023 `PerformPromiseThen` + `PromiseResolve`）：
 * 回调的**返回值**走 `PromiseResolve` ⇒ 返回值是对象且 `Get(then)` 可调用 ⇒
 * 走 `PromiseResolveThenableJob` ⇒ 结果 promise 的兑现值 = `then(res, rej)`
 * 给出的 settle 值（**不是** thenable 对象本身）。
 * - `await Promise.resolve(1).then(() => ({then:(r)=>r(5)}))` ⇒ `5`（原生实测）
 * - `Promise.resolve(1).then(() => ({then:(r)=>r(5)}))` ⇒ 值域 `promise<5>`
 *
 * 引擎此前把 thenable **对象本身**当成待决值（只标 unsettled，从不调 `then`）
 * ⇒ 声明出与原生**互斥**的具体类型（原生 `number` vs 引擎 `object`）。
 *
 * 修法（`builtins/promise.ts`）：复用片 S8（族 38）建立的**唯一**采纳机制
 * `thenableAdoption` / `adoptThenableChain`（**不另造一套**），在
 * then / catch / finally 的**回调返回值记账点**上按 `Promise.resolve` 面
 * 同款映射：
 * - `settled` + resolved → 兑现值；
 * - `settled` + rejected → 拒绝通道（reason）；
 * - `pending`（`then` 调过没 settle）→ 永挂（unsettled，不猜）；
 * - `undecidable`（采纳面不可判）→ 原值 + 永挂；
 * - `noThen` / `thenNotCallable` → 普通值（原生 `Get(then)` 不可调用 ⇒ 以该值
 * 兑现，不抛 TypeError）。
 *
 * `finally` 臂的原生语义（node v26 实测）：回调返回值是 thenable ⇒ **等它
 * settle**，但**兑现值丢弃**（`finally` 不改 settled value）⇒
 * `Promise.resolve(1).finally(() => ({then:(r)=>r(5)}))` ⇒ `1`（不是 5）；
 * thenable 调 reject ⇒ 结果被拒且 reason **替换**原 reason；thenable 没
 * settle ⇒ 结果 promise 永挂。
 *
 * 口径边界（已登记）：
 * - 宿主在**微任务**里调 `then`，引擎在求值点**抽象地**调（await 面 /
 * `Promise.resolve` 面同款近似）⇒ 兑现值同款，`then` 体副作用的**时序**与
 * 原生不同。
 * - 采纳面**不可判**（any/unknown/fn/开对象/可选 `then` 槽）⇒ 仍标 unsettled
 * （settle 不可判，不猜）——与 `Promise.resolve` 面同款。
 * - 采纳链深度上限 8（与片 S8 同款）。
 */






/** promise Abs 的兑现值域（eff(promise).inner）/ 拒绝通道 / 悬挂标记 */
function promiseParts(r: Abs): { inner: Abs; rejected?: Abs; unsettled: boolean } {
  const sh = r.shape as {
    k: string;
    eff?: string;
    inner: Abs;
    rejected?: Abs;
    unsettled?: boolean;
  };
  expect(sh.k).toBe("eff");
  expect(sh.eff).toBe("promise");
  return { inner: sh.inner, rejected: sh.rejected, unsettled: sh.unsettled === true };
}

describe("邻面：then 回调返回值的 thenable 采纳", () => {
  it("thenable 的兑现值进 promise 的值域（原生 5，引擎改前 { then: (r) => ? }）；非 thenable 对照：回调返回普通值 ⇒ 逐字不变（promise<7>）；非 thenable 对照：回调返回普通对象 ⇒ 逐字不变（promise<{ a: 1 }>）；负控：then 不是函数 ⇒ 按普通值兑现（原生同款，promise<{ then: 1 }>）；负控：then 调过但没 settle ⇒ 永挂（unsettled，不猜）；负控：th", () => {
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: (r) => r(5) }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<5>");
    const p = promiseParts(r.result);
    expect(formatShape(p.inner)).toBe("5");
    expect(p.rejected).toBeUndefined();
    expect(p.unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => 7);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
    const p = promiseParts(r.result);
    expect(formatShape(p.inner)).toBe("7");
    expect(p.rejected).toBeUndefined();
    expect(p.unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ a: 1 }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ a: 1 }>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: 1 }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ then: 1 }>");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(false);
    expect(objSlots(p.inner)).toEqual({ then: 1 });
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: () => {} }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("unknown");
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    // 兑现臂不可能（fulfilled 域 never）+ rejected 通道携带 reason
    expect(p.inner.shape.k).toBe("never");
    expect(p.rejected).toBeDefined();
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: () => { throw new Error("nope"); } }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(p.rejected).toBeDefined();
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: (res, rej) => { res(5); rej("boom"); } }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<5>");
    expect(promiseParts(r.result).rejected).toBeUndefined();
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: (r) => r({ then: (r2) => r2(7) }) }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => Promise.resolve(5));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<5>");
  }
});









});

describe("邻面：catch 回调返回值的 thenable 采纳", () => {
  it("catch 臂的回调返回值是 thenable ⇒ 同款采纳（原生 5）；非 thenable 对照：catch 回调返回普通值 ⇒ 逐字不变（promise<7>）；负控：catch 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）；负控：catch 回调返回的 thenable 调 reject ⇒ rejected 通道记录该 reason", () => {
  {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => ({ then: (r) => r(5) }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<5>");
    const p = promiseParts(r.result);
    expect(formatShape(p.inner)).toBe("5");
    expect(p.rejected).toBeUndefined();
    expect(p.unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => 7);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => ({ then: () => {} }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("unknown");
  }
  {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => ({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  }
});



});

describe("邻面：finally 回调返回值的 thenable 采纳", () => {
  it("finally 臂的回调返回值是 thenable ⇒ 同款采纳（原生：兑现值丢弃，保留原值 1）；非 thenable 对照：finally 回调返回普通值 ⇒ 逐字不变（promise<1>）；负控：finally 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）；负控：finally 回调返回的 thenable 调 reject ⇒ 结果被拒（reason 替换原 reason）；finally 臂的拒绝通道透传 + thenable 调", () => {
  {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => ({ then: (r) => r(5) }));
}
`;
    const r = call(src, "f");
    // 原生 finally 不改 settled value ⇒ promise<1>（不是 promise<5>）
    expect(formatShape(r.result)).toBe("promise<1>");
    const p = promiseParts(r.result);
    expect(p.rejected).toBeUndefined();
    expect(p.unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => 7);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => ({ then: () => {} }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("1");
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => ({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  }
  {
    const src = `
export function f() {
  return Promise.reject("orig").finally(() => ({ then: (res, rej) => rej("new") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "new" });
  }
});




});

describe("邻面：await 面与 promise 面同款（不回归）", () => {
  it("await then 臂的 thenable 兑现值（原生 6）；await catch 臂的 thenable 兑现值（原生 6）；await finally 臂的 thenable ⇒ 原生保留原值（2）；await 拒绝通道：then 臂的 thenable 调 reject ⇒ await 抛该 reason；await 非 thenable 不受影响（原生 8）", () => {
  {
    const src = `
export async function f() {
  const v = await Promise.resolve(1).then(() => ({ then: (r) => r(5) }));
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  }
  {
    const src = `
export async function f() {
  const v = await Promise.reject("x").catch(() => ({ then: (r) => r(5) }));
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  }
  {
    const src = `
export async function f() {
  const v = await Promise.resolve(1).finally(() => ({ then: (r) => r(5) }));
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `
export async function f() {
  try {
    await Promise.resolve(1).then(() => ({ then: (res, rej) => rej("boom") }));
    return "no-throw";
  } catch (e) {
    return "caught:" + e;
  }
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "caught:boom" });
  }
  {
    const src = `
export async function f() {
  const v = await Promise.resolve(1).then(() => 7);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 8 });
  }
});




});
}

describe("thenable-adoption", () => {
/**
 * 回归钉：**Promise 构造器 / 静态 resolve 的 thenable 采纳**。
 *
 * 原生（ES2023 `PromiseResolve` / `NewPromiseCapability` + `PromiseResolveThenableJob`）：
 * `Promise.resolve(thenable)` 与 `new Promise(resolve => resolve(thenable))`
 * 对**非 promise 值**都要走 PromiseResolveThenableJob——取
 * `then = Get(resolution, "then")`，**可调用**则调 `then(resolveFn, rejectFn)`，
 * 由它决定兑现值 ⇒ 宿主兑现 `1`（`r(1)` 触发了内层的 `resolve(1)`）。
 *
 * 引擎此前把 thenable **对象本身**当成待决值（只标 unsettled，从不调 `then`）
 * ⇒ 声明出与原生**互斥**的具体类型（原生 `number` vs 引擎 `object`）⇒ 该值域
 * 会一路进 dts / zod / guard / standard 产物面。
 *
 * 修法（`builtins/promise.ts`）：
 * - 新增 thenable 采纳机制 `thenableAdoption` / `adoptThenableChain`
 * （**判定与调用**与 await 面（`exec/runtime/async.ts` 的 `adoptThenable`，
 * ）**同一套**——不另造）；
 * - 采纳入口三处统一：`Promise.resolve` 静态臂、`new Promise` 执行器 `resolve`
 * 采集臂、await 面（复用）。
 *
 * 口径边界（已登记）：
 * - 宿主在**微任务**里调 `then`，引擎在求值点**抽象地**调（await 面同款近似）
 * ⇒ 兑现值同款，`then` 体副作用的**时序**与原生不同（原生在微任务里）。
 * - 采纳面**不可判**（any/unknown/fn/开对象/可选 `then` 槽）⇒ 仍标 unsettled
 * （settle 不可判，不猜）。
 * - `then` **不可调用** ⇒ 原生按**普通值**兑现（`Get(then)` 不可调用 ⇒ 直接以
 * 该值兑现）⇒ 引擎同款（不再当 unsettled）。
 */






/** promise Abs 的兑现值域（eff(promise).inner）/ 拒绝通道 / 悬挂标记 */
function promiseParts(r: Abs): { inner: Abs; rejected?: Abs; unsettled: boolean } {
  const sh = r.shape as {
    k: string;
    eff?: string;
    inner: Abs;
    rejected?: Abs;
    unsettled?: boolean;
  };
  expect(sh.k).toBe("eff");
  expect(sh.eff).toBe("promise");
  return { inner: sh.inner, rejected: sh.rejected, unsettled: sh.unsettled === true };
}

describe("Promise.resolve 的 thenable 采纳", () => {
  it("thenable 的兑现值进 promise 的值域（原生 1，引擎改前 { then: (r) => ? }）；负控制：非 thenable 的值不被采纳（Promise.resolve(1) → promise<1>）；负控制：非 thenable 的对象照旧（Promise.resolve({a:1}) → promise<{ a: 1 }>）；负控制：promise 实参仍走 promise 通道（Promise.resolve(Promise.resolve(1))", () => {
  {
    const src = `
export function f() {
  return Promise.resolve({ then: (r) => r(1) });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
    const p = promiseParts(r.result);
    expect(formatShape(p.inner)).toBe("1");
    expect(p.rejected).toBeUndefined();
    expect(p.unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(1);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ a: 1 });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ a: 1 }>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return Promise.resolve(Promise.resolve(1));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: 1 });
}
`;
    const r = call(src, "f");
    // 原生：Get(then) 不可调用 ⇒ 以该值兑现 ⇒ promise<{ then: 1 }>（确定 fulfilled）
    expect(formatShape(r.result)).toBe("promise<{ then: 1 }>");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(false);
    expect(objSlots(p.inner)).toEqual({ then: 1 });
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: (res, rej) => rej("boom") });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    // 兑现臂不可能（fulfilled 域 never）+ rejected 通道携带 reason
    expect(p.inner.shape.k).toBe("never");
    expect(p.rejected).toBeDefined();
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  }
  {
    const src = `
export async function f() {
  try {
    await Promise.resolve({ then: (res, rej) => rej("boom") });
    return "no-throw";
  } catch (e) {
    return "caught:" + e;
  }
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "caught:boom" });
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: () => { throw new Error("nope"); } });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(p.rejected).toBeDefined();
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: (r) => r({ then: (r2) => r2(7) }) });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: () => {} });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("unknown");
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: (res, rej) => { res(1); rej("boom"); } });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: (res, rej) => { rej("boom"); res(1); } });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  }
  {
    const src = `
export function f() {
  return Promise.resolve({ then: (res) => { res(1); throw new Error("late"); } });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
  }
});












});

describe("new Promise(resolve => resolve(thenable)) 的采纳", () => {
  it("执行器 resolve 采到 thenable ⇒ 兑现值进 promise 的值域（原生 1）；执行器 resolve 采到非 thenable ⇒ 照旧（promise<{ a: 1 }>）；执行器 resolve 采到 thenable 且 then 调 reject ⇒ 拒绝通道带 reason", () => {
  {
    const src = `
export function f() {
  return new Promise((resolve) => resolve({ then: (r) => r(1) }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
    const p = promiseParts(r.result);
    expect(formatShape(p.inner)).toBe("1");
    expect(p.unsettled).toBe(false);
  }
  {
    const src = `
export function f() {
  return new Promise((resolve) => resolve({ a: 1 }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ a: 1 }>");
  }
  {
    const src = `
export function f() {
  return new Promise((resolve) => resolve({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  }
});


});

describe("await 面与 promise 面共用同一套采纳机制（不回归）", () => {
  it("await thenable 仍交付 settle 值（原生 6，机制同款）；await promise 面采纳后的兑现值（await Promise.resolve(thenable) → 1）；await 非 thenable 不受影响（await 5 → 5）", () => {
  {
    const src = `
export async function f() {
  const v = await { then: (r) => r(5) };
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  }
  {
    const src = `
export async function f() {
  const v = await Promise.resolve({ then: (r) => r(1) });
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `
export async function f() {
  const v = await 5;
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  }
});


});
});
});

// ---------------------------------------------------------------------------
// [merged] async-generator
// ---------------------------------------------------------------------------
describe("async-generator", () => {
// MERGED (topic-related bug pins): async-generator + async-iter-elems + decl-async-generator
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>




{
/**
 * 回归：async generator 的 **async 面**。
 *
 * ES 语义：`async function*`（及 `async *` 方法）返回 AsyncGenerator——
 * next()/return()/throw() 返回 **promise**（promise<iterResult>）、装
 * `@@asyncIterator` 自返方法、`Object.prototype.toString` 折
 * "[object AsyncGenerator]"，且**不**有 `@@iterator`（同步迭代面缺席）。
 *
 * 修复前：async generator 与同步 generator 同编（$gen 同步协议对象）——
 * next() 返回裸 iterResult（无 then）、无 @@asyncIterator、tag 折
 * "[object Object]"。
 *
 * 覆盖面：函数**表达式**面与 class **方法**面（async generator 声明面
 * `async function* g(){}` 走 transpile/stmt/statement.ts 的声明分支——
 * 不在本批修复范围，见交付报告）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("async generator：async 面（promise 迭代协议）", () => {
  describe("函数表达式面", () => {
    it("next() 返回 promise（typeof next().then === function）；next() 的结果是 Promise 实例；装 @@asyncIterator 自返方法；Object.prototype.toString 折 [object AsyncGenerator]；同步迭代面缺席（原生无 @@iterator）", () => {
    {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g().next().then;`)),
      ).toEqual({ ok: true, value: "function" });
    }
    {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return g().next() instanceof Promise;`)),
      ).toEqual({ ok: true, value: true });
    }
    {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g()[Symbol.asyncIterator];`)),
      ).toEqual({ ok: true, value: "function" });
    }
    {
      expect(
        v(
          wrap(
            `const g = async function*(){ yield 1; }; return Object.prototype.toString.call(g());`,
          ),
        ),
      ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
    }
    {
      expect(
        v(wrap(`const g = async function*(){ yield 1; }; return typeof g()[Symbol.iterator];`)),
      ).toEqual({ ok: true, value: "undefined" });
    }
});




  });

  describe("class 方法面", () => {
    it("async *m(){}：next() 返回 promise；async *m(){}：装 @@asyncIterator；async *m(){}：tag 折 [object AsyncGenerator]", () => {
    {
      expect(
        v(wrap(`class A { async *m(){ yield 1; } } return typeof new A().m().next().then;`)),
      ).toEqual({ ok: true, value: "function" });
    }
    {
      expect(
        v(
          wrap(
            `class A { async *m(){ yield 1; } } return typeof new A().m()[Symbol.asyncIterator];`,
          ),
        ),
      ).toEqual({ ok: true, value: "function" });
    }
    {
      expect(
        v(
          wrap(
            `class A { async *m(){ yield 1; } } return Object.prototype.toString.call(new A().m());`,
          ),
        ),
      ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
    }
});


  });

  describe("负控制：同步 generator 不得回归", () => {
    it("next() 仍是裸函数（非 promise）；同步 generator 仍有 @@iterator；同步 generator 的 next() 不是 promise", () => {
    {
      expect(v(wrap(`function* g(){ yield 1; } return typeof g().next;`))).toEqual({
        ok: true,
        value: "function",
      });
    }
    {
      expect(v(wrap(`function* g(){ yield 1; } return typeof g()[Symbol.iterator];`))).toEqual({
        ok: true,
        value: "function",
      });
    }
    {
      expect(
        v(wrap(`function* g(){ yield 1; } return g().next() instanceof Promise;`)),
      ).toEqual({ ok: true, value: false });
    }
});


  });
});
}

describe("async-iter-elems", () => {
/**
 * 回归（**for-await 元素域**面）：async generator 的元素域必须走
 * **元素侧表**（与同步 generator 同口径），不得落 asyncOnly 的 unknown
 * 快路径。
 *
 * 背景：async generator 装 @@asyncIterator 槽（无 @@iterator 槽）⇒
 * `for await` 走「仅异步可迭代」分支。此前该分支的元素域恒折 unknown
 * ⇒ 循环变量退 unknown ⇒ 累加值退 `number | unknown`（原生是精确 3）。
 * 这是一条**精度回退**（改前 async generator 被误编成同步 generator 时，
 * for-await 走同步元素面，累加值恰好精确）。
 *
 * 修法（core exec/runtime/containers/iterate.ts）：
 * - asyncOnly 分支：接收者是**生成器对象**（有生成器消费视图）⇒ 元素取
 * 侧表剩余条目（逐项 await），长度亦由侧表给出（sideIterLen 兜底读
 * 消费视图的剩余条目数——async generator 无 @@iterator 槽，
 * matchIterElements 不命中）；
 * - 非生成器的仅异步可迭代对象元素域不可静态刻画 → 仍折 unknown。
 *
 * 本文件的断言与 Node 真实执行结果对齐（原生 ground truth 见各用例注释）。
 */





/** 剥外层 promise（async 函数面：返回值恒 promise<内层>） */
function unwrapPromise(a: Abs): Abs {
  return a.shape.k === "eff" && a.shape.eff === "promise" ? a.shape.inner : a;
}

/** async 函数体的求值结果（剥 promise 后的字面量值） */
function v(src: string) {
  return litValue(unwrapPromise(call(src, "f").result));
}

const wrap = (body: string) => `export async function f() { ${body} }`;

describe("async generator 的 for-await 元素域（走元素侧表）", () => {
  it("async generator（函数表达式面）：for-await 累加精确 3（原生 1+2=3）；async generator：三个 yield 累加精确 6（原生 1+2+3=6）；async generator：单个 yield 精确 7；async generator：字符串元素逐项拼接精确 \"ab\"（原生 \"ab\"）；async generator：空生成器 → 0 次迭代，精确 0（原生 0）；class async *m(){}：for-await 累加精确", () => {
  {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield 1; yield 2; }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield 1; yield 2; yield 3; }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 6 });
  }
  {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield 7; }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 7 });
  }
  {
    expect(
      v(
        wrap(
          `const g = async function*(){ yield "a"; yield "b"; }; let t = ""; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: "ab" });
  }
  {
    expect(
      v(
        wrap(
          `const g = async function*(){ }; let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  }
  {
    expect(
      v(
        wrap(
          `class A { async *m(){ yield 1; yield 2; } } let t = 0; for await (const v of new A().m()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    const r = call(
      wrap(
        `const g = async function*(){ yield 1; yield 2; }; let t = 0; for await (const v of g()) t += v; return t;`,
      ),
      "f",
    );
    // 内层是精确 3（不是含 unknown 的并集）
    expect(litValue(unwrapPromise(r.result))).toEqual({ ok: true, value: 3 });
  }
});






});

describe("负控制：不得被本修复波及的邻近形态", () => {
  it("同步 generator 的 for-await（同步迭代器回退）仍是精确 3；数组的 for-await（同步回退）仍是精确 3；同步 generator 的 for-of（同步迭代面）仍是精确 3；普通 async 函数（非 generator）不受影响；非生成器的仅异步可迭代对象：元素域仍折 unknown（不得臆造元素）；async generator 的 next() 仍返 promise（Bug 141 主修复面不回归）；同步 generator 的 next()", () => {
  {
    expect(
      v(
        wrap(
          `function* g(){ yield 1; yield 2; } let t = 0; for await (const v of g()) t += v; return t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      v(wrap(`let t = 0; for await (const v of [1, 2]) t += v; return t;`)),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      v(wrap(`function* g(){ yield 1; yield 2; } let t = 0; for (const v of g()) t += v; return t;`)),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(v(wrap(`const h = async () => 5; return await h();`))).toEqual({
      ok: true,
      value: 5,
    });
  }
  {
    const r = call(
      wrap(
        `const ai = {}; ai[Symbol.asyncIterator] = function () {}; let s = 0; for await (const v of ai) { s += v; } return s;`,
      ),
      "f",
    );
    const inner = unwrapPromise(r.result);
    // 元素域不可静态刻画 ⇒ 累加器退 unknown（不是精确 0）
    expect(litValue(inner).ok).toBe(false);
    expect(inner.shape.k).not.toBe("prim");
  }
  {
    expect(
      v(wrap(`const g = async function*(){ yield 1; }; return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(wrap(`function* g(){ yield 1; }; return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: false });
  }
});






});
});

describe("decl-async-generator", () => {
/**
 * 回归（续作）：async generator 的**声明面**
 * （`async function* g(){}` 语句形态）。
 *
 * ES 语义：`async function*` 返回 AsyncGenerator——next()/return()/throw()
 * 返回 **promise**、装 `@@asyncIterator` 自返方法、`Object.prototype.toString`
 * 折 "[object AsyncGenerator]"，且**不**有 `@@iterator`（同步迭代面缺席）。
 *
 * 修复前：声明面仍被编成**同步** generator（`$gen(() => {…})` 未透 async 位）
 * ⇒ next() 返回裸 iterResult（无 then）、无 @@asyncIterator、tag 折
 * "[object Object]"，且错误地带上了同步迭代面（@@iterator）。
 *
 * 声明面与函数**表达式**面 / class **方法**面（已修，见
 * eval--async-generator.part.ts）同属一条语义线；本文件只补声明面。
 *
 * 不变量（负控制钉住）：同步 generator 声明仍是同步协议（无 then、有
 * @@iterator）；async **函数**（非 generator）声明仍返回 promise。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 嵌套声明（函数体内的 `async function* g(){}`） */
const wrap = (body: string) => `export function f() { ${body} }`;

describe("async generator 声明面：async 面（promise 迭代协议）", () => {
  it("嵌套声明：next() 返回 promise（typeof next().then === function）；嵌套声明：next() 的结果是 Promise 实例；嵌套声明：装 @@asyncIterator 自返方法；嵌套声明：Object.prototype.toString 折 [object AsyncGenerator]；嵌套声明：同步迭代面缺席（原生无 @@iterator）；模块级声明：next() 返回 promise；模块级声明：装 @@asyncIte", () => {
  {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(wrap(`async function* g(){ yield 1; } return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: true });
  }
  {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g()[Symbol.asyncIterator];`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(
        wrap(
          `async function* g(){ yield 1; } return Object.prototype.toString.call(g());`,
        ),
      ),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  }
  {
    expect(
      v(wrap(`async function* g(){ yield 1; } return typeof g()[Symbol.iterator];`)),
    ).toEqual({ ok: true, value: "undefined" });
  }
  {
    expect(
      v(`async function* g(){ yield 1; }
         export function f() { return typeof g().next().then; }`),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(`async function* g(){ yield 1; }
         export function f() { return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  }
});






});

describe("负控制：同步 generator / async 函数声明不得回归", () => {
  it("同步 generator 声明：next() 不是 promise；同步 generator 声明：仍有 @@iterator；同步 generator 声明：next() 仍是裸函数（无 then）；async 函数（非 generator）声明：仍返回 promise", () => {
  {
    expect(
      v(wrap(`function* g(){ yield 1; } return g().next() instanceof Promise;`)),
    ).toEqual({ ok: true, value: false });
  }
  {
    expect(
      v(wrap(`function* g(){ yield 1; } return typeof g()[Symbol.iterator];`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(wrap(`function* g(){ yield 1; } return typeof g().next().then;`)),
    ).toEqual({ ok: true, value: "undefined" });
  }
  {
    expect(
      v(wrap(`async function g(){ return 1; } return typeof g().then;`)),
    ).toEqual({ ok: true, value: "function" });
  }
});



});
});
});

// ---------------------------------------------------------------------------
// static async 方法进 $async 包装
// ---------------------------------------------------------------------------
describe("static async 方法进 $async 包装", () => {
/**
 * 回归：class 的 **static async 方法**未进 $async 包装。
 *
 * ES 语义：`static async m(){}` 与实例 async 方法同语义——调用返回
 * **promise**；函数体 throw 不同步抛到调用点（确定拒绝 promise）。
 *
 * 修复前：静态方法分支不包 $async——返回原始值（typeof → "number"）、
 * 体内 throw 变同步抛（调用点直接 catch 到）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("static async 方法返回 promise（typeof → object）；static async 方法的返回是 Promise 实例；体内 throw 不同步抛到调用点（此前同步抛）；负控制：实例 async 方法仍返回 promise；负控制：静态同步方法仍返回原始值；负控制：静态同步方法的 throw 仍同步抛", () => {
  {
    expect(v(wrap(`class A { static async m(){ return 1; } } return typeof A.m();`))).toEqual({
      ok: true,
      value: "object",
    });
  }
  {
    expect(
      v(wrap(`class A { static async m(){ return 1; } } return A.m() instanceof Promise;`)),
    ).toEqual({ ok: true, value: true });
  }
  {
    expect(
      v(
        wrap(
          `class A { static async m(){ throw new Error("x"); } } try { A.m().catch(() => {}); return "nothrow"; } catch (e) { return "sync-throw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "nothrow" });
  }
  {
    expect(v(wrap(`class A { async m(){ return 1; } } return typeof new A().m();`))).toEqual({
      ok: true,
      value: "object",
    });
  }
  {
    expect(v(wrap(`class A { static m(){ return 1; } } return typeof A.m();`))).toEqual({
      ok: true,
      value: "number",
    });
  }
  {
    expect(
      throwName(wrap(`class A { static m(){ throw new Error("x"); } } A.m(); return 1;`)),
    ).toBe("Error");
  }
});






});

// ---------------------------------------------------------------------------
// await 挂起点（await 之后的副作用不进调用方的同步窗口）
// ---------------------------------------------------------------------------
describe("await 挂起点（await 之后的副作用不进调用方的同步窗口）", () => {
/**
 * 回归钉：`await` **真挂起**——async 体在 await 处挂起，
 * await 之后的语句**不在调用点内联跑完**（原生：恢复点是微任务）。
 *
 * 原生：`await` 挂起当前 async 体——`await` 之后的语句在**微任务**里
 * 才跑 ⇒ 调用方在同步窗口看不到 await 之后的副作用。引擎的 async 体此前
 * 是**eager 一把跑**（`$async(() => { ... })` 线性体，`await x` 只是
 * 一次普通调用）⇒ await 之后的副作用对调用方**立即可见**。
 *
 * 修法（转译侧 `exec/transpile/**` + 运行时侧 `exec/runtime/async.ts`）：
 * - async 体（**直接含 await**）编译成**宿主生成器** `function*(){…}`，
 * `await x` 发射 `yield x`（挂起点 + 被等待值）；
 * - `$asyncGen` 驱动生成器：同步段跑到第一个挂起点即返回 promise，
 * 续体登记到**宿主微任务队列**（与 promise reaction 同一队列 ⇒ 跨
 * promise 链顺序保真）；
 * - 续体跑完 ⇒ **就地**填 promise 的 inner（值域由续体终值给出）。
 *
 * 口径边界（已登记）：
 * - `for await` 走**整循环一个**挂起点（原生是每轮一个 await）——与引擎
 * 既有的同步 for-await 建模一致；
 * - async 体的 await 落在**分支臂 / 循环体 / switch 臂 / 短路表达式右臂**
 * （宿主 thunk 位置）时，`yield` 会是语法错误 ⇒ 这类体**整体**沿用既有
 * 同步路径（行为不变，挂起缺陷仍在该形态上）。
 */





/** 调用导出的 f，返回同步段观测到的字面量值 */
function syncVal(src: string): unknown {
  const r = call(src, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : lv;
}


  it("原生：f() 返回后 await 之前的写可见、之后的写不可见（n = 0）；原生：await 之后的副作用不进调用方的同步窗口（log = \"a\"）；原生：for-await 体的 await 之后的效果同样延后；原生：async 函数返回 pending promise（Promise { 0 } ⇒ promise<0>）", () => {
  {
    expect(
      syncVal(`let n = 0;
        async function g() { await 0; n = 5; }
        export function f() { g(); return n; }`),
    ).toBe(0);
  }
  {
    expect(
      syncVal(`const log = [];
        async function g() { log.push("a"); await 1; log.push("b"); await 2; log.push("c"); }
        export function f() { g(); return log.join(","); }`),
    ).toBe("a");
  }
  {
    expect(
      syncVal(`const log = [];
        async function g() { for await (const x of [1, 2]) log.push(x); }
        export function f() { g(); log.push("s"); return log.join(","); }`),
    ).toBe("s");
  }
  {
    const src = `
export async function f() {
  let n = 0;
  async function g() { await 0; n = 5; }
  g();
  return n;
}
`;
    const r = call(src, "f");
    // 同步段返回 n=0（await 之后的 n=5 尚未发生）⇒ promise<0>
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 0 });
  }
});





describe("await 之后的写对调用点完全不可见（含顺序与 typeof）", () => {
  it("await 之前的写保留（原生 1，引擎改前 11）；调用点自身的同步语句不被 async 续体插队（原生 \"1,3,4\"）；await 之后的写对 typeof 观察不可见（原生 \"undefined\"）；箭头 async 体同样挂起（原生 \"a,c\"，引擎改前 \"a,b,c\"）；pending promise 不被穿行（原生 \"a\"，引擎改前 \"a,b\"）", () => {
  {
    expect(
      syncVal(`let n = 0;
        async function g() { n = 1; await 0; n += 10; }
        export function f() { g(); return n; }`),
    ).toBe(1);
  }
  {
    expect(
      syncVal(`const log = [];
        async function g() { log.push(1); await 0; log.push(2); }
        export function f() { g(); log.push(3); log.push(4); return log.join(","); }`),
    ).toBe("1,3,4");
  }
  {
    expect(
      syncVal(`let seen;
        async function g() { await 0; seen = "after"; }
        export function f() { g(); return typeof seen; }`),
    ).toBe("undefined");
  }
  {
    expect(
      syncVal(`const log = [];
        const g = async () => { log.push("a"); await 0; log.push("b"); };
        export function f() { g(); log.push("c"); return log.join(","); }`),
    ).toBe("a,c");
  }
  {
    expect(
      syncVal(`let resolve;
        const p = new Promise((r) => { resolve = r; });
        const log = [];
        async function g() { log.push("a"); await p; log.push("b"); }
        export function f() { g(); resolve(); return log.join(","); }`),
    ).toBe("a");
  }
});




});

describe("await 在**表达式位置**同样挂起", () => {
  it("const x = await f()：同步段拿不到被等待值；return await g()：调用点先返回；h(await x)：实参位置同样挂起；x + await y：二元表达式位置同样挂起；const {a} = await f()：解构位置同样挂起；await 前的表达式照常求值（原生 3）", () => {
  {
    expect(
      syncVal(`async function g() { return 7; }
        let out = "";
        async function h() { const x = await g(); out = String(x); }
        export function f() { h(); return out; }`),
    ).toBe("");
  }
  {
    expect(
      syncVal(`async function g() { return 7; }
        async function h() { return await g(); }
        export function f() { const p = h(); return "made"; }`),
    ).toBe("made");
  }
  {
    expect(
      syncVal(`async function g() { return 7; }
        let out = "";
        function k(v) { return v; }
        async function h() { out = String(k(await g())); }
        export function f() { h(); return out; }`),
    ).toBe("");
  }
  {
    expect(
      syncVal(`async function g() { return 7; }
        let out = "";
        async function h() { const a = 1; out = String(a + (await g())); }
        export function f() { h(); return out; }`),
    ).toBe("");
  }
  {
    expect(
      syncVal(`async function g() { return { a: 1 }; }
        let out = "";
        async function h() { const { a } = await g(); out = String(a); }
        export function f() { h(); return out; }`),
    ).toBe("");
  }
  {
    expect(
      syncVal(`let out = "";
        async function g() { out = String(1 + 2); await 0; out = out + "!"; }
        export function f() { g(); return out; }`),
    ).toBe("3");
  }
});





});

describe("值域由**续体终值**给出（promise<inner> 不退化）", () => {
  it("await 后的返回值进 promise 的 inner；await 链的值域逐跳传递；负控制：已 settle 的 promise 的 await 取值仍精确（await Promise.resolve(1) → 1）；负控制：async 函数仍返回 promise 形态（值域不被截断成 unknown）", () => {
  {
    const src = `
async function g() { return 7; }
export async function f() {
  const x = await g();
  return x + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 8 });
  }
  {
    const src = `
export async function f() {
  return await Promise.resolve(21).then((x) => x * 2);
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 42 });
  }
  {
    const src = `
export async function f() {
  const v = await Promise.resolve(1);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 2 });
  }
  {
    const src = `
export async function f() {
  return 42;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 42 });
  }
});



});
});

// ---------------------------------------------------------------------------
// 生成器体构造期副作用——步骤 1 join 隔离（wrong-exact 消灭）
// ---------------------------------------------------------------------------
describe("生成器体构造期副作用——步骤 1 join 隔离（wrong-exact 消灭）", () => {
/**
 * 回归钉（**步骤 1 已落地**：转译侧「自由写快照 + $join 折回」，
 * 见 docs/design/generator-laziness.md §5.1 / 架构债台账 A1）。
 *
 * 原生：生成器函数被调用时**不执行体**——体只在首个 `next()` 时跑到
 * 第一个 `yield`。⇒ `const it = g();` 之后外层绑定仍是旧值；`it.next()`
 * 之后只跑到第一个 yield（第一个 yield 之后的写仍未发生）。
 *
 * 引擎的 `$gen` 保持 **eager 收集**（构造期跑完整个体，收集 yield 序列
 * ——元素域 / conf 的承重结构，步骤 2+ 才动）；但体的**外层自由写**不再
 * 确定地写穿：`$gen` 体外套「快照（`$copy`）+ `finally` 里 `$join(事前,
 * 事后)` 折回」（`exec/transpile/emit.ts` 的 `genOuterFreeWriteNames` /
 * `genFreeWriteWrap`，四个 `$gen` 发射点：声明 / 函数表达式 / 对象方法 /
 * 类方法）。
 *
 * ⇒ 四行症状从「**确定的错值**」（在任何原生观测点都不成立）变成
 * 「**sound 的过近似**」（native 构造点值 ∈ join）：
 *
 * | body 观测 | native | 改前引擎 | 步骤 1 引擎 |
 * |---|---|---|---|
 * | 构造点 n | `0` | `1` ✗ wrong-exact | `0 \| 1` ✓ | `0` ✓ |
 * | 构造点 log | `""` | `"ab"` ✗ | `"" \| "ab"` ✓ | `""` ✓ |
 * | it.next() 后 n | `1` | `5` ✗ | `0 \| 5` ✓（残余：`1` 不在 join）| `1` ✓ |
 * | it.next() 后 log | `"a"` | `"ab"` ✗ | `"" \| "ab"` ✓（残余）| `"a"` ✓ |
 *
 * **步骤 4（2026-11-07，挂起点绑定回放）**：体仍一次跑完（步骤 3 不变量），
 * 但转译侧给 `$gen` 传入 `capture`/`restore` 钩子，core 在每个 `$yield`
 * 记下外层自由写绑定的 Abs 快照成时间轴；消费推进到第 k 个 yield 时把绑定
 * 回放到 `timeline[k-1]` ⇒ 首个 yield 挂起点的中间值（`1` / `"a"`）精确
 * 复现。sound 守卫：路径敏感 / 体内延迟异常 / `yield*` 委托整帧禁用，
 * 严格回退到步骤 1 的 join 过近似。
 *
 * 注意：这是**值面**挂起（外层绑定的时间轴），不是把体降成真 JS
 * generator——引擎的分支/循环臂是宿主箭头，真 `yield` 落进去是
 * SyntaxError，且抽象 fork 一次跑完双臂无法只停一臂（见
 * `generator-laziness.md` 步骤 4 记录）。非绑定类副作用（宿主调用、
 * may-throw 收集）的时序仍按首次消费点整体发生，属已知边界。
 *
 * 仓内可查证的回归钉（读者**不必出仓**即可复核本条口径）：
 * - 族 01 的 eager 收集口径（协议面 / yield 序列 / 元素域）：
 * `packages/core/src/algebra/__tests__/exec-generator.test.ts`
 * （及同目录 `exec-generator-protocol/-precision/-consumption.test.ts`）；
 * - 本文件的负控制用例（协议面与 yield 序列不变、解构 lowering 取到元素）。
 */





  it("c1 构造点：n = 0（步骤 3：体在消费点跑，构造点 native 0 精确）；c2 构造点：log = \"\" | \"ab\"（native \"\" ∈ join；改前 wrong-exact \"ab\"）；c3 it.next() 后：n = 1（步骤 4 挂起点回放；native 1，步骤 3 为 0 | 5）；c4 it.next() 后：log = \"a\"（步骤 4 挂起点回放；native \"a\"，步骤 3 为 \"\" | \"ab\"）；步骤 4 · 连续两次 next(", () => {
  {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual('0  #exact');
  }
  {
    const r = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      return log;
    }`);
    expect(formatAbs(r.result)).toEqual('""  #exact');
  }
  {
    const r = call(`export function f() {
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      let n = 0;
      const it = g();
      it.next();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual('1  #exact');
  }
  {
    const r = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      it.next();
      return log;
    }`);
    expect(formatAbs(r.result)).toEqual('"a"  #exact');
  }
  {
    const n = call(`export function f() {
      let n = 0;
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      const it = g();
      it.next(); it.next();
      return n;
    }`);
    expect(formatAbs(n.result)).toEqual('5  #exact');
    const log = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      it.next(); it.next();
      return log;
    }`);
    expect(formatAbs(log.result)).toEqual('"ab"  #exact');
  }
  {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      const it = g();
      const a = it.next().value;
      const x = n;
      const b = it.next().value;
      const y = n;
      return "" + a + ":" + x + ":" + b + ":" + y;
    }`);
    expect(formatAbs(r.result)).toEqual('"1:1:2:5"  #exact');
  }
  {
    const expr = call(`export function f() {
      let n = 0;
      const g = function* () { n++; yield 1; };
      const it = g();
      return n;
    }`);
    expect(formatAbs(expr.result)).toEqual('0  #exact');

    const obj = call(`export function f() {
      let n = 0;
      const o = { *g() { n++; yield 1; } };
      const it = o.g();
      return n;
    }`);
    expect(formatAbs(obj.result)).toEqual('0  #exact');

    const cls = call(`export function f() {
      let n = 0;
      class C { *g() { n++; yield 1; } }
      const it = new C().g();
      return n;
    }`);
    expect(formatAbs(cls.result)).toEqual('0  #exact');

    const asyncGen = call(`export function f() {
      let n = 0;
      async function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(asyncGen.result)).toEqual('0  #exact');
  }
  {
    const r = call(`export function f() {
      let n = 0;
      function* gen(x) { n = x; yield 1; yield n; }
      return gen(5);
    }`);
    // 元素槽 = 构造期 yield 收集（1 与 5 均 #exact）；外层 n 的 join 折回
    // 发生在收集**之后**（finally）⇒ 不污染元素面。
    // BUG-094：生成器返回域按协议渲染（不再摊平成数字下标对象）
    expect(formatAbs(r.result)).toEqual('Generator<1 | 5, undefined, unknown>  #exact');
  }
  {
    const r = call(`export function f() {
      const arr = [];
      function* g() { arr.push(1); yield 1; }
      const it = g();
      return arr.length;
    }`);
    // R1-c 口径：容器是深拷贝快照 + join ⇒ 长度面从 exact 1 退成 sound 的
    // 步骤 3：构造期不跑体 ⇒ mutator 未落地 ⇒ 构造点 native 0 精确（不再是长度域过近似）。
    expect(formatAbs(r.result)).toBe("0  #exact");
  }
  {
    const r = call(`export function f() {
      const a = { v: 0 };
      const b = a;
      function* g() { a.v = 1; yield 1; }
      const it = g();
      return b.v;
    }`);
    expect(formatAbs(r.result)).toEqual("0  #exact");
  }
  {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const gi = g();
        return gi.next().value + ":" + gi.next().value;
      }`),
    ).toEqual({ ok: true, value: "1:2" });
  }
  {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const gi = g();
        const [a] = gi;
        return a;
      }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(`export function f() {
        function* cnt(n) { while (n > 0) { yield n; n--; } }
        return [...cnt(3)].join(",");
      }`),
    ).toEqual({ ok: true, value: "3,2,1" });
  }
  {
    expect(
      val(`export function f() {
        function* g() { var acc = 0; acc += 5; yield acc; acc = 1; yield acc; }
        return [...g()].join(",");
      }`),
    ).toEqual({ ok: true, value: "5,1" });
  }
});














});

// ---------------------------------------------------------------------------
// await 双臂 promise —— 拒绝臂不再被丢弃
// ---------------------------------------------------------------------------
describe("await 双臂 promise —— 拒绝臂不再被丢弃", () => {
/**
 * 回归钉：`$await` **不得丢掉双臂 promise 的 rejected 通道**。
 *
 * 原生：promise 的 executor 里若两条臂都可能发生（条件抽象），
 * `await p` 的结果是「fulfilled 值 ∪ 拒绝」——`try` 臂与 `catch` 臂
 * **都可达**。引擎此前只取 fulfilled 臂（`sh.inner`），拒绝臂被静默
 * 丢弃 ⇒ `catch` 臂成死代码（引擎给出**确定错值** `promise<"v:1">`）。
 *
 * 修法（`exec/runtime/async.ts` 的 `$await`）：双臂 promise（`rejected`
 * 通道存在且 `inner` 非 never）→ fulfilled 值照常交付，拒绝臂**记入
 * throw 通道**（`pushThrowExit`）——体内 `try/catch` 吸收它 ⇒ catch 臂
 * 可达；未被体内 catch 吸收的拒绝由 `$async` 摘出并入 promise 的
 * `rejected` 通道（原生：拒绝落 promise，不外溢成调用方 may-throw）。
 *
 * 负控制：确定拒绝的 promise（`Promise.reject`）行为不变（仍抛 reason，
 * catch 臂取值 `"c:k"`）；确定 fulfilled 的 promise 不受影响。
 */







  it("双臂 promise：try 臂与 catch 臂都可达（并集）；负控制：确定拒绝的 promise —— catch 臂取值不变（\"c:k\"）；负控制：确定 fulfilled 的 promise —— 只有 fulfilled 臂", () => {
  {
    const src = `
export async function f(c) {
  const p = new Promise((res, rej) => { if (c) res(1); else rej(new Error("k")); });
  try { const v = await p; return "v:" + v; } catch (e) { return "c:" + e.message; }
}
`;
    const r = call(src, "f", [anyAbs]);
    const awaited = formatAbs_____format_format_ts($await(r.result) as never);
    // 改前：只有 "v:1"（catch 臂死代码）；改后：两臂并集
    expect(awaited).toContain('"v:1"');
    expect(awaited).toContain('"c:k"');
  }
  {
    const src = `
export async function f() {
  const p = Promise.reject(new Error("k"));
  try { const v = await p; return "v:" + v; } catch (e) { return "c:" + e.message; }
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "c:k" });
  }
  {
    const src = `
export async function f() {
  const p = Promise.resolve(1);
  try { const v = await p; return "v:" + v; } catch (e) { return "c:" + e.message; }
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "v:1" });
  }
});



});

// ---------------------------------------------------------------------------
// await thenable 走采纳
// ---------------------------------------------------------------------------
describe("await thenable 走采纳", () => {
/**
 * 回归钉：`await` 一个 **thenable** 必须做**采纳**。
 *
 * 原生：`await t`（t 是带 `then` 方法的对象）走 PromiseResolve 式的采纳
 * ——取 `t.then(res, rej)` 的 settle 值（不是 t 本身）。引擎此前把
 * thenable 对象**本身**当成待决值交付（`await t` → t）⇒ 声明出与原生
 * **互斥**的具体类型（原生 `number` vs 引擎 `object`）。
 *
 * 修法（`exec/runtime/async.ts` 的 `$await` → `adoptThenable`）：闭对象
 * + 自有 `then` 槽（**确定** thenable；判定口径复用
 * `builtins/promise.ts` 的 `thenableRiskOf`）→ 调 `then(res, rej)` 取
 * settle 值：res → 交付该值；rej → 抛 reason；两者都没 settle → 悬挂
 * （unknown + unsettled）。any/unknown/fn/开对象的采纳面不可判 → 保持
 * 原值（不猜）。
 */






  it("thenable 的 res 值被交付（原生 number，引擎改前 object）；thenable 的 res 值可以是字符串；负控制：非 thenable 的普通值不被采纳（await 5 → 5）；负控制：promise 仍走 promise 通道（await Promise.resolve(1) → 1）", () => {
  {
    const src = `
export async function f() {
  const t = { then(res) { res(7); } };
  const v = await t;
  return typeof v + ":" + v;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "number:7" });
  }
  {
    const src = `
export async function f() {
  const t = { then(res, rej) { res("s"); } };
  const v = await t;
  return v;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "s" });
  }
  {
    const src = `
export async function f() {
  const v = await 5;
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  }
  {
    const src = `
export async function f() {
  const v = await Promise.resolve(1);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  }
});




});

// ---------------------------------------------------------------------------
// yield* 委托的 .return(v) 转发
// ---------------------------------------------------------------------------
describe("yield* 委托的 .return(v) 转发", () => {
/**
 * 回归钉：`yield*` 委托的生成器 `.return(v)` **必须转发**给
 * 委托迭代器。
 *
 * 原生：`gi.return(5)`（gi 挂起在 `yield* it` 内）→ 先调 `it` 的
 * 迭代器 `return(5)`（委托的清理副作用：关文件 / 释放锁 / 提交事务）
 * → 委托的 return 结果决定外层结局。引擎此前**不转发** ⇒ 委托的清理
 * 副作用整体丢失（`log` 恒空）。
 *
 * 修法（`exec/runtime/async.ts`）：`$gen` 压一份本帧「yield* 委托表」
 * （起始 yield 下标 + 并出元素数 + 委托对象），`$yieldStar` 记入；
 * `makeGenObject` 的 `ret` 路径按**挂起点下标**定位委托对象 → 转发
 * `return(v)`（生成器对象本身 / 用户 iterable 的迭代器对象——侧表
 * `userIterOf`）→ 委托的 `{value, done}` 决定外层结局（done:true →
 * 外层完成并取委托值；done:false → 委托继续，外层仍挂起）。下标漂移
 * （fork 合并）→ 校验失败 → 不转发（保守不猜）。
 */



/** 委托对象：用户 iterable，迭代器的 return(v) 记副作用 */
const DELEGATE = `
  const log = [];
  const it = {
    [Symbol.iterator]() {
      return {
        next() { return { value: 1, done: false }; },
        return(v) { log.push("ret:" + String(v)); return { value: v, done: true }; },
      };
    },
  };
`;


  it(".return(v) 转发给委托迭代器（委托的清理副作用不再丢失）；负控制：非委托挂起点的 .return(v) 不转发（无委托 → 无副作用）；负控制：普通生成器的 .return(v) 语义不变（{value: v, done: true}）", () => {
  {
    expect(
      val(`export function f() { ${DELEGATE}
        function* g() { yield* it; }
        const gi = g();
        gi.next();
        gi.return(5);
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "ret:5" });
  }
  {
    expect(
      val(`export function f() { ${DELEGATE}
        function* g() { yield 1; }
        const gi = g();
        gi.next();
        gi.return(5);
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(
      val(`export function f() {
        function* g() { yield 1; }
        const gi = g();
        gi.next();
        const r = gi.return(7);
        return r.value + ":" + r.done;
      }`),
    ).toEqual({ ok: true, value: "7:true" });
  }
});



});

// ---------------------------------------------------------------------------
// [merged] generator-own-properties
// ---------------------------------------------------------------------------
describe("generator-own-properties", () => {
// MERGED (topic-related bug pins): generator-own-properties + guard-internal-slots
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>







{
/**
 * 回归钉：生成器对象是**内部槽对象**——原生**没有任何自有可枚举
 * 属性**（`Object.keys` / `Object.getOwnPropertyNames` / `for-in` 恒空；
 * `hasOwnProperty("next")` 恒 false）。引擎此前把协议方法与 yield 元素
 * 塞进**自有可枚举槽** ⇒ 枚举面印出
 * `"0,next,return,throw,constructor,@@iterator"`（原生 `""`）。
 *
 * 修法（`exec/runtime/async.ts` 的 `makeGenObject`）：协议方法与 yield
 * 元素槽标 **internal**（枚举面 / 自有面不可见；`$get` / `$in` 照常直读
 * 直查——`"next" in g` 恒 true，与原生一致）。
 *
 * ── 已知残留（与族 01 结论冲突，本分片不改）────────────────────────────
 * 原生 `g[0]` 恒 `undefined`、`"0" in g` 恒 `false`；族 01 提交
 * `d6fa0679` 的「数字下标读（历史口径）继续可读 yield 值」
 * （`exec-generator-protocol.test.ts`）把 `g[0]` 固化为 yield 值（且
 * 数字下标槽承载元素域面 → 签名面 `"0": any`）。移除数字下标槽会同时
 * 改掉族 01 的该结论与元素域签名面 ⇒ 需另案（族 01 结论解除）处理，
 * 本分片按「不改族 01 已提交语义」约束保留 ⇒ 下列两条以 todo 记缺口。
 * ───────────────────────────────────────────────────────────────────────
 *
 * ── S18（投影面分片）：签名面不发布 internal 槽 ────────────────────────
 * 协议方法槽虽对**属性 introspection**不可见（枚举面 / 自有面已过滤
 * `Slot.internal`），但**投影面**（`algebra/format.ts`）此前不过滤 ⇒
 * 签名面把 `next` / `return` / `throw` / `constructor` / `@@iterator`
 * 五个内部槽当用户可见属性发布（报告的产品面证据）。S18 让
 * 投影面剔除 internal 槽，但**保留数字下标槽**（承载元素域——族 01
 * `eval-spread-iter-elems` 钉住的 `"0": string`）。
 */





const GEN = `
  function* g() { yield 1; yield 2; }
  const gi = g();
`;

describe("生成器对象的自有可枚举面为空", () => {
  it("Object.keys(g) → \"\"（改前：\"0,next,return,throw,constructor,@@iterator\"）；Object.getOwnPropertyNames(g) → \"\"；for-in 累积 → \"\"；hasOwnProperty(\"next\") → false（协议方法在原型上，不在自有面）；负控制：协议面仍可用（typeof gi.next → \"function\"，gi.next().value → 1）；负控制：\"next\" in ", () => {
  {
    expect(val(`export function f() { ${GEN} return Object.keys(gi).join(","); }`)).toEqual({
      ok: true,
      value: "",
    });
  }
  {
    expect(
      val(`export function f() { ${GEN} return Object.getOwnPropertyNames(gi).join(","); }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(
      val(`export function f() { ${GEN} let s = ""; for (const k in gi) s += k; return s; }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(
      val(`export function f() { ${GEN} return Object.prototype.hasOwnProperty.call(gi, "next"); }`),
    ).toEqual({ ok: true, value: false });
  }
  {
    expect(
      val(`export function f() { ${GEN} return typeof gi.next + ":" + gi.next().value; }`),
    ).toEqual({ ok: true, value: "function:1" });
  }
  {
    expect(val(`export function f() { ${GEN} return "next" in gi; }`)).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expect(val(`export function f() { ${GEN} const [a] = gi; return a; }`)).toEqual({
      ok: true,
      value: 1,
    });
  }
});







  it.todo("原生 g[0] 恒 undefined —— 需解除族 01「数字下标读（历史口径）」结论");
  it.todo("原生 \"0\" in g 恒 false —— 同上（数字下标槽仍在自有面）");
});

describe("（S18）：投影面不发布 internal 槽", () => {
  it("签名面不发布协议方法槽（无 next/return/throw/constructor/@@iterator）；签名面保留数字下标元素域（yield* s → \"0\": string）——族 01 口径不被破；@@iterator 槽按符号键投影建模（\"@@iterator\" 槽带 symbolKey 标记）；负控制：协议面在运行面仍可用（typeof gi.next → \"function\"）", () => {
  {
    const sig = formatAbs_____format_format_ts(
      call(`export function* g() { yield 1; yield "s"; }`, "g").result as never,
    );
    // 协议方法槽是 internal 槽（原生挂在原型上，不是自有属性）⇒ 不进投影面
    expect(sig).not.toContain("next");
    expect(sig).not.toContain("return");
    expect(sig).not.toContain("throw");
    expect(sig).not.toContain("constructor");
    expect(sig).not.toContain("@@iterator");
    // BUG-094：元素域按生成器类型参数发布
    expect(sig).toContain('Generator<1 | "s", undefined, unknown>');
  }
  {
    const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    const sig = formatAbs_____format_format_ts(
      call(`export function* g(s) { yield* s; }`, "g", [strAbs]).result as never,
    );
    expect(sig).toContain("Generator<string, undefined, unknown>");
  }
  {
    const shape = call(`export function* g() { yield 1; }`, "g").result.shape as unknown as {
      k: string;
      slots: Record<string, { internal?: boolean; symbolKey?: boolean }>;
    };
    expect(shape.k).toBe("obj");
    // 与用户写的 `[Symbol.X]` 静态字段同机制（族 01 ）
    expect(shape.slots["@@iterator"]?.symbolKey).toBe(true);
    expect(shape.slots["@@iterator"]?.internal).toBe(true);
  }
  {
    expect(
      val(
        `export function f() { const gi = (function* () { yield 1; })(); return typeof gi.next; }`,
      ),
    ).toEqual({ ok: true, value: "function" });
  }
});



});
}

describe("guard-internal-slots", () => {
/**
 * （S21 分片）：**guard / 约束面**不发布 internal 槽。
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * S18 分片修了**签名面**（`algebra/format.ts`）：投影面剔除 `Slot.internal`
 * 槽（**数字下标槽除外**——它承载元素域，族 01 的 `eval-spread-iter-elems`
 * 钉住 `"0": string`）。
 *
 * 但**guard 面**（`algebra/denote.ts` 的 `denoteGuard`）与**约束面**
 * （`algebra/projection.ts` 的 `absToConstraint`）没跟上 ⇒ 不过滤 internal 槽：
 *
 * - 生成器对象的协议槽（`next` / `return` / `throw` / `constructor` /
 * `@@iterator`）是 internal 槽（原生挂在**原型**上，不是自有属性）；
 * - `@@iterator` 更是 **symbol 键**槽（`Symbol.iterator`），guard 面却按
 * **字符串键** `"@@iterator"` 取值 ⇒ 原生恒 `undefined` ⇒
 * `typeof data["@@iterator"] === "function"` **恒假** ⇒ 恒假条款污染
 * guard 产物。
 *
 * 根因在 **core**（不在 service）：`service/src/emit/guard-generator.ts`
 * 直接 `import { denoteGuard } from "@nudojs/core/internal"` ⇒ 产物面
 * 恒假条款的根因是 core 的投影通道。与 dts/schema 面发布 internal 槽
 * 不同源（后者归族 15 的 ）。
 *
 * ── 修法 ────────────────────────────────────────────────────────────────
 * 与 `format.ts` **同口径**：剔除 internal 槽，**保留数字下标槽**（元素域，
 * 族 01 约定）。
 *
 * ── 负控制 ──────────────────────────────────────────────────────────────
 * 普通对象的**非 internal** 成员仍须出现在 guard / 约束产物里——guard 面
 * 不能被"改空"（那会把所有 obj 守卫退化成 `typeof data === "object"`）。
 */







/** 生成器导出（协议槽为 internal 槽 + 数字下标槽承载元素域） */
const GEN_SRC = `export function* g() { yield 1; yield "s"; }`;
/** 普通对象（成员为公有槽，非 internal） */
const PLAIN_SRC = `export function f() { return { a: 1, b: "x" }; }`;

/** guard 产物面（`nudo export --format guard` 的同源渲染） */
function guardOf(src: string, fn = "f"): string {
  return denoteGuard(call(src, fn).result, "data");
}

/** 约束产物面（zod / standard 契约面的同源） */
function constraintOf(src: string, fn = "f") {
  return absToConstraint(call(src, fn).result);
}

/** 生成器对象的 internal 协议槽键（数字下标槽除外——它承载元素域） */
const PROTOCOL_SLOT_KEYS = ["next", "return", "throw", "constructor", "@@iterator"];

/** 从 guard 串里抽出被访问的成员键（`data.x` / `data["x"]` 两种写法） */
function accessedKeys(guard: string): string[] {
  const keys: string[] = [];
  for (const m of guard.matchAll(/\bdata\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) keys.push(m[1]!);
  for (const m of guard.matchAll(/\bdata\[("(?:[^"\\]|\\.)*")\]/g)) {
    keys.push(JSON.parse(m[1]!) as string);
  }
  return keys;
}

/**
 * 按顶层 `&&` 拆 guard 条款（core 生成的守卫串顶层连接符固定为 " && "）。
 *
 * 口径更新（族 09 / + 410）：必填槽的**存在性子句**自带一层括号
 * （`(Object.hasOwn(v, "a") || ("a" in v && !Object.hasOwn(Object.prototype, "a")))`）
 * ⇒ 顶层拆分必须**跳过括号内**的 " && "（本函数的注释一直声明「按**顶层**
 * 拆」，此前实现没做到——只有顶层连接符恰好不在括号里的旧产物才看不出差别）。
 * 字符串字面量里的括号也要跳过（键名里可能有括号）。
 */
function splitClauses(guard: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < guard.length) {
    const ch = guard[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      // 跳过字符串字面量（键名里可能有括号）
      i += 1;
      while (i < guard.length) {
        if (guard[i] === "\\") {
          i += 2;
          continue;
        }
        if (guard[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
    } else if (depth === 0 && guard.startsWith(" && ", i)) {
      out.push(guard.slice(start, i).trim());
      i += 4;
      start = i;
      continue;
    }
    i += 1;
  }
  const tail = guard.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out.filter((p) => p.length > 0);
}

/** 在原生对象上求值单条 guard 条款（原生 oracle） */
function evalClause(clause: string, data: unknown): unknown {
  // eslint-disable-next-line no-new-func
  return new Function("data", `return (${clause});`)(data);
}

/** 原生生成器对象（协议方法在原型上；无任何自有可枚举属性） */
function nativeGen(): unknown {
  return (function* () {
    yield 1;
    yield "s";
  })();
}

describe("（S21）：guard 面不发布 internal 槽", () => {
  it("恒假条款 `typeof data[\"@@iterator\"] === \"function\"` 消失；协议槽条款全消失（next / return / throw / constructor）；guard 产物逐条等于期望串（改前多出 6 条协议槽条款）；guard 访问的成员键里没有 internal 协议槽键；数字下标槽（元素域）仍被发布——族 01 约定不被破；负控制：普通对象的非 internal 成员仍出现在 guard 里（guard 面没被改空）；负控制：非 i", () => {
  {
    const guard = guardOf(GEN_SRC, "g");
    expect(guard).not.toContain('@@iterator');
    expect(guard).not.toContain('typeof data["@@iterator"] === "function"');
  }
  {
    const guard = guardOf(GEN_SRC, "g");
    for (const k of PROTOCOL_SLOT_KEYS) {
      expect(guard).not.toContain(`data.${k}`);
      expect(guard).not.toContain(`data["${k}"]`);
    }
  }
  {
    // 改前：typeof data === "object" && data !== null && data["0"] === 1 &&
    // data["1"] === "s" && typeof data.next === "function" &&
    // typeof data.return === "function" && typeof data.throw === "function" &&
    // typeof data.constructor === "object" && data.constructor !== null &&
    // data.constructor.name === "" && typeof data["@@iterator"] === "function"
    // 改后：只剩元素域（数字下标）两条
    // 口径更新（族 09 / + 410）：guard 面现在还带 ① 数组排除
    // （`!Array.isArray(data)`）② 必填槽的**独立存在性子句** ——
    // internal 槽的剔除口径不变。
    // 2026-11-06：`facets.brand` 的生成器身份在 `denoteGuardB` 递归投影
    // ⇒ 串首多一条身份子句（不包 body 的括号，故本文件按顶层 ` && `
    // 拆条款的原生 oracle 仍逐条可见）。
    expect(guardOf(GEN_SRC, "g")).toBe(
      'Object.prototype.toString.call(data) === "[object Generator]" && typeof data === "object" && data !== null && !Array.isArray(data) && (Object.hasOwn(data, "0") || ("0" in data && !Object.hasOwn(Object.prototype, "0"))) && data["0"] === 1 && (Object.hasOwn(data, "1") || ("1" in data && !Object.hasOwn(Object.prototype, "1"))) && data["1"] === "s"',
    );
  }
  {
    const keys = accessedKeys(guardOf(GEN_SRC, "g"));
    for (const k of PROTOCOL_SLOT_KEYS) expect(keys).not.toContain(k);
  }
  {
    const guard = guardOf(GEN_SRC, "g");
    expect(guard).toContain('data["0"] === 1');
    expect(guard).toContain('data["1"] === "s"');
    expect(accessedKeys(guard)).toEqual(expect.arrayContaining(["0", "1"]));
  }
  {
    const guard = guardOf(PLAIN_SRC);
    expect(guard).toContain("data.a === 1");
    expect(guard).toContain('data.b === "x"');
    expect(guard).toBe(
      'typeof data === "object" && data !== null && !Array.isArray(data) && (Object.hasOwn(data, "a") || ("a" in data && !Object.hasOwn(Object.prototype, "a"))) && data.a === 1 && (Object.hasOwn(data, "b") || ("b" in data && !Object.hasOwn(Object.prototype, "b"))) && data.b === "x"',
    );
  }
  {
    const keys = accessedKeys(guardOf(PLAIN_SRC));
    expect(keys).toEqual(expect.arrayContaining(["a", "b"]));
  }
});






});

describe("（S21）：原生 oracle 对拍（guard 条款逐条对照）", () => {
  it("改前的恒假条款在原生生成器上恒 false（问题确实存在）；改后 guard 的逐条原生求值：仅元素域条款为 false（族 01 已知残留）；负控制：普通对象的 guard 每条在原生对象上都是 true", () => {
  {
    const g = nativeGen();
    expect(evalClause('typeof data["@@iterator"] === "function"', g)).toBe(false);
    expect(evalClause('data["@@iterator"]', g)).toBeUndefined();
  }
  {
    const clauses = splitClauses(guardOf(GEN_SRC, "g"));
    const g = nativeGen();
    const falseOnes = clauses.filter((c) => evalClause(c, g) === false);
    // 族 01 已知残留：数字下标槽承载元素域（族 01「数字下标读（历史口径）」结论）
    // ⇒ 原生生成器上恒 false。本分片按「不改族 01 已提交语义」约束保留。
    // 口径更新（族 09 / + 410）：必填槽的**存在性子句**也是 false
    // ——同一个族 01 残留（数字下标槽不是真实属性 ⇒ 既没有值也没有键）。
    // ⇒ false 条款从 2 条变 4 条，仍**全部**指向数字下标槽。
    expect(falseOnes).toEqual([
      '(Object.hasOwn(data, "0") || ("0" in data && !Object.hasOwn(Object.prototype, "0")))',
      'data["0"] === 1',
      '(Object.hasOwn(data, "1") || ("1" in data && !Object.hasOwn(Object.prototype, "1")))',
      'data["1"] === "s"',
    ]);
  }
  {
    const clauses = splitClauses(guardOf(PLAIN_SRC));
    const native = { a: 1, b: "x" };
    expect(clauses.length).toBeGreaterThan(2);
    for (const c of clauses) expect(evalClause(c, native)).toBe(true);
  }
});


});

describe("（S21）：约束面同口径（absToConstraint 不发布 internal 槽）", () => {
  it("协议槽不进约束产物；数字下标槽（元素域）仍被发布（族 01 约定）；负控制：普通对象的公有字段仍在约束产物里", () => {
  {
    const c = constraintOf(GEN_SRC, "g");
    expect(c).toBeDefined();
    const fields = c?.fields ?? {};
    for (const k of PROTOCOL_SLOT_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(fields, k)).toBe(false);
    }
  }
  {
    const c = constraintOf(GEN_SRC, "g");
    expect(Object.keys(c?.fields ?? {})).toEqual(["0", "1"]);
  }
  {
    const c = constraintOf(PLAIN_SRC);
    expect(Object.keys(c?.fields ?? {}).sort()).toEqual(["a", "b"]);
  }
});


});

describe("（S21）：私有字段槽（internal）同样不进 guard 面", () => {
  /** 私有字段 `#x` 是 internal 槽（原生私有字段对属性 introspection 不可见） */
  const PRIV_SRC = `export class C { #x = 1; getX() { return this.#x; } }
export function f() { return new C(); }`;

  it("私有字段槽不进 guard（改前恒假条款 `data[\"#C::x\"] === 1` 消失）；原生 oracle：私有字段不是自有属性（恒假条款的依据）", () => {
  {
    const guard = guardOf(PRIV_SRC);
    expect(guard).not.toContain("#C::x");
    // 口径更新（族 09 / + 409 + 410）：`new C()` 的 Abs 是 **brand**
    // ⇒ guard 面现在还带 ① brand 身份子句（`Reflect.get(globalThis, "C")`
    // 形态的 instanceof 判定；用户类名不是全局构造器 ⇒ 运行时放行）
    // ② 数组排除 ③ 内层对象面（无可见槽 ⇒ 无存在性子句）。
    expect(guard).toBe(
      '((typeof Reflect.get(globalThis, "C") !== "function" || data instanceof Reflect.get(globalThis, "C"))) && (typeof data === "object" && data !== null && !Array.isArray(data))',
    );
  }
  {
    const native = new (class {
      #x = 1;
    })();
    expect(evalClause('data["#C::x"] === 1', native)).toBe(false);
    expect(Object.keys(native)).toEqual([]);
  }
});

});

describe("（S21）：与 S18 签名面 / 访问器读域同口径", () => {
  it("签名面（S18）仍不发布 internal 槽——本分片不回退；访问器键的 guard 仍按 getter 读域判定（不被本分片改坏）；访问器键的约束投影仍取 getter 读域", () => {
  {
    const sig = formatAbs_____format_format_ts(call(GEN_SRC, "g").result as Abs);
    expect(sig).not.toContain("@@iterator");
    expect(sig).not.toContain("next");
    expect(sig).toContain('Generator<1 | "s", undefined, unknown>');
  }
  {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    // 口径更新（族 09 / + 410）：guard 面现在还带 ① 数组排除
    // ② 必填槽的**独立存在性子句** —— 读域判定（`data.ab === 1`）不变。
    expect(denoteGuard(call(src, "f").result, "data")).toBe(
      'typeof data === "object" && data !== null && !Array.isArray(data) && (Object.hasOwn(data, "ab") || ("ab" in data && !Object.hasOwn(Object.prototype, "ab"))) && data.ab === 1',
    );
  }
  {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    const c = absToConstraint(call(src, "f").result);
    const eq = c?.fields?.["ab"]?.constraint?.preds.find((p) => p.op === "eq");
    expect(eq?.op).toBe("eq");
    expect(eq?.op === "eq" && eq.b.op === "lit" ? eq.b.value : undefined).toBe(1);
  }
});


});
});
});

// ---------------------------------------------------------------------------
// Promise 组合子 settle 域
// ---------------------------------------------------------------------------
describe("Promise 组合子 settle 域", () => {
/**
 * Promise 组合子（all / race / any）的 settle 域。
 *
 * 原生（node v26）：
 * - `await Promise.all([Promise.reject(e)])` / `race` → 抛 e（catch 臂可达）
 * - `await Promise.any([Promise.reject(e)])` → 抛 AggregateError
 * - `await Promise.race([Promise.resolve(1)])` → 1（**元素 promise 的值**，
 * 不是 promise 本身——原生 race/any 先按 PromiseResolve unwrap）
 * - `Promise.race([Promise.resolve(1), 2])` → 2（非 promise 元素先 settle）
 *
 * 修前：all/race/any 丢弃元素的 rejected 通道（组合子恒「不抛」→ catch 臂成
 * 死代码、try 臂成确定错值）；race/any 还把元素 promise 本身当结算值。
 */






type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs___nudojs_core; rejected?: Abs___nudojs_core; unsettled?: boolean };
};

/** 结果取值：promise 取兑现域（inner），非 promise 取自身 */
function v(src: string): { ok: boolean; value?: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  return litValue___nudojs_core((sh?.k === "eff" && sh.eff === "promise" ? sh.inner : r.result) as Abs___nudojs_core);
}

/** 结果的展示串（签名面） */
function fmt(src: string): string {
  return formatAbs(call(src, "f").result as Abs___nudojs_core)?.replace(/\s+#[a-z0-9]+$/, "") ?? "";
}


  it("all：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）；race：元素 rejected → 组合子带 reason（await 抛 → catch 臂可达）；any：全拒 → AggregateError（原生 errors 数组 + 固定 message）；race：结算值按 PromiseResolve unwrap（元素 promise → 其值，非 promise 本身）；race：混合元素 → 兑现域非 object（", () => {
  {
    expect(
      v(`export async function f() {
        try { await Promise.all([Promise.reject(new Error("k"))]); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:k" });
  }
  {
    expect(
      v(`export async function f() {
        try { await Promise.race([Promise.reject(new Error("k"))]); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:k" });
  }
  {
    expect(
      v(`export async function f() {
        try { await Promise.any([Promise.reject(new Error("k"))]); return "no"; }
        catch (e) { return "c:" + e.name; }
      }`),
    ).toEqual({ ok: true, value: "c:AggregateError" });
  }
  {
    expect(
      v(`export async function f() {
        const x = await Promise.race([Promise.resolve(1)]);
        return typeof x;
      }`),
    ).toEqual({ ok: true, value: "number" });
  }
  {
    expect(
      v(`export async function f() {
        const x = await Promise.race([Promise.resolve(1), 2]);
        return typeof x === "object";
      }`),
    ).toEqual({ ok: true, value: false });
  }
  {
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1), 2]); }`)).toContain(
      "promise<[1, 2]>",
    );
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1)]); }`)).toContain(
      "promise<[1]>",
    );
    expect(fmt(`export function f() { return Promise.race([1, "a"]); }`)).toContain(
      'promise<1 | "a">',
    );
    expect(fmt(`export function f() { return Promise.any([1]); }`)).toContain("promise<1>");
  }
  {
    expect(
      v(`export async function f() {
        try { await Promise.reject(new Error("k")); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:k" });
  }
  {
    // promise.ts 的 aggregateErrorAbs 是 errorBrandAbs 的**本地**构造
    // （error-family.ts 反向引 promise.ts，直引成环）——共享口径
    // （name 走原型链槽 / stack/message/errors 不可枚举 / 同槽键集）
    // 靠本用例互钉：errorBrandAbs 槽位口径变化 ⇒ 这里先红。
    const reason = { shape: { k: "prim", type: "string" }, conf: "exact" } as Abs___nudojs_core;
    const local = aggregateErrorAbs([reason]);
    // args[0]（errors 位）用确定可迭代的 tuple——避开 enforceIterableStaticArg
    // 的 may-throw 记录路径；本用例只钉槽位口径，不钉 errors 值的精度。
    const canonical = errorBrandAbs("AggregateError", [
      { shape: { k: "tuple", elements: [] }, conf: "exact" } as Abs___nudojs_core,
    ]);
    // brand → obj 双层 Abs：槽表在 a.shape.shape.shape.slots
    const slotsOf = (a: Abs___nudojs_core): Record<string, { enumerable?: boolean; inherited?: boolean }> =>
      (a.shape as unknown as { shape: { shape: { slots: Record<string, unknown> } } })
        .shape.shape.slots as never;
    const localSlots = slotsOf(local);
    const canonicalSlots = slotsOf(canonical);
    // 同槽键集（canonical 可能多 cause——仅当 options 带 cause；这里无 options）
    expect(Object.keys(localSlots).sort()).toEqual(["errors", "message", "name", "stack"]);
    expect(Object.keys(canonicalSlots).sort()).toEqual(["errors", "message", "name", "stack"]);
    // name 都是原型链槽
    expect((localSlots.name as { inherited?: boolean }).inherited).toBe(true);
    expect((canonicalSlots.name as { inherited?: boolean }).inherited).toBe(true);
  }
});








});

// ---------------------------------------------------------------------------
// new Promise 执行器抛错
// ---------------------------------------------------------------------------
describe("new Promise 执行器抛错", () => {
/**
 * `new Promise` 的执行器抛错被吞掉。
 *
 * 原生（node v26）：`new Promise(() => { throw new Error("x"); })` 产出
 * **被拒绝**的 promise（reason = Error("x")）——`await` 抛 → catch 臂可达。
 *
 * 修前：执行器抛出只翻「executed」标志 → 短路 `promiseUnknown()`（inner=unknown、
 * **无 rejected 通道**、unsettled=true）→ `$await` 永不抛 → catch 臂成死代码，
 * try 臂的字面量成了确定返回值（自信错值）。
 */




type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs___nudojs_core; rejected?: Abs___nudojs_core; unsettled?: boolean };
};

/** 结果取值：promise 取兑现域（inner），非 promise 取自身 */
function v(src: string): { ok: boolean; value?: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  return litValue___nudojs_core((sh?.k === "eff" && sh.eff === "promise" ? sh.inner : r.result) as Abs___nudojs_core);
}

/** eff(promise) 的形状面 */
function shape(src: string): EffShape["shape"] {
  const sh = call(src, "f").result.shape as EffShape["shape"];
  expect(sh?.k, "expected eff shape").toBe("eff");
  expect(sh?.eff, "expected promise eff").toBe("promise");
  return sh;
}


  it("执行器抛错 → promise 以抛出值拒绝（catch 臂可达）；执行器抛错 → fulfilled 域 never + rejected 通道带 reason；先 settle 获胜：执行器先 resolve 后抛错 → 仍兑现（原生 first-wins）；负控制：空执行器（永不 settle）仍是 promise<unknown>（不假装 settle）；负控制：只 reject 的执行器仍是确定拒绝（Bug 36 通道）", () => {
  {
    expect(
      v(`export async function f() {
        try { await new Promise(() => { throw new Error("x"); }); return "no"; }
        catch (e) { return "c:" + e.message; }
      }`),
    ).toEqual({ ok: true, value: "c:x" });
  }
  {
    const sh = shape(`export function f() { return new Promise(() => { throw new Error("boom"); }); }`);
    expect(sh?.inner?.shape?.k).toBe("never");
    expect(sh?.rejected?.shape?.k).toBe("brand");
    expect(formatAbs(sh!.rejected as Abs___nudojs_core)).toContain("Error");
  }
  {
    expect(
      v(`export function f() { return new Promise((r) => { r(1); throw new Error("x"); }); }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    const sh = shape(`export function f() { return new Promise(() => {}); }`);
    expect(sh?.inner?.shape?.k).toBe("unknown");
    expect(sh?.rejected).toBeUndefined();
    expect(sh?.unsettled).toBe(true);
  }
  {
    const sh = shape(`export function f() { return new Promise((r, j) => { j(new Error("x")); }); }`);
    expect(sh?.inner?.shape?.k).toBe("never");
    expect(sh?.rejected).toBeDefined();
  }
});





});

// ---------------------------------------------------------------------------
// [merged] promise-static-this-wiring
// ---------------------------------------------------------------------------
describe("promise-static-this-wiring", () => {
// MERGED (topic-related bug pins): promise-static-this-wiring + promise-static-this
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * 回归（**主 agent 接线面**）：Promise 静态方法的 `this` 绑定转发。
 *
 * 接线（主 agent 已落地，本文件只钉行为，不改源码）：
 * - `exec/runtime/containers/member.ts`：命名空间成员读出的静态方法值，
 * `apply: (args) => evalNamespaceCall(ns, key, args)`
 * → `apply: (args, thisVal) => evalNamespaceCall(ns, key, args, thisVal ?? undef())`
 * （this 缺席 = 「this 是 undefined」，与「无 this 信息」区分）；
 * - `builtins/error/namespace.ts`：`evalNamespaceCall` 收第 4 参 `thisVal`
 * 并转给 `evalPromiseStatic`；
 * - `builtins/promise.ts`：`checkPromiseStaticThis` —— this nullish ⇒ TypeError；
 * this 非构造器 ⇒ TypeError；this 是构造器（`shape.k === "fn" | "brand"`
 * 且 `ctor === true`）⇒ 合法。
 *
 * 原生依据（node v26.10.0 实测，ES262：Promise 的静态是以 `this` 为接收者
 * 的普通函数，`PromiseResolve` / `NewPromiseCapability` 要求 this 是构造器）：
 * - `Promise.resolve(1)` → 合法，返回 promise；
 * - `Promise.resolve.call(null, 1)` → TypeError: PromiseResolve called on non-object；
 * - `Promise.resolve.call({}, 1)` → TypeError: #<Object> is not a constructor；
 * - `Promise.resolve.call(Promise, 1)` → 合法，返回 promise；
 * - `const r = Promise.resolve; r(1)` → TypeError（this ≡ undefined ⇒ 非构造器）；
 * - `Promise.resolve.call(undefined,1)`→ TypeError;
 * - 负控制 `Math.max.call(null, 1, 2)` → 合法，返回 2（命名空间静态的 this
 * 判定**只对 Promise 生效**）。
 *
 * 同族已由 `promise-static-this` 钉机制面
 * （`evalNamespaceCall` 直调），本文件钉**端到端接线面**（成员读 → this
 * 转发 → 静态派发）。
 */




type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs___nudojs_core; rejected?: Abs___nudojs_core; unsettled?: boolean };
};

/** 结果的 promise 面（eff/promise）+ 兑现域字面量 */
function promiseFace(src: string): { inner: { ok: boolean; value?: unknown }; throws: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  expect(sh?.k, "expected eff shape (promise)").toBe("eff");
  expect(sh?.eff, "expected promise eff").toBe("promise");
  return { inner: litValue(sh!.inner as Abs___nudojs_core), throws: r.throws };
}

/** 端到端跑一段表达式，返回调用记录 */
function run(body: string) {
  return call(`export function f() { ${body} }`, "f");
}

describe("Promise 静态的 this 绑定转发（接线面）", () => {
  it("Promise.resolve(1)：直接命名空间调用不抛，值域是 promise<1>；Promise.resolve.call(null, 1)：this 为 nullish ⇒ TypeError；Promise.resolve.call({}, 1)：this 非构造器 ⇒ TypeError；Promise.resolve.call(Promise, 1)：this 是构造器 ⇒ 合法，值域是 promise<1>；const r = Promise.resolve", () => {
  {
    const { inner, throws } = promiseFace(
      `export function f() { return Promise.resolve(1); }`,
    );
    expect(isNever(throws), "原生合法路径不得抛").toBe(true);
    expect(inner).toEqual({ ok: true, value: 1 });
  }
  {
    const r = run(`return Promise.resolve.call(null, 1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = run(`return Promise.resolve.call({}, 1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const { inner, throws } = promiseFace(
      `export function f() { return Promise.resolve.call(Promise, 1); }`,
    );
    expect(isNever(throws), "构造器接收者是原生合法路径").toBe(true);
    expect(inner).toEqual({ ok: true, value: 1 });
  }
  {
    // 接线面关键：成员读出的静态方法被**单独读出再调用**时，this 转发必须
    // 带上「this 是 undefined」（原生同款 ⇒ TypeError）。
    const r = run(`const r = Promise.resolve; return r(1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = run(`return Promise.resolve.call(undefined, 1);`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = run(`return Math.max.call(null, 1, 2);`);
    expect(isNever(r.throws)).toBe(true);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  }
  {
    // 原生（node v26 实测）：7 个静态在 this = null / {} 时**全部**抛
    // TypeError，this = Promise 时**全部**合法。
    const statics = [
      "resolve",
      "reject",
      "all",
      "race",
      "allSettled",
      "any",
      "withResolvers",
    ] as const;
    for (const m of statics) {
      for (const recv of ["null", "{}", "Promise"] as const) {
        const r = run(`return Promise.${m}.call(${recv});`);
        if (recv === "Promise") {
          expect(throwsError(r.throws, "TypeError"), `${m}.call(Promise) 不得抛`).toBe(
            false,
          );
        } else {
          expect(
            throwsError(r.throws, "TypeError"),
            `${m}.call(${recv}) 须抛 TypeError`,
          ).toBe(true);
        }
      }
    }
  }
});







});
}

describe("promise-static-this", () => {
/**
 * Promise 静态方法忽略 `this` 绑定。
 *
 * 原生（node v26）：Promise 的静态（resolve / reject / all / race / allSettled /
 * any / withResolvers）在规范里都是**以 `this` 为接收者**的普通函数——
 * `PromiseResolve` / `NewPromiseCapability` 要求 `this` 是构造器，否则 TypeError：
 * Promise.resolve.call(null, 1) → TypeError: PromiseResolve called on non-object
 * Promise.all.call({}, []) → TypeError: #<Object> is not a constructor
 *
 * 修法分两跳：
 * 1) 本分片（promise.ts / error/namespace.ts）：命名空间静态派发带 this 绑定，
 * 非构造器接收者按原生抛 TypeError（`checkPromiseStaticThis`）。
 * 2) 越界一行（**exec/runtime/containers/member.ts:847**，分片 A 的地盘）：
 * 成员读出的静态方法值须把 this 转发进命名空间派发——
 * apply: (args) => evalNamespaceCall(ns, key, args) ?? unknown
 * → apply: (args, thisVal) => evalNamespaceCall(ns, key, args, thisVal) ?? unknown
 * 合并前端到端仍是「静态派发无接收者」（返回 promise<1>、L2 假绿）。
 */







/** 抛 TypeError 的探针（NudoThrow 载荷是 brand TypeError） */
function throwsTypeError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    const err = e as { absValue?: Abs___nudojs_core; name?: string };
    if (err?.absValue) return (err.absValue.shape as { name?: string }).name === "TypeError";
    return err?.name === "TypeError" || err?.name === "NudoThrow";
  }
}

describe("Promise 静态的 this 绑定", () => {
  it("机制面：命名空间派发带 this → 非构造器接收者抛 TypeError；机制面：直接命名空间调用（this 缺席）合法 → 不抛；机制面：构造器接收者合法（Promise 的 Abs 面 = fn + ctor:true）；机制面：不可判接收者（any）→ 记 may-throw，不硬抛（不制造假抛）；机制面：this 为 undefined（undefAbs 形态）→ TypeError（原生 PromiseResolve 非对象）；端到端：Promise.resolv", () => {
  {
    expect(
      throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)], absLit(null))),
    ).toBe(true);
    expect(
      throwsTypeError(() =>
        evalNamespaceCall("Promise", "all", [], abs___nudojs_core({ k: "obj", slots: {} }, undefined, undefined, "exact")),
      ),
    ).toBe(true);
  }
  {
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)]))).toBe(false);
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "reject", [numLit(1)]))).toBe(false);
  }
  {
    const ctor = abs___nudojs_core(
      { k: "fn", params: ["arg0"], name: "Promise", ctor: true },
      undefined,
      undefined,
      "exact",
    );
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)], ctor))).toBe(
      false,
    );
  }
  {
    const anyv = abs___nudojs_core({ k: "any" }, undefined, undefined, "path");
    expect(throwsTypeError(() => evalNamespaceCall("Promise", "resolve", [numLit(1)], anyv))).toBe(
      false,
    );
  }
  {
    // 该形态要求 member.ts 的转发写成 `thisVal ?? undefAbs()`（this 为
    // undefined 时与「无 this 信息」区分）——见报告的越界诉求。
    expect(
      throwsTypeError(() =>
        evalNamespaceCall("Promise", "resolve", [numLit(1)], absLit(undefined)),
      ),
    ).toBe(true);
  }
  {
    const r = call(`export function f() { return Promise.resolve.call(null, 1); }`);
    const thrown = r.throws?.shape?.k === "brand" && (r.throws.shape as { name?: string }).name === "TypeError";
    if (thrown) {
      // 越界一行合并后：定抛 TypeError（原生）
      expect(r.throws).toBeDefined();
    } else {
      // 合并前：静态派发无接收者 → 返回 promise<1> 且不记抛（L2 假绿）
      expect(r.throws?.shape?.k).toBe("never");
    }
  }
  {
    const direct = call(`export function f() { return Promise.resolve(1); }`);
    expect(direct.throws?.shape?.k).toBe("never");
    const viaCtor = call(`export function f() { return Promise.resolve.call(Promise, 1); }`);
    expect(viaCtor.throws?.shape?.k).toBe("never");
  }
  {
    const r = call(`export function f() { return Math.max.call(null, 1, 2); }`);
    expect(r.throws?.shape?.k).toBe("never");
  }
});







});
});
});

// ---------------------------------------------------------------------------
// allSettled 元素投影
// ---------------------------------------------------------------------------
describe("allSettled 元素投影", () => {
/**
 * `Promise.allSettled` 的元素投影。
 *
 * 原生（node v26）：`Promise.allSettled([p])` 的元素是**判别联合**——
 * `{status:"fulfilled", value:<值>}` 或 `{status:"rejected", reason:<reason>}`，
 * status 恒定（不取决于别的臂）。读 `r[0].reason.message` 不抛。
 *
 * 修前：元素 promise **原样**塞进 value 槽（没解包）、reason 槽恒 unknown、
 * status 是两态并集（不区分）→ 读 reason 命中 fulfilled 臂的缺槽 → undefined
 * → `.message` 定抛 TypeError（假抛，L2 假红）+ 错类型声明。
 */




type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs___nudojs_core; rejected?: Abs___nudojs_core; unsettled?: boolean };
};

/** 结果取值：promise 取兑现域（inner），非 promise 取自身 */
function v(src: string): { ok: boolean; value?: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  return litValue___nudojs_core((sh?.k === "eff" && sh.eff === "promise" ? sh.inner : r.result) as Abs___nudojs_core);
}

/** 结果的展示串（签名面） */
function fmt(src: string): string {
  return formatAbs(call(src, "f").result as Abs___nudojs_core)?.replace(/\s+#[a-z0-9]+$/, "") ?? "";
}


  it("rejected 元素 → reason 槽装真 reason（读 .reason.message 不抛）；fulfilled 元素 → value 槽装解包后的值（非 promise 本身）；fulfilled 元素 → status 恒 \"fulfilled\"（判别联合，不与 rejected 并集）；混合元素 → 逐元素投影（长度与原生一致）；负控制：非 promise 元素的既有口径不变（status 两态并集 + value/reason 双槽）", () => {
  {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.reject(new Error("k"))]).then((r) => r[0].reason.message);
      }`),
    ).toEqual({ ok: true, value: "k" });
  }
  {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.resolve(1)]).then((r) => r[0].value);
      }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.resolve(1)]).then((r) => r[0].status);
      }`),
    ).toEqual({ ok: true, value: "fulfilled" });
  }
  {
    expect(
      v(`export async function f() {
        return Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("k"))]).then((r) => r.length);
      }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    const s = fmt(`export function f() { return Promise.allSettled([1]); }`);
    expect(s).toContain('"fulfilled" | "rejected"');
    expect(s).toContain("value");
    expect(s).toContain("reason");
  }
});





});

// ---------------------------------------------------------------------------
// 非可调用 handler ≡ identity
// ---------------------------------------------------------------------------
describe("非可调用 handler ≡ identity", () => {
/**
 * `then` / `catch` 的非可调用 handler 被当成可调用。
 *
 * 原生（node v26，ES262 PerformPromiseThen）：`IsCallable(onFulfilled)` 为假
 * ⇒ onFulfilled ≡ undefined（identity）⇒ 原值透传。
 * `Promise.resolve(1).then({})` / `.then([1,2])` → 兑现 1（不抛）。
 *
 * 修前：`isIdentity` 只把 prim（与 nullish）判为「确定不可调用」——闭合的
 * obj / arr / tuple（形状已知、无可调用成员）落进「可能可调用」→ 微任务臂
 * 真去调 → TypeError → 结果 promise 折成 `promise<never>`（自信错值）。
 */




type EffShape = {
  shape?: { k?: string; eff?: string; inner?: Abs___nudojs_core; rejected?: Abs___nudojs_core; unsettled?: boolean };
};

/** 结果取值：promise 取兑现域（inner），非 promise 取自身 */
function v(src: string): { ok: boolean; value?: unknown } {
  const r = call(src, "f");
  const sh = r.result.shape as EffShape["shape"];
  return litValue___nudojs_core((sh?.k === "eff" && sh.eff === "promise" ? sh.inner : r.result) as Abs___nudojs_core);
}

/** 结果的展示串（签名面） */
function fmt(src: string): string {
  return formatAbs(call(src, "f").result as Abs___nudojs_core)?.replace(/\s+#[a-z0-9]+$/, "") ?? "";
}


  it("then({}) → 透传原值（非调用 → ≡ undefined）；then([1, 2]) → 透传原值；then(null) → 透传原值（既有 nullish 口径不变）；catch({}) → 拒绝透传（非调用 handler ≡ undefined，不吞拒绝）；负控制：可调用 handler 仍真执行（映射 / 捕获）；负控制：非函数 prim handler 仍是 identity（既有口径不变）；签名面：非可调用 handler 的结果 promise 是 p", () => {
  {
    expect(
      v(`export async function f() { return Promise.resolve(1).then({}); }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(`export async function f() { return Promise.resolve(1).then([1, 2]); }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(`export async function f() { return Promise.resolve(1).then(null); }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    const r = call(`export async function f() { return Promise.reject(new Error("k")).catch({}); }`);
    const sh = r.result.shape as EffShape["shape"];
    expect(sh?.inner?.shape?.k, "fulfilled arm must be impossible").toBe("never");
    expect(sh?.rejected).toBeDefined();
  }
  {
    expect(
      v(`export async function f() { return Promise.resolve(1).then((x) => x + 1); }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(`export async function f() { return Promise.reject(new Error("k")).catch((e) => "c:" + e.message); }`),
    ).toEqual({ ok: true, value: "c:k" });
  }
  {
    expect(
      v(`export async function f() { return Promise.resolve(1).then(5); }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(fmt(`export function f() { return Promise.resolve(1).then({}); }`)).toContain(
      "promise<1>",
    );
  }
});







});

// ---------------------------------------------------------------------------
// 族 58 · 第 1 条 · writable:true 的重定义覆盖旧的 [[Writable]]
// ---------------------------------------------------------------------------
describe("writable:true 的重定义覆盖旧的 [[Writable]]", () => {
/**
 * 族 58 · W8 · core runtime **描述符与生成器协议面** —— 5 条精度债的回归钉。
 *
 * 本钉的断言口径：**对拍原生**（node v26.10.0 宿主实测，宿主断言直接写在本
 * 文件里——先证「该成员/该键在宿主真实存在」，再断言引擎与原生逐字一致）。
 * 每条用例都带**负控**（表外成员 / 未建模面仍按既有口径判定，逐字不变）。
 *
 * 逐条对应（族 58 台账 · W8 分片）：
 * 1. 描述符 exists 分支：`writable:true` 的**重定义**不覆盖旧的
 * `[[Writable]]` ⇒ 引擎读描述符/写门须见**新的** writable。
 * 2. 原型 brand 描述符面：`Object.getOwnPropertyNames(Error.prototype)`
 * / `Object.hasOwn(Error.prototype, "name")` 折 partial。
 * 3. 原型 brand 描述符 / gOPN 面：类原型的 `Object.getOwnPropertyNames` /
 * `Object.keys` 折保守域（`string[]`），非精确列表。
 * 4. 生成器 `prototype.next` 协议面缺席（`g.prototype.next` 折 undefined）。
 * 5. `.length` slot 在任意 brand 上不可读（core 的 `$len` 不读任意 brand 的
 * `"length"` 槽 ⇒ env brand 的 `.length` 拿不到，如 Buffer 实例）。
 *
 * 口径边界（**诚实写明**，勿当精确承诺）：
 * - 第 2/3 条的用户类原型 / Error 家族给精确清单；**内建原型**（Array /
 * Object / Map…）已由 A10 残余批次（`builtins/ctor.ts::hostProtoOwnKeys`
 * 宿主采集对拍）升为精确面，见 `abs-proto-own-keys-facet.test.ts`。
 * - 用户类原型的**方法与访问器交错定义序**曾因 `methods` / `accessors`
 * 分两张表而不可复原 ⇒ 保守 `string[]`；A10 残余批次已由
 * `EvalClassSpec.protoMemberOrder`（转译期按类体源码序登记）收口，
 * 本文件下方 4 条钉与宿主逐一对拍（含定义序反转 / 静态 / 私有 / 计算键）。
 * - 第 4 条：协议方法在**原型链**上（原生 `g.prototype` 自有键为空）⇒ 引擎
 * 把协议槽标 internal——自有面（hasOwnProperty / gOPN / 枚举）不可见，
 * 与原生一致；`g.prototype` 的 gOPN 仍走既有保守域 `string[]`（不折空）。
 * - 第 5 条：core 不依赖 `@nudojs/env` ⇒ env 的 Buffer brand 用**同形**
 * （brand + 内层 obj 的 `"length"` 槽）在 core 内构造后直接打 `$len`。
 *
 * ⚠️ **类名唯一性**：引擎的类注册表按**类名**全局驻留（同名类跨用例共享同
 * 一原型对象）⇒ 本文件每个用例用**互不相同**的类名，避免用例间互相污染。
 */







const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue_____index_ts(call(src, "f").result);
}

/** 结果的 throws 面名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

// ---------------------------------------------------------------------------
// 1. 描述符 exists 分支 · writable:true 的重定义
// ---------------------------------------------------------------------------

  it("宿主实测：writable:true 的重定义把 [[Writable]] 翻回 true（node 原生）；引擎：普通对象 —— 重定义后描述符读出**新的** writable（原生 true）；引擎：原型对象 —— 重定义后描述符读出**新的** writable（原生 true）；引擎：重定义后写门放开（原生 o.x = 2 成功）；负控：writable:true → false 的收紧仍生效（原生 false）；负控：不可配置 + writable:false 的", () => {
  {
    const o = {};
    Object.defineProperty(o, "x", { value: 1, writable: false, configurable: true, enumerable: true });
    Object.defineProperty(o, "x", { writable: true });
    expect(Object.getOwnPropertyDescriptor(o, "x")?.writable).toBe(true);
    // 反向收紧（true → false）也生效
    const p = {};
    Object.defineProperty(p, "x", { value: 1, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(p, "x", { writable: false });
    expect(Object.getOwnPropertyDescriptor(p, "x")?.writable).toBe(false);
  }
  {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { writable: true }); return Object.getOwnPropertyDescriptor(o, "x").writable;`,
    );
    expect(v(src)).toEqual({ ok: true, value: true });
  }
  {
    const src = wrap(
      `class Bug58ProtoA {} Object.defineProperty(Bug58ProtoA.prototype, "m", { value: 1, writable: false, configurable: true }); Object.defineProperty(Bug58ProtoA.prototype, "m", { writable: true }); return Object.getOwnPropertyDescriptor(Bug58ProtoA.prototype, "m").writable;`,
    );
    expect(v(src)).toEqual({ ok: true, value: true });
  }
  {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { writable: true }); o.x = 2; return o.x;`,
    );
    expect(v(src)).toEqual({ ok: true, value: 2 });
  }
  {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: true, configurable: true, enumerable: true }); Object.defineProperty(o, "x", { writable: false }); return Object.getOwnPropertyDescriptor(o, "x").writable;`,
    );
    expect(v(src)).toEqual({ ok: true, value: false });
  }
  {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: false }); Object.defineProperty(o, "x", { writable: true }); return o.x;`,
    );
    expect(throwName(src)).toBe("TypeError");
  }
  {
    const src = wrap(
      `const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false, configurable: false }); Object.defineProperty(o, "x", { value: 1 }); return o.x;`,
    );
    expect(v(src)).toEqual({ ok: true, value: 1 });
  }
});








// ---------------------------------------------------------------------------
// 2. 原型 brand 描述符面（Error 家族）
// ---------------------------------------------------------------------------
describe("原型 brand 描述符面（Error 家族）", () => {
  it("宿主实测：Error.prototype 的自有键与 hasOwn 判定（node 原生）；引擎：gOPN(Error.prototype) 精确列出自有键（原生同款）；引擎：gOPN(TypeError.prototype) 精确（toString 是**继承**的，不入自有键）；引擎：Object.hasOwn(Error.prototype, ...) 折确定 boolean（原生 true/false）；引擎：TypeError.prototype 的 toStrin", () => {
  {
    expect(Object.getOwnPropertyNames(Error.prototype)).toEqual([
      "constructor",
      "name",
      "message",
      "toString",
    ]);
    expect(Object.getOwnPropertyNames(TypeError.prototype)).toEqual([
      "constructor",
      "name",
      "message",
    ]);
    expect(Object.hasOwn(Error.prototype, "name")).toBe(true);
    expect(Object.hasOwn(Error.prototype, "message")).toBe(true);
    expect(Object.hasOwn(Error.prototype, "toString")).toBe(true);
    expect(Object.hasOwn(Error.prototype, "zzz")).toBe(false);
    expect(Object.keys(Error.prototype)).toEqual([]);
  }
  {
    const r = call(wrap(`return Object.getOwnPropertyNames(Error.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual(["constructor", "name", "message", "toString"]);
  }
  {
    const r = call(wrap(`return Object.getOwnPropertyNames(TypeError.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual(["constructor", "name", "message"]);
  }
  {
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "name");`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "message");`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "toString");`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`return Object.hasOwn(Error.prototype, "zzz");`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(wrap(`return Object.hasOwn(TypeError.prototype, "toString");`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    const r = call(wrap(`return Object.keys(Error.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual([]);
  }
  {
    const r = call(wrap(`return Object.getOwnPropertyNames(Array.prototype);`), "f").result;
    expect(tupleEls(r)).toEqual(Object.getOwnPropertyNames(Array.prototype));
  }
  {
    const r = call(wrap(`return Object.hasOwn(Object.prototype, "toString");`), "f").result;
    expect(litValue_____index_ts(r)).toEqual({ ok: true, value: true });
  }
});







});

// ---------------------------------------------------------------------------
// 3. 类原型 brand 的 gOPN / keys 面
// ---------------------------------------------------------------------------
describe("类原型 brand 的 gOPN / keys 面", () => {
  it("宿主实测：类原型的自有键 / 可枚举键 / hasOwn（node 原生）；引擎：gOPN(类原型) 精确列出 constructor + 自有方法（原生同款）；引擎：gOPN(只有访问器的类原型) 精确列出 constructor + 访问器（原生同款）；引擎：gOPN(类原型) 按**定义序**列出 constructor + 自有方法（原生同款）；引擎：gOPN(子类原型) 不列**继承**的祖先成员（原生同款）；引擎：Object.keys(类原型) 折精确空元组（原", () => {
  {
    class HostClassA {
      m() {}
    }
    expect(Object.getOwnPropertyNames(HostClassA.prototype)).toEqual(["constructor", "m"]);
    expect(Object.keys(HostClassA.prototype)).toEqual([]);
    expect(Object.hasOwn(HostClassA.prototype, "m")).toBe(true);
    expect(Object.hasOwn(HostClassA.prototype, "zzz")).toBe(false);
    class HostClassB {
      get g() {
        return 1;
      }
    }
    expect(Object.getOwnPropertyNames(HostClassB.prototype)).toEqual(["constructor", "g"]);
  }
  {
    const r = call(
      wrap(`class Bug58ClassA { m() {} } return Object.getOwnPropertyNames(Bug58ClassA.prototype);`),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "m"]);
  }
  {
    const r = call(
      wrap(
        `class Bug58ClassB { get g() { return 1; } } return Object.getOwnPropertyNames(Bug58ClassB.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "g"]);
  }
  {
    const r = call(
      wrap(`class Bug58ClassH { m() {} n() {} } return Object.getOwnPropertyNames(Bug58ClassH.prototype);`),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "m", "n"]);
  }
  {
    const r = call(
      wrap(
        `class Bug58ClassIBase { base() {} } class Bug58ClassI extends Bug58ClassIBase { own() {} } return Object.getOwnPropertyNames(Bug58ClassI.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "own"]);
  }
  {
    const r = call(
      wrap(`class Bug58ClassC { m() {} } return Object.keys(Bug58ClassC.prototype);`),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual([]);
  }
  {
    expect(
      v(wrap(`class Bug58ClassD { m() {} } return Object.hasOwn(Bug58ClassD.prototype, "m");`)),
    ).toEqual({ ok: true, value: true });
    expect(
      v(
        wrap(
          `class Bug58ClassE { m() {} } return Object.hasOwn(Bug58ClassE.prototype, "constructor");`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
    expect(
      v(wrap(`class Bug58ClassF { m() {} } return Object.hasOwn(Bug58ClassF.prototype, "zzz");`)),
    ).toEqual({ ok: true, value: false });
  }
  {
    class HostClassG {
      m() {}
      get g() {
        return 1;
      }
    }
    expect(Object.getOwnPropertyNames(HostClassG.prototype)).toEqual(["constructor", "m", "g"]);
    const r = call(
      wrap(
        `class Bug58ClassG { m() {} get g() { return 1; } } return Object.getOwnPropertyNames(Bug58ClassG.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "m", "g"]);
  }
  {
    class HostClassGRev {
      get g() {
        return 1;
      }
      m() {}
    }
    expect(Object.getOwnPropertyNames(HostClassGRev.prototype)).toEqual(["constructor", "g", "m"]);
    const r = call(
      wrap(
        `class Bug58ClassGRev { get g() { return 1; } m() {} } return Object.getOwnPropertyNames(Bug58ClassGRev.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "g", "m"]);
  }
  {
    class HostClassMix {
      m() {}
      get g() {
        return 1;
      }
      n() {}
      static s() {}
      #p() {}
    }
    expect(Object.getOwnPropertyNames(HostClassMix.prototype)).toEqual([
      "constructor",
      "m",
      "g",
      "n",
    ]);
    const r = call(
      wrap(
        `class Bug58ClassMix { m() {} get g() { return 1; } n() {} static s() {} #p() {} } return Object.getOwnPropertyNames(Bug58ClassMix.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "m", "g", "n"]);
  }
  {
    class HostClassCk {
      ["a"]() {}
      get g() {
        return 1;
      }
      ["b"]() {}
    }
    expect(Object.getOwnPropertyNames(HostClassCk.prototype)).toEqual([
      "constructor",
      "a",
      "g",
      "b",
    ]);
    const r = call(
      wrap(
        `class Bug58ClassCk { ["a"]() {} get g() { return 1; } ["b"]() {} } return Object.getOwnPropertyNames(Bug58ClassCk.prototype);`,
      ),
      "f",
    ).result;
    expect(tupleEls(r)).toEqual(["constructor", "a", "g", "b"]);
  }
});










});

// ---------------------------------------------------------------------------
// 4. 生成器 prototype 的协议面（next / return / throw）
// ---------------------------------------------------------------------------
describe("生成器 prototype 的协议面", () => {
  it("宿主实测：%GeneratorPrototype% 的协议面**真实存在**（node 原生）；引擎：g.prototype.next 可读（typeof \"function\"，原生同款）；引擎：g.prototype.return / throw 可读（原生同款）；引擎：借用调用 g.prototype.next.call(it) 推进生成器（原生 {value:1,done:false}）；引擎：无接收者调用 g.prototype.next() 原生定抛 TypeErr", () => {
  {
    function* hostGen() {
      yield 1;
    }
    expect(typeof hostGen.prototype.next).toBe("function");
    expect(typeof hostGen.prototype.return).toBe("function");
    expect(typeof hostGen.prototype.throw).toBe("function");
    // 协议方法在**原型链**上——不是原型对象的自有键（gOPN 为空）
    expect(Object.getOwnPropertyNames(hostGen.prototype)).toEqual([]);
    // 借用调用推进接收者生成器
    const it = hostGen();
    expect(hostGen.prototype.next.call(it)).toEqual({ value: 1, done: false });
    expect(hostGen.prototype.next.call(it)).toEqual({ value: undefined, done: true });
  }
  {
    expect(
      v(wrap(`function* g() { yield 1; } return typeof g.prototype.next;`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(wrap(`function* g() { yield 1; } return typeof g.prototype.return;`)),
    ).toEqual({ ok: true, value: "function" });
    expect(
      v(wrap(`function* g() { yield 1; } return typeof g.prototype.throw;`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    expect(
      v(
        wrap(
          `function* g() { yield 1; } const it = g(); const a = g.prototype.next.call(it); const b = g.prototype.next.call(it); return [a.value, a.done, b.done].join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "1,false,true" });
  }
  {
    const src = wrap(`function* g() { yield 1; } return g.prototype.next();`);
    expect(throwName(src)).toBe("TypeError");
  }
  {
    expect(
      v(wrap(`function* g() { yield 1; } const it = g(); return typeof it.next;`)),
    ).toEqual({ ok: true, value: "function" });
  }
  {
    const r = call(
      wrap(`function* g() { yield 1; } return Object.getOwnPropertyNames(g.prototype);`),
      "f",
    ).result;
    expect(formatShape_____index_ts(r)).toBe("[]");
    expect(tupleEls(r)).toEqual([]);
  }
  {
    expect(
      v(wrap(`function* g() { yield 1; } return Object.hasOwn(g.prototype, "next");`)),
    ).toEqual({ ok: true, value: false });
  }
});







});

// ---------------------------------------------------------------------------
// 5. 任意 brand 的 "length" 槽
// ---------------------------------------------------------------------------
describe("任意 brand 的 \"length\" 槽可读", () => {
  /** env 声明面同形的 brand（Buffer：内层 obj 带 "length" 槽） */
  function lengthBrand(name: string, slots: Record<string, { value: ReturnType<typeof abs> }>) {
    return abs({ k: "brand", name, shape: objOf(slots) }, undefined, undefined, "exact");
  }

  const numAbs = () =>
    abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

  it("宿主实测：Buffer 实例的 length 真实存在（node 原生 3）；引擎：任意 brand 的 \"length\" 槽可读（Buffer 同形 brand → number）；引擎：brand 的 \"length\" 槽与成员读面同口径（$get 同槽）；负控：无 length 槽的 brand 仍折 unknown（逐字不变）；负控：对象字面量 / 字符串 / 数组的 length 逐字不变（原生 7 / 3 / 3）", () => {
  {
    expect(Buffer.from("abc").length).toBe(3);
    expect(Object.prototype.hasOwnProperty.call(Buffer.from("abc"), "length")).toBe(false);
  }
  {
    const brand = lengthBrand("Buffer", { length: { value: numAbs() } });
    expect(formatShape_____index_ts($len(brand))).toBe("number");
  }
  {
    const brand = lengthBrand("Buffer58", { length: { value: numAbs() } });
    // $len 与 $get 读同一槽 ⇒ 同一个值域（number）
    expect(formatShape_____index_ts($len(brand))).toBe("number");
  }
  {
    const brand = lengthBrand("Bug58NoLength", {});
    expect(formatShape_____index_ts($len(brand))).toBe("unknown");
  }
  {
    expect(v(wrap(`const o = { length: 7 }; return o.length;`))).toEqual({
      ok: true,
      value: 7,
    });
    expect(v(wrap(`return "abc".length;`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`return [1, 2, 3].length;`))).toEqual({ ok: true, value: 3 });
  }
});




});
});

// ---------------------------------------------------------------------------
// Promise.all 等元素 settle 后才兑现（不取调用期快照）
// ---------------------------------------------------------------------------
describe("Promise.all 等元素 settle 后才兑现（不取调用期快照）", () => {
/**
 * 回归钉：`Promise.all` 不得取**调用期快照**（组合子的兑现值 =
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
 * **返回 promise 的 rejection**（不同步抛——node v26 实测口径）。
 * - 元素**全部已 settle** 时走既有快路径（`promise<[1, 2]>` 等金标零漂移）。
 *
 * 已知遗留（**不在本条归属**——`.then` 反应面在 pending 接收者上仍抢跑，
 * 与 `Promise.all` 无关：任何 live async-gen promise 的 `.then(cb)` 都读
 * 到占位符；见交付报告的"剩余风险"）：
 * `Promise.all([...]).then(cb)` 的 `cb` 仍读到占位符（反应面未等 settle）。
 */










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

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("await Promise.all([inner(), inner()])（inner 2 个 await）= 4（原生 4）；check 面签名：promise<4>（原生 4；修前是 promise<number | string>）；组合子自身：返回值即 [2, 2]（原生 [2, 2]；修前是占位符 unknown）；兑现序：组合子在**两个元素都 settle 之后**才兑现（原生 \"a,a,b,b,all\"）；混合元素（pending + 已 settle）= 7", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`),
    ).toBe(4);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = `${INNER_TWO_AWAIT}
      export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`;
    const r = checkSource("/t/src.js", src, pTrue, {});
    expect(sigOf(r, "f")).toBe("promise<4>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.all([inner(), inner()]); }`),
    ).toContain("promise<[2, 2]>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


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
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { const r = await Promise.all([inner(), Promise.resolve(5)]); return r[0] + r[1]; }`),
    ).toBe(7);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function inner() { await null; await null; throw new Error("boom"); }
        export async function f() {
          try { await Promise.all([inner(), inner()]); return "no"; }
          catch (e) { return "caught:" + e.message; }
        }`),
    ).toBe("caught:boom");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = call(
      `async function inner() { await null; await null; throw new Error("boom"); }
       export async function f() { await Promise.all([inner(), inner()]); return "no"; }`,
      "f",
    );
    const sh = r.result.shape as { k?: string; inner?: { shape: { k: string } }; rejected?: unknown };
    expect(sh.k).toBe("eff");
    expect(sh.inner?.shape.k).toBe("never");
    expect(sh.rejected).toBeDefined();
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function bad() { await null; await null; throw new Error("boom"); }
        async function good() { await null; await null; return 2; }
        export async function f() {
          try { await Promise.all([good(), bad()]); return "no"; }
          catch (e) { return "caught:" + e.message; }
        }`),
    ).toBe("caught:boom");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function inner() { return 2; }
        export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`),
    ).toBe(4);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function inner() { await null; return 2; }
        export async function f() { const r = await Promise.all([inner(), inner()]); return r[0] + r[1]; }`),
    ).toBe(4);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1), 2]); }`)).toContain(
      "promise<[1, 2]>",
    );
    expect(fmt(`export function f() { return Promise.all([Promise.resolve(1)]); }`)).toContain(
      "promise<[1]>",
    );
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(fmt(`export function f() { return Promise.all(1); }`)).toContain("promise<unknown>");
  }
});











}
});

// ---------------------------------------------------------------------------
// promise 反应面（.then/.catch）与组合子（race/any/allSettled）不抢跑
// ---------------------------------------------------------------------------
describe("promise 反应面（.then/.catch）与组合子（race/any/allSettled）不抢跑", () => {
/**
 * 回归钉：**promise 反应面**（.then/.catch）与**其它组合子**
 * （race / any / allSettled）不得抢跑、不得取调用期快照。
 *
 * 原生（node v26.10.0 实测，见交付报告的原生基线表）：
 * - `await inner().then((v) => v + 1)`（inner 含 2 个 await）→ **3**
 * - `await Promise.all([inner(), inner()]).then((r) => r[0] + r[1])` → **4**
 * - `await Promise.race([inner(), Promise.resolve(9)])` → **9**（已 settle 的
 * 元素先赢——原生 race 是「首个 settle 赢」）
 * - `await Promise.any([inner(), Promise.resolve(9)])` → **9**（首个 fulfilled 赢）
 * - `await Promise.any([Promise.reject(1), innerRej()])` → **AggregateError**
 * （全拒才拒）
 * - `await Promise.allSettled([inner(), Promise.resolve(9)])` →
 * **fulfilled:2,fulfilled:9**（等全部 settle，逐项记 fulfilled/rejected）
 * - 兑现序：`log` = "a,a,b,b,then:2,after"（then 回调在 all 兑现**之后**跑）
 *
 * 修前（假绿）：
 * - `.then` / `.catch` 在 **pending 接收者**上按「已 fulfilled」处理 ⇒ 反应
 * **抢跑**（回调读到占位符 `unknown`）⇒ `inner().then(v => v + 1)` 得
 * `promise<number | string>`（原生 `promise<3>`）。
 * - `Promise.race` / `Promise.any` / `Promise.allSettled` 对元素 promise 取
 * **调用期快照**（`elementSettle` 读 `shape.inner`）⇒ 兑现值被占位符
 * **永久冻住**（原生 9 / 9 / fulfilled:2，引擎 unknown | 9 / unknown | 9 /
 * fulfilled:unknown）。
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
 * 结果 promise 自身是 live pending（`inner` 就地填）⇒ `await` 方排在
 * settle 之后恢复；拒绝 ⇒ 走 rejection 通道（catch 臂可达）。
 * - 1150-b：race / any / allSettled 按原生语义建模（race 首个 settle 赢；
 * any 首个 fulfilled 赢、全拒才 AggregateError；allSettled 等全部 settle
 * 并逐项记 fulfilled/rejected）；元素**全部已 settle** 时保留原快路径
 * （金标零漂移）。
 *
 * 已知遗留（**不在本条归属**——悬挂元素建模缺口，见交付报告 1150-c 方案
 * 草案）：元素**永不 settle** 时组合子永不 settle，await 方永不恢复，且调用
 * 方 promise 停在 `inner=unknown` 且**不带 `unsettled` 标记**。
 */










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

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  // ---------- 1150-a：反应面在 pending 接收者上抢跑 ----------

  it("then 在 pending 接收者上：回调读到终值（原生 3；修前 promise<number | string>）；then 在 pending 接收者上：await 面读到终值（原生 3）；check 面签名：promise<3>（原生 3；修前 promise<number | string>）；then 在 pending 接收者上：拒绝 ⇒ onRejected 臂可达（原生 \"rej:boom\"）；catch 在 pending 接收者上：catch 臂可达（", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return inner().then((v) => v + 1); }`),
    ).toContain("promise<3>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await inner().then((v) => v + 1); }`),
    ).toBe(3);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = checkSource(
      "/t/src.js",
      `${INNER_TWO_AWAIT}
        export async function f() { const r = await inner().then((v) => v + 1); return r; }`,
      pTrue,
      {},
    );
    expect(sigOf(r, "f")).toBe("promise<3>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() { return await innerRej().then((v) => "no", (e) => "rej:" + e.message); }`),
    ).toBe("rej:boom");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() { return await innerRej().catch((e) => "caught:" + e.message); }`),
    ).toBe("caught:boom");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.all([inner(), inner()]).then((r) => r[0] + r[1]); }`),
    ).toContain("promise<4>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.all([inner(), inner()]).then((r) => r[0] + r[1]); }`),
    ).toBe(4);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`const log = [];
        async function innerL() { log.push("a"); await null; log.push("b"); await null; return 2; }
        export async function f() {
          const v = await Promise.all([innerL(), innerL()]).then((r) => { log.push("then:" + r[0]); return r[0]; });
          log.push("after");
          return log.join(",") + "|" + v;
        }`),
    ).toBe("a,a,b,b,then:2,after|2");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(fmt(`export function f() { return Promise.resolve(1).then((x) => x + 1); }`)).toContain(
      "promise<2>",
    );
    expect(
      fmt(`export function f() { return Promise.resolve(21).then((x) => x * 2).then((y) => y + 1); }`),
    ).toContain("promise<43>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.race([inner(), Promise.resolve(9)]); }`),
    ).toContain("promise<9>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.race([inner(), Promise.resolve(9)]); }`),
    ).toBe(9);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.race([innerRej(), Promise.resolve(9)]).then((v) => "f:" + v, (e) => "r:" + e.message);
        }`),
    ).toBe("f:9");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      fmt(`${INNER_TWO_AWAIT}
        export function f() { return Promise.any([inner(), Promise.resolve(9)]); }`),
    ).toContain("promise<9>");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.any([inner(), Promise.resolve(9)]); }`),
    ).toBe(9);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          try { await Promise.any([Promise.reject(new Error("k")), innerRej()]); return "no"; }
          catch (e) { return e.name + ":" + e.message; }
        }`),
    ).toBe("AggregateError:All promises were rejected");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() { return await Promise.any([Promise.reject(new Error("k")), inner()]); }`),
    ).toBe(2);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_TWO_AWAIT}
        export async function f() {
          return await Promise.allSettled([inner(), Promise.resolve(9)]).then((r) => r[0].status + ":" + r[0].value + "," + r[1].status + ":" + r[1].value);
        }`),
    ).toBe("fulfilled:2,fulfilled:9");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.allSettled([innerRej(), Promise.resolve(9)]).then((r) => r[0].status + ":" + r[0].reason.message + "," + r[1].status + ":" + r[1].value);
        }`),
    ).toBe("rejected:boom,fulfilled:9");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(fmt(`export function f() { return Promise.race([1, "a"]); }`)).toContain('promise<1 | "a">');
    expect(fmt(`export function f() { return Promise.any([1]); }`)).toContain("promise<1>");
    expect(fmt(`export function f() { return Promise.allSettled([1]); }`)).toContain(
      'status: "fulfilled" | "rejected"',
    );
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.all([innerRej(), innerRej()]).then((v) => "f:" + v, (e) => "rej:" + e.message);
        }`),
    ).toBe("rej:boom");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.all([innerRej(), innerRej()]).catch((e) => "caught:" + e.message);
        }`),
    ).toBe("caught:boom");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.race([innerRej(), Promise.reject("r")]).then((v) => "f:" + v, (e) => "rej:" + e);
        }`),
    ).toBe("rej:r");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`${INNER_REJECT}
        export async function f() {
          return await Promise.any([Promise.reject("a"), Promise.reject("b")]).then((v) => "f:" + v, (e) => e.name + ":" + e.message);
        }`),
    ).toBe("AggregateError:All promises were rejected");
  }
});









  // ---------- 1150-b：race / any / allSettled 取调用期快照 ----------











  // ---------- 组合子与反应面的交叉面（拒绝臂不丢） ----------




}
});
