/**
 * Bug 379：导出类的**实例方法**在 L2 入口门禁面**整体漏检**（假绿）。
 *
 * 根因：check-may-throw.ts 的类分支**只有静态方法桥**（`$staticInvoke`）。
 * 静态桥对**不存在**的静态方法折 unknown（**不抛**）⇒ 实例方法走静态桥拿不到
 * 任何 throws 证据 ⇒ `evalThrowsOf` 交出「无证据」⇒ L2 门禁把
 * 「没分析出 may-throw」与「分析出没有 may-throw」当成同一件事 ⇒
 * 一个显式 `throw new TypeError()` 的公开实例方法判 OK / exit 0。
 *
 * 修法：类分支补**实例方法桥**（类 Abs → `$new`（构造实参 any，与
 * generalize.ts 同口径）→ `$invoke`），静态/实例按**源码类声明**判定
 * （运行期无法用返回值区分「静态方法返回 unknown」与「这是实例方法」）。
 *
 * 附带修：generalize.ts 的类方法桥此前把「方法体必抛」落进外层 catch ⇒
 * 签名退 unknown + 误导的 nudo:opaque-result（谎称「推断失败」）⇒ 改为
 * 返回位 never（与顶层导出同口径）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts, l2Count, sigOf } from "./nudo-constraints.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const clsSrc = `export class Counter {
  boom() { throw new TypeError("explicit"); }
  inc(by) { return by + 1; }
  static smake() { return 1 + Symbol("x"); }
}
export function plainBoom() { throw new TypeError("explicit"); }
`;

describe("Bug 379：类实例方法的 L2 入口 may-throw 不得整体漏检", () => {
  it("实例方法显式 throw ⇒ 报 nudo:entry-may-throw（改前：零 error / exit 0）", () => {
    const r = checkSource("cls.js", clsSrc, pTrue, stdOpts);
    expect(l2Count(r, "Counter.boom")).toBe(1);
    const issue = r.issues.find(
      (i) => i.code === "nudo:entry-may-throw" && i.fn === "Counter.boom",
    );
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("may throw TypeError");
  });

  it("静态方法与顶层函数口径不变（各 1 条 L2）", () => {
    const r = checkSource("cls.js", clsSrc, pTrue, stdOpts);
    expect(l2Count(r, "Counter.smake")).toBe(1);
    expect(l2Count(r, "plainBoom")).toBe(1);
  });

  it("实例方法必抛 ⇒ 签名面为 never（改前：unknown = 谎称「推断失败」）", () => {
    const r = checkSource("cls.js", clsSrc, pTrue, stdOpts);
    const sig = sigOf(r, "Counter.boom");
    expect(sig).toContain("never");
    expect(sig).not.toContain("unknown");
    expect(sig).toContain("throws TypeError");
  });

  it("eval 层：实例方法体必抛 ⇒ 调用返回 never + throws TypeError（无回归）", () => {
    const r = call(
      `export class Counter { boom() { throw new TypeError("x"); } }
       export function probe() { return new Counter().boom(); }`,
      "probe",
      [],
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
