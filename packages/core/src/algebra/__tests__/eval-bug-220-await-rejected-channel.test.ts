/**
 * Bug 220 回归钉：`$await` **不得丢掉双臂 promise 的 rejected 通道**。
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
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue, anyAbs } from "../abs.ts";
import { formatAbs } from "../format.ts";

describe("Bug 220：await 双臂 promise —— 拒绝臂不再被丢弃", () => {
  it("双臂 promise：try 臂与 catch 臂都可达（并集）", () => {
    const src = `
export async function f(c) {
  const p = new Promise((res, rej) => { if (c) res(1); else rej(new Error("k")); });
  try { const v = await p; return "v:" + v; } catch (e) { return "c:" + e.message; }
}
`;
    const r = call(src, "f", [anyAbs]);
    const awaited = formatAbs($await(r.result) as never);
    // 改前：只有 "v:1"（catch 臂死代码）；改后：两臂并集
    expect(awaited).toContain('"v:1"');
    expect(awaited).toContain('"c:k"');
  });

  it("负控制：确定拒绝的 promise —— catch 臂取值不变（\"c:k\"）", () => {
    const src = `
export async function f() {
  const p = Promise.reject(new Error("k"));
  try { const v = await p; return "v:" + v; } catch (e) { return "c:" + e.message; }
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "c:k" });
  });

  it("负控制：确定 fulfilled 的 promise —— 只有 fulfilled 臂", () => {
    const src = `
export async function f() {
  const p = Promise.resolve(1);
  try { const v = await p; return "v:" + v; } catch (e) { return "c:" + e.message; }
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "v:1" });
  });
});
