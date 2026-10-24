/**
 * Bug 229 回归钉：`yield*` 委托的生成器 `.return(v)` **必须转发**给
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
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

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

describe("Bug 229：yield* 委托的 .return(v) 转发", () => {
  it(".return(v) 转发给委托迭代器（委托的清理副作用不再丢失）", () => {
    expect(
      val(`export function f() { ${DELEGATE}
        function* g() { yield* it; }
        const gi = g();
        gi.next();
        gi.return(5);
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "ret:5" });
  });

  it("负控制：非委托挂起点的 .return(v) 不转发（无委托 → 无副作用）", () => {
    expect(
      val(`export function f() { ${DELEGATE}
        function* g() { yield 1; }
        const gi = g();
        gi.next();
        gi.return(5);
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("负控制：普通生成器的 .return(v) 语义不变（{value: v, done: true}）", () => {
    expect(
      val(`export function f() {
        function* g() { yield 1; }
        const gi = g();
        gi.next();
        const r = gi.return(7);
        return r.value + ":" + r.done;
      }`),
    ).toEqual({ ok: true, value: "7:true" });
  });
});
