/**
 * Bug 201 回归钉：`await` **真挂起**——async 体在 await 处挂起，
 * await 之后的语句**不在调用点内联跑完**（原生：恢复点是微任务）。
 *
 * 原生：`await` 挂起当前 async 体——`await` 之后的语句在**微任务**里
 * 才跑 ⇒ 调用方在同步窗口看不到 await 之后的副作用。引擎的 async 体此前
 * 是**eager 一把跑**（`$async(() => { ... })` 线性体，`await x` 只是
 * 一次普通调用）⇒ await 之后的副作用对调用方**立即可见**。
 *
 * 修法（转译侧 `exec/transpile/**` + 运行时侧 `exec/runtime/async.ts`）：
 * - async 体（**直接含 await**）编译成**宿主生成器** `function*(){…}`，
 *   `await x` 发射 `yield x`（挂起点 + 被等待值）；
 * - `$asyncGen` 驱动生成器：同步段跑到第一个挂起点即返回 promise，
 *   续体登记到**宿主微任务队列**（与 promise reaction 同一队列 ⇒ 跨
 *   promise 链顺序保真）；
 * - 续体跑完 ⇒ **就地**填 promise 的 inner（值域由续体终值给出）。
 *
 * 口径边界（已登记）：
 * - `for await` 走**整循环一个**挂起点（原生是每轮一个 await）——与引擎
 *   既有的同步 for-await 建模一致；
 * - async 体的 await 落在**分支臂 / 循环体 / switch 臂 / 短路表达式右臂**
 *   （宿主 thunk 位置）时，`yield` 会是语法错误 ⇒ 这类体**整体**沿用既有
 *   同步路径（行为不变，挂起缺陷仍在该形态上）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue } from "../abs.ts";

/** 调用导出的 f，返回同步段观测到的字面量值 */
function syncVal(src: string): unknown {
  const r = call(src, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : lv;
}

describe("Bug 201：await 挂起点（await 之后的副作用不进调用方的同步窗口）", () => {
  it("原生：f() 返回后 await 之前的写可见、之后的写不可见（n = 0）", () => {
    expect(
      syncVal(`let n = 0;
        async function g() { await 0; n = 5; }
        export function f() { g(); return n; }`),
    ).toBe(0);
  });

  it("原生：await 之后的副作用不进调用方的同步窗口（log = \"a\"）", () => {
    expect(
      syncVal(`const log = [];
        async function g() { log.push("a"); await 1; log.push("b"); await 2; log.push("c"); }
        export function f() { g(); return log.join(","); }`),
    ).toBe("a");
  });

  it("原生：for-await 体的 await 之后的效果同样延后", () => {
    expect(
      syncVal(`const log = [];
        async function g() { for await (const x of [1, 2]) log.push(x); }
        export function f() { g(); log.push("s"); return log.join(","); }`),
    ).toBe("s");
  });

  it("原生：async 函数返回 pending promise（Promise { 0 } ⇒ promise<0>）", () => {
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
  });
});

describe("Bug 201：await 之后的写对调用点完全不可见（含顺序与 typeof）", () => {
  it("await 之前的写保留（原生 1，引擎改前 11）", () => {
    expect(
      syncVal(`let n = 0;
        async function g() { n = 1; await 0; n += 10; }
        export function f() { g(); return n; }`),
    ).toBe(1);
  });

  it("调用点自身的同步语句不被 async 续体插队（原生 \"1,3,4\"）", () => {
    expect(
      syncVal(`const log = [];
        async function g() { log.push(1); await 0; log.push(2); }
        export function f() { g(); log.push(3); log.push(4); return log.join(","); }`),
    ).toBe("1,3,4");
  });

  it("await 之后的写对 typeof 观察不可见（原生 \"undefined\"）", () => {
    expect(
      syncVal(`let seen;
        async function g() { await 0; seen = "after"; }
        export function f() { g(); return typeof seen; }`),
    ).toBe("undefined");
  });

  it("箭头 async 体同样挂起（原生 \"a,c\"，引擎改前 \"a,b,c\"）", () => {
    expect(
      syncVal(`const log = [];
        const g = async () => { log.push("a"); await 0; log.push("b"); };
        export function f() { g(); log.push("c"); return log.join(","); }`),
    ).toBe("a,c");
  });

  it("pending promise 不被穿行（原生 \"a\"，引擎改前 \"a,b\"）", () => {
    expect(
      syncVal(`let resolve;
        const p = new Promise((r) => { resolve = r; });
        const log = [];
        async function g() { log.push("a"); await p; log.push("b"); }
        export function f() { g(); resolve(); return log.join(","); }`),
    ).toBe("a");
  });
});

describe("Bug 201：await 在**表达式位置**同样挂起", () => {
  it("const x = await f()：同步段拿不到被等待值", () => {
    expect(
      syncVal(`async function g() { return 7; }
        let out = "";
        async function h() { const x = await g(); out = String(x); }
        export function f() { h(); return out; }`),
    ).toBe("");
  });

  it("return await g()：调用点先返回", () => {
    expect(
      syncVal(`async function g() { return 7; }
        async function h() { return await g(); }
        export function f() { const p = h(); return "made"; }`),
    ).toBe("made");
  });

  it("h(await x)：实参位置同样挂起", () => {
    expect(
      syncVal(`async function g() { return 7; }
        let out = "";
        function k(v) { return v; }
        async function h() { out = String(k(await g())); }
        export function f() { h(); return out; }`),
    ).toBe("");
  });

  it("x + await y：二元表达式位置同样挂起", () => {
    expect(
      syncVal(`async function g() { return 7; }
        let out = "";
        async function h() { const a = 1; out = String(a + (await g())); }
        export function f() { h(); return out; }`),
    ).toBe("");
  });

  it("const {a} = await f()：解构位置同样挂起", () => {
    expect(
      syncVal(`async function g() { return { a: 1 }; }
        let out = "";
        async function h() { const { a } = await g(); out = String(a); }
        export function f() { h(); return out; }`),
    ).toBe("");
  });

  it("await 前的表达式照常求值（原生 3）", () => {
    expect(
      syncVal(`let out = "";
        async function g() { out = String(1 + 2); await 0; out = out + "!"; }
        export function f() { g(); return out; }`),
    ).toBe("3");
  });
});

describe("Bug 201：值域由**续体终值**给出（promise<inner> 不退化）", () => {
  it("await 后的返回值进 promise 的 inner", () => {
    const src = `
async function g() { return 7; }
export async function f() {
  const x = await g();
  return x + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 8 });
  });

  it("await 链的值域逐跳传递", () => {
    const src = `
export async function f() {
  return await Promise.resolve(21).then((x) => x * 2);
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 42 });
  });

  it("负控制：已 settle 的 promise 的 await 取值仍精确（await Promise.resolve(1) → 1）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve(1);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 2 });
  });

  it("负控制：async 函数仍返回 promise 形态（值域不被截断成 unknown）", () => {
    const src = `
export async function f() {
  return 42;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result as never))).toEqual({ ok: true, value: 42 });
  });
});
