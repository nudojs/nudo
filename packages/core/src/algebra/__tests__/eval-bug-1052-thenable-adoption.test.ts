/**
 * Bug 1052 回归钉：**Promise 构造器 / 静态 resolve 的 thenable 采纳**。
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
 *   （**判定与调用**与 await 面（`exec/runtime/async.ts` 的 `adoptThenable`，
 *   Bug 221）**同一套**——不另造）；
 * - 采纳入口三处统一：`Promise.resolve` 静态臂、`new Promise` 执行器 `resolve`
 *   采集臂、await 面（复用）。
 *
 * 口径边界（已登记）：
 * - 宿主在**微任务**里调 `then`，引擎在求值点**抽象地**调（await 面同款近似）
 *   ⇒ 兑现值同款，`then` 体副作用的**时序**与原生不同（原生在微任务里）。
 * - 采纳面**不可判**（any/unknown/fn/开对象/可选 `then` 槽）⇒ 仍标 unsettled
 *   （settle 不可判，不猜）。
 * - `then` **不可调用** ⇒ 原生按**普通值**兑现（`Get(then)` 不可调用 ⇒ 直接以
 *   该值兑现）⇒ 引擎同款（不再当 unsettled）。
 */
import { describe, it, expect } from "vitest";
import { call, objSlots } from "./eval-helpers.ts";
import { $await } from "../exec/runtime/async.ts";
import { formatShape } from "../format.ts";
import { litValue, type Abs } from "../abs.ts";

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

describe("Bug 1052：Promise.resolve 的 thenable 采纳", () => {
  it("thenable 的兑现值进 promise 的值域（原生 1，引擎改前 { then: (r) => ? }）", () => {
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
  });

  it("负控制：非 thenable 的值不被采纳（Promise.resolve(1) → promise<1>）", () => {
    const src = `
export function f() {
  return Promise.resolve(1);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  });

  it("负控制：非 thenable 的对象照旧（Promise.resolve({a:1}) → promise<{ a: 1 }>）", () => {
    const src = `
export function f() {
  return Promise.resolve({ a: 1 });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ a: 1 }>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  });

  it("负控制：promise 实参仍走 promise 通道（Promise.resolve(Promise.resolve(1)) → promise<1>）", () => {
    const src = `
export function f() {
  return Promise.resolve(Promise.resolve(1));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
  });

  it("负控制：then **不是函数** ⇒ 不当作 thenable（按普通值兑现）", () => {
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
  });

  it("reject 通道：thenable 的 then 调 reject ⇒ 拒绝 reason 落 rejected 通道", () => {
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
  });

  it("reject 通道：await 该 promise ⇒ 抛 reason（catch 臂可达）", () => {
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
  });

  it("then 体抛错 ⇒ promise 被拒绝（reason = 抛出的值）", () => {
    const src = `
export function f() {
  return Promise.resolve({ then: () => { throw new Error("nope"); } });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(p.rejected).toBeDefined();
  });

  it("递归采纳：兑现值仍是 thenable ⇒ 再采纳一层（原生 7）", () => {
    const src = `
export function f() {
  return Promise.resolve({ then: (r) => r({ then: (r2) => r2(7) }) });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
  });

  it("then 不 settle ⇒ promise 永挂（值域 unknown，unsettled）", () => {
    const src = `
export function f() {
  return Promise.resolve({ then: () => {} });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("unknown");
  });

  it("first-wins：then 先 res 后 rej ⇒ 只认第一次 settle（原生兑现 1）", () => {
    const src = `
export function f() {
  return Promise.resolve({ then: (res, rej) => { res(1); rej("boom"); } });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
  });

  it("first-wins：then 先 rej 后 res ⇒ 拒绝（原生 reason = boom）", () => {
    const src = `
export function f() {
  return Promise.resolve({ then: (res, rej) => { rej("boom"); res(1); } });
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  });

  it("settle 之后的抛错被忽略（原生：thenable job 的抛错不改已定的兑现）", () => {
    const src = `
export function f() {
  return Promise.resolve({ then: (res) => { res(1); throw new Error("late"); } });
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
  });
});

describe("Bug 1052：new Promise(resolve => resolve(thenable)) 的采纳", () => {
  it("执行器 resolve 采到 thenable ⇒ 兑现值进 promise 的值域（原生 1）", () => {
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
  });

  it("执行器 resolve 采到非 thenable ⇒ 照旧（promise<{ a: 1 }>）", () => {
    const src = `
export function f() {
  return new Promise((resolve) => resolve({ a: 1 }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ a: 1 }>");
  });

  it("执行器 resolve 采到 thenable 且 then 调 reject ⇒ 拒绝通道带 reason", () => {
    const src = `
export function f() {
  return new Promise((resolve) => resolve({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  });
});

describe("Bug 1052：await 面与 promise 面共用同一套采纳机制（不回归）", () => {
  it("await thenable 仍交付 settle 值（原生 6，机制同款）", () => {
    const src = `
export async function f() {
  const v = await { then: (r) => r(5) };
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  });

  it("await promise 面采纳后的兑现值（await Promise.resolve(thenable) → 1）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve({ then: (r) => r(1) });
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  });

  it("await 非 thenable 不受影响（await 5 → 5）", () => {
    const src = `
export async function f() {
  const v = await 5;
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  });
});
