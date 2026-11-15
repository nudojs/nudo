/**
 * Bug 221 回归钉：`await` 一个 **thenable** 必须做**采纳**。
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
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { $await } from "../exec/runtime/async.ts";
import { litValue } from "../abs.ts";

describe("Bug 221：await thenable 走采纳", () => {
  it("thenable 的 res 值被交付（原生 number，引擎改前 object）", () => {
    const src = `
export async function f() {
  const t = { then(res) { res(7); } };
  const v = await t;
  return typeof v + ":" + v;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "number:7" });
  });

  it("thenable 的 res 值可以是字符串", () => {
    const src = `
export async function f() {
  const t = { then(res, rej) { res("s"); } };
  const v = await t;
  return v;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: "s" });
  });

  it("负控制：非 thenable 的普通值不被采纳（await 5 → 5）", () => {
    const src = `
export async function f() {
  const v = await 5;
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 6 });
  });

  it("负控制：promise 仍走 promise 通道（await Promise.resolve(1) → 1）", () => {
    const src = `
export async function f() {
  const v = await Promise.resolve(1);
  return v + 1;
}
`;
    const r = call(src, "f");
    expect(litValue($await(r.result))).toEqual({ ok: true, value: 2 });
  });
});
