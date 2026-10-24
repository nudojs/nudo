/**
 * Bug 1093 回归：类方法桥的**值域**通道（`generalize.ts`）——构造器**抛**时
 * 方法体的推断被一起拖垮 ⇒ 签名退 unknown + 误导的 info 级
 * `nudo:opaque-result`（把「构造器必抛」谎报成「推断失败」）。
 *
 * 与 Bug 1070（`check-may-throw.ts` 的**证据域**通道：构造器 throws 被归因给
 * 方法 ⇒ error 级 `nudo:entry-may-throw` 假红）是同一根因的两条通道：
 * 构造器的行为**不该**污染方法体的推断。
 *
 * 修前：`$new` 抛 ⇒ 异常逃出 `runCore` ⇒ `Account.describe` 退 unknown。
 * 修后：构造器抛 ⇒ 退到**裸实例**（跳过构造器）继续求值方法体 ⇒ 方法体
 * 自身的推断照常产出（`"acct"`）。
 *
 * oracle：语义断言（构造器抛 ≠ 方法抛）。
 */
import { describe, it, expect } from "vitest";
import { sigOf, issuesOf } from "./nudo-constraints.ts";

/** 构造器必抛、方法体 total */
const CTOR_THROWS = `export class Account {
  constructor(balance) { throw new Error("boom"); }
  describe() { return "acct"; }
}`;

describe("Bug 1093 — 类方法桥：构造器抛不得拖垮方法体的推断", () => {
  it("构造器抛 + 方法体 total ⇒ 方法签名仍是 \"acct\"（不是 unknown）", () => {
    const r = issuesOf(CTOR_THROWS);
    expect(sigOf(r, "Account.describe")).toBe(String.raw`"acct"`);
  });

  it("构造器抛 ⇒ 不产生误导的 nudo:opaque-result", () => {
    const r = issuesOf(CTOR_THROWS);
    expect(r.issues.filter((i) => i.code === "nudo:opaque-result")).toHaveLength(0);
  });

  it("构造器**不**抛时行为不变（方法签名照常）", () => {
    const r = issuesOf(`export class Account {
      constructor(balance) { this.balance = balance; }
      describe() { return "acct"; }
    }`);
    expect(sigOf(r, "Account.describe")).toBe(String.raw`"acct"`);
  });
});
