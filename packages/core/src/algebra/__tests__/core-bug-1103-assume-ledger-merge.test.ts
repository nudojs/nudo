/**
 * Bug 1103 —— **引理账本**（`assume-ledger.ts`）是「本次证明消费过哪些公理」的
 * 唯一事实源；归因面（`nudo:assume-relied`）必须在**记账之后**读它。
 *
 * 背景（并发 review 收口发现的死写）：Φ 侧的消费在 `check-return.ts` 的证明段
 * 里记进账本（`noteAssumeConsumed`），而调用方（`check.ts`）传入的
 * `consumedAssume` 快照取自**调用之前** ⇒ Φ 侧的写入永远读不到 ⇒ 账本写入
 * 成了死写；changeset 宣称的「经 `noteAssumeConsumed` 记进引理账本 ⇒
 * `nudo:assume-relied` 归因可见」这条链路实际断在取数时序上。
 *
 * 修法：归因集就地取账本（读在写之后）⇒ 账本是唯一事实源；调用方快照退化为
 * 兜底（保留兼容）。
 *
 * 本文件覆盖：
 * - 账本是**活写**：Φ 被消费 ⇒ 记账 + 归因可见（不依赖调用方传快照）。
 * - 只靠账本消费（调用方未传快照）⇒ 仍须归因（改前此处归因丢失）。
 * - 未被消费的公理**不得**归因（不得把没消费过的公理报成 relied）。
 * - 账本按**对象身份**匹配（别的前提不得按位置误配）。
 */
import { describe, it, expect } from "vitest";
import { abs, gt, v } from "../index.ts";
import { number } from "../constraint.ts";
import { checkReturnConstraint } from "../check-return.ts";
import {
  assumeConsumed,
  noteAssumeConsumed,
  resetAssumeConsumed,
} from "../assume-ledger.ts";

/** 返回项：number，term = y（无 pred ⇒ 无值域证据） */
const retY = abs({ k: "prim", type: "number" }, v("y"), undefined, "exact");
/** 返回项：number，term = y，值域证据 `y > 20`（自身即可蕴含契约 `y > 10`） */
const retYProved = abs(
  { k: "prim", type: "number" },
  v("y"),
  gt(v("y"), { op: "lit", value: 20 }),
  "exact",
);

describe("Bug 1103：引理账本 = 消费事实源（归因取数在记账之后）", () => {
  it("Φ 被消费 ⇒ 记账 + 归因可见（账本是活写，不依赖调用方传快照）", () => {
    resetAssumeConsumed();
    // Φ = `y > 20`（同项且蕴含 `y > 10`）⇒ 去掉 Φ 证不出 ⇒ 本次证明依赖
    // 这条公理 ⇒ 记账 + 归因。**不传** `consumedAssume`（调用方快照缺位）。
    const premise = gt(v("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint("f", "positive", number().gt(10), retY, {
      phi: premise,
      phiPremises: [premise],
      assumeDisplay: ["y >= 20"],
    });
    expect(assumeConsumed()).toContain(premise);
    const relied = issues.filter((i) => i.code === "nudo:assume-relied");
    expect(relied).toHaveLength(1);
    expect(relied[0]!.message).toContain("y >= 20");
  });

  it("只靠账本消费（调用方未传快照）⇒ 仍须归因（改前此处归因丢失）", () => {
    // 模拟代数核在**引理消费点**（div/sub 折叠）记账：调用方没有把快照传进来
    // ⇒ 归因只能靠就地读账本。改前（只认调用方快照）⇒ 这里归因丢失。
    resetAssumeConsumed();
    const premise = gt(v("y"), { op: "lit", value: 20 });
    noteAssumeConsumed(premise);
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYProved,
      {
        assumeDisplay: ["y >= 20"],
        phiPremises: [premise],
      },
    );
    const relied = issues.filter((i) => i.code === "nudo:assume-relied");
    expect(relied).toHaveLength(1);
    expect(relied[0]!.message).toContain("y >= 20");
  });

  it("既未记账、也非 Φ 命中 ⇒ 不归因（不得把没消费过的公理报成 relied）", () => {
    resetAssumeConsumed();
    const premise = gt(v("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYProved,
      {
        assumeDisplay: ["y >= 20"],
        phiPremises: [premise],
      },
    );
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
  });

  it("账本里是**别的**前提（对象身份不同）⇒ 不归因（防按位置误配）", () => {
    resetAssumeConsumed();
    // 账本记的是 `x > 5`，而归因面要认的是 `y >= 20` ⇒ 两者不是同一条引理
    // （账本口径 = **对象身份**，不是位置）⇒ 不得归因。
    noteAssumeConsumed(gt(v("x"), { op: "lit", value: 5 }));
    const premise = gt(v("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYProved,
      {
        assumeDisplay: ["y >= 20"],
        phiPremises: [premise],
      },
    );
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
  });

  it("证明不成立（unprovable / disproved）⇒ 不报 relied（归因只对已证义务）", () => {
    resetAssumeConsumed();
    const premise = gt(v("y"), { op: "lit", value: 20 });
    noteAssumeConsumed(premise);
    // ret 无值域证据、无 Φ ⇒ 证不出 ⇒ 不是「证成了 ⇒ 依赖公理」
    const issues = checkReturnConstraint("f", "positive", number().gt(10), retY, {
      assumeDisplay: ["y >= 20"],
      phiPremises: [premise],
    });
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
    expect(issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  });
});
