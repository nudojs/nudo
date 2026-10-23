/**
 * Bug 1052 邻面回归钉：**then / catch / finally 回调返回值**的 thenable 采纳。
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
 *   兑现，不抛 TypeError）。
 *
 * `finally` 臂的原生语义（node v26 实测）：回调返回值是 thenable ⇒ **等它
 * settle**，但**兑现值丢弃**（`finally` 不改 settled value）⇒
 * `Promise.resolve(1).finally(() => ({then:(r)=>r(5)}))` ⇒ `1`（不是 5）；
 * thenable 调 reject ⇒ 结果被拒且 reason **替换**原 reason；thenable 没
 * settle ⇒ 结果 promise 永挂。
 *
 * 口径边界（已登记）：
 * - 宿主在**微任务**里调 `then`，引擎在求值点**抽象地**调（await 面 /
 *   `Promise.resolve` 面同款近似）⇒ 兑现值同款，`then` 体副作用的**时序**与
 *   原生不同。
 * - 采纳面**不可判**（any/unknown/fn/开对象/可选 `then` 槽）⇒ 仍标 unsettled
 *   （settle 不可判，不猜）——与 `Promise.resolve` 面同款。
 * - 采纳链深度上限 8（与片 S8 同款）。
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

describe("Bug 1052 邻面：then 回调返回值的 thenable 采纳", () => {
  it("thenable 的兑现值进 promise 的值域（原生 5，引擎改前 { then: (r) => ? }）", () => {
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
  });

  it("非 thenable 对照：回调返回普通值 ⇒ 逐字不变（promise<7>）", () => {
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
  });

  it("非 thenable 对照：回调返回普通对象 ⇒ 逐字不变（promise<{ a: 1 }>）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ a: 1 }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<{ a: 1 }>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  });

  it("负控：then 不是函数 ⇒ 按普通值兑现（原生同款，promise<{ then: 1 }>）", () => {
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
  });

  it("负控：then 调过但没 settle ⇒ 永挂（unsettled，不猜）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: () => {} }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("unknown");
  });

  it("负控：then 调 reject ⇒ rejected 通道记录该 reason", () => {
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
  });

  it("then 体抛错 ⇒ 结果被拒（reason = 抛出的值）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: () => { throw new Error("nope"); } }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(p.rejected).toBeDefined();
  });

  it("first-wins：then 先 res 后 rej ⇒ 只认第一次 settle（原生兑现 5）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: (res, rej) => { res(5); rej("boom"); } }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<5>");
    expect(promiseParts(r.result).rejected).toBeUndefined();
  });

  it("递归采纳：兑现值仍是 thenable ⇒ 再采纳一层（原生 7）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => ({ then: (r) => r({ then: (r2) => r2(7) }) }));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
  });

  it("回调返回 promise ⇒ 既有口径不变（promise<5>）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).then(() => Promise.resolve(5));
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<5>");
  });
});

describe("Bug 1052 邻面：catch 回调返回值的 thenable 采纳", () => {
  it("catch 臂的回调返回值是 thenable ⇒ 同款采纳（原生 5）", () => {
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
  });

  it("非 thenable 对照：catch 回调返回普通值 ⇒ 逐字不变（promise<7>）", () => {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => 7);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<7>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  });

  it("负控：catch 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）", () => {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => ({ then: () => {} }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("unknown");
  });

  it("负控：catch 回调返回的 thenable 调 reject ⇒ rejected 通道记录该 reason", () => {
    const src = `
export function f() {
  return Promise.reject("x").catch(() => ({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  });
});

describe("Bug 1052 邻面：finally 回调返回值的 thenable 采纳", () => {
  it("finally 臂的回调返回值是 thenable ⇒ 同款采纳（原生：兑现值丢弃，保留原值 1）", () => {
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
  });

  it("非 thenable 对照：finally 回调返回普通值 ⇒ 逐字不变（promise<1>）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => 7);
}
`;
    const r = call(src, "f");
    expect(formatShape(r.result)).toBe("promise<1>");
    expect(promiseParts(r.result).unsettled).toBe(false);
  });

  it("负控：finally 回调返回的 thenable 没 settle ⇒ 永挂（unsettled）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => ({ then: () => {} }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.unsettled).toBe(true);
    expect(formatShape(p.inner)).toBe("1");
  });

  it("负控：finally 回调返回的 thenable 调 reject ⇒ 结果被拒（reason 替换原 reason）", () => {
    const src = `
export function f() {
  return Promise.resolve(1).finally(() => ({ then: (res, rej) => rej("boom") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "boom" });
  });

  it("finally 臂的拒绝通道透传 + thenable 调 reject ⇒ reason 替换（原生同款）", () => {
    const src = `
export function f() {
  return Promise.reject("orig").finally(() => ({ then: (res, rej) => rej("new") }));
}
`;
    const r = call(src, "f");
    const p = promiseParts(r.result);
    expect(p.inner.shape.k).toBe("never");
    expect(litValue(p.rejected!)).toEqual({ ok: true, value: "new" });
  });
});

describe("Bug 1052 邻面：await 面与 promise 面同款（不回归）", () => {
  it("await then 臂的 thenable 兑现值（原生 6）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve(1).then(() => ({ then: (r) => r(5) }));
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  });

  it("await catch 臂的 thenable 兑现值（原生 6）", () => {
    const src = `
export async function f() {
  const v = await Promise.reject("x").catch(() => ({ then: (r) => r(5) }));
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  });

  it("await finally 臂的 thenable ⇒ 原生保留原值（2）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve(1).finally(() => ({ then: (r) => r(5) }));
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  });

  it("await 拒绝通道：then 臂的 thenable 调 reject ⇒ await 抛该 reason", () => {
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
  });

  it("await 非 thenable 不受影响（原生 8）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve(1).then(() => 7);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 8 });
  });
});
