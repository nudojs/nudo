/**
 * Bug 1094 —— 返回点的**路径前提 Φ**真正接进生产（`postcondition.ts` 的
 * `assertImplies` / `check-return.ts` 的 `audit.phi` / `check.ts` 的接线）。
 *
 * 背景（Bug 1080 收口后的遗留）：Φ 侧此前**从未被接入**（`opts.phi` 恒为
 * `pTrue`），而按文档语义直接接线**不健全**——Φ 里的界原子可能约束的是
 * **另一个项**（`if (x > 0) return y`），旧口径把「含同项界原子」当成带界
 * 证据 ⇒ `implies` 失败落到 `disproved`（error）——而真实结论是「证不出」。
 *
 * 本文件覆盖：
 * - 任务 1：Φ 侧证据判据 = **同项 ∧ 蕴含**该约束的 pred ⇒ Φ 只能把
 *   `unprovable` 变 `proved`，**绝不**产生 `disproved`（假红）。
 * - 任务 2：生产接线（`@nudo:assume` 前提 Φ ⇒ 返回点 Φ）+ 归因可见
 *   （`nudo:assume-relied`）。
 * - 任务 3：假红不变式（遍历若干「同项但不足」的组合 ⇒ 永不 `disproved`）。
 */
import { describe, it, expect, vi } from "vitest";
import { abs, gt, v } from "../index.ts";
import { number } from "../constraint.ts";
import { assertImplies, phiSuppliesConstraint } from "../postcondition.ts";
import { checkReturnConstraint } from "../check-return.ts";
import {
  assumeConsumed,
  resetAssumeConsumed,
} from "../assume-ledger.ts";
import { issuesOf } from "./nudo-constraints.ts";

// 证「生产接线是活的」：把证明通道的入口打桩（转发真实实现，行为不变），
// 观察生产路径（checkSource → checkReturnConstraint → assertImplies）是否
// 真的把**返回点的 Φ**交到了证明通道。
vi.mock("../postcondition.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../postcondition.ts")>();
  return { ...actual, assertImplies: vi.fn(actual.assertImplies) };
});

/** 返回项：number，term = y（无 pred ⇒ 无值域证据） */
const retY = abs({ k: "prim", type: "number" }, v("y"), undefined, "exact");
/** Φ：约束**另一个项** x 的界事实（`if (x > 0) return y`） */
const phiOnX = gt(v("x"), { op: "lit", value: 0 });
/** Φ：约束**返回项本身** y 的界事实 */
const phiOnY = gt(v("y"), { op: "lit", value: 0 });
/** Φ：约束返回项本身 y，且**强于**契约 `y > 10` */
const phiOnYStrong = gt(v("y"), { op: "lit", value: 20 });

describe("Bug 1094（任务 1）：Φ 侧证据判据 = 同项 ∧ 蕴含", () => {
  it("Φ 同项且**蕴含**约束 ⇒ 义务可证（proved）", () => {
    const r = assertImplies(retY, number().gt(10), { phi: phiOnYStrong });
    expect(r.status).toBe("proved");
  });

  it("Φ 同项但**不足以**蕴含约束 ⇒ 仍『证不出』（unprovable），不是『确定违约』", () => {
    // 改前（Bug 1080 口径）：同项界原子即算带界证据 ⇒ 蕴含失败 ⇒
    // `disproved`（error）——而 Φ = `y > 0` 与契约 `y > 10` 只能推出
    // 「证不出」（返回值可能是 20）⇒ **假红**。
    const r = assertImplies(retY, number().gt(10), { phi: phiOnY });
    expect(r.status).toBe("unprovable");
  });

  it("Φ 约束的是**无关项** ⇒ 『证不出』（unprovable）", () => {
    const r = assertImplies(retY, number().gt(10), { phi: phiOnX });
    expect(r.status).toBe("unprovable");
  });

  it("不传 Φ（pTrue）⇒ 行为与改前完全一致（『证不出』）", () => {
    expect(assertImplies(retY, number().gt(10)).status).toBe("unprovable");
    // pTrue 显式传入与不传等价
    expect(assertImplies(retY, number().gt(10), { phi: { op: "true" } }).status).toBe(
      "unprovable",
    );
  });

  it("Φ 侧判据导出面：phiSuppliesConstraint（蕴含 + 同项）", () => {
    expect(phiSuppliesConstraint(phiOnYStrong, number().gt(10), retY)).toBe(true);
    // 同项但不足 ⇒ 不算证据
    expect(phiSuppliesConstraint(phiOnY, number().gt(10), retY)).toBe(false);
    // 无关项 ⇒ 不算证据
    expect(phiSuppliesConstraint(phiOnX, number().gt(10), retY)).toBe(false);
    // 无 Φ ⇒ 不算证据
    expect(phiSuppliesConstraint(undefined, number().gt(10), retY)).toBe(false);
  });

  it("假红不变式：Φ 同项但不足的若干组合 ⇒ 永不『确定违约』（disproved）", () => {
    const combos: Array<[ReturnType<typeof gt>, ReturnType<typeof number>]> = [];
    for (const bound of [1, 5, 10, 100]) {
      for (const contractBound of [1, 5, 10, 100]) {
        combos.push([
          gt(v("y"), { op: "lit", value: bound }),
          number().gt(contractBound),
        ]);
      }
    }
    for (const [phi, constraint] of combos) {
      const r = assertImplies(retY, constraint, { phi });
      expect(r.status).not.toBe("disproved");
    }
  });

  it("假红不变式：生产入口同口径（checkReturnConstraint）⇒ 零 error 级 issue", () => {
    for (const bound of [1, 5, 10, 100]) {
      const issues = checkReturnConstraint("f", "positive", number().gt(10), retY, {
        phi: gt(v("y"), { op: "lit", value: bound }),
      });
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });

  it("不变式（性质）：Φ 只能把『证不出』变『已证明』，绝不新增『确定违约』", () => {
    // 遍历（返回项 × 契约 × Φ）三元组，逐对比较「不传 Φ」与「传 Φ」的判据：
    // - 传 Φ 不得出现「不传 Φ 时不是 disproved、传 Φ 后却是 disproved」；
    // - 传 Φ 的判据要么与不传相同，要么升级为 proved。
    const rets = [
      { name: "no-pred", ret: retY },
      {
        name: "pred-y>0",
        ret: abs(
          { k: "prim", type: "number" },
          v("y"),
          gt(v("y"), { op: "lit", value: 0 }),
          "exact",
        ),
      },
    ];
    const phis: Array<[string, ReturnType<typeof gt> | { op: "true" }]> = [
      ["pTrue", { op: "true" }],
      ["phi-on-x", phiOnX],
      ["phi-on-y", phiOnY],
      ["phi-on-y-strong", phiOnYStrong],
    ];
    for (const { name, ret } of rets) {
      for (const constraint of [number().gt(1), number().gt(5), number().gt(10)]) {
        const base = assertImplies(ret, constraint).status;
        for (const [pname, phi] of phis) {
          const withPhi = assertImplies(ret, constraint, { phi }).status;
          if (base !== "disproved") {
            expect(
              withPhi,
              `${name} / ${pname}: Φ 不得制造确定违约`,
            ).not.toBe("disproved");
          }
          expect(
            withPhi === base || withPhi === "proved",
            `${name} / ${pname}: Φ 只能把 unprovable 变 proved`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("Bug 1094（任务 2）：Φ 归因——公理不得被静默消费", () => {
  it("Φ 真的被依赖 ⇒ 前提记进账本 ⇒ 报 nudo:assume-relied", () => {
    resetAssumeConsumed();
    // Φ = `y > 20`（同项且蕴含 `y > 10`）⇒ 去掉 Φ 证不出 ⇒ 本次证明
    // 依赖这条公理 ⇒ 记账 + 归因可见。
    const premise = gt(v("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retY,
      {
        phi: premise,
        phiPremises: [premise],
        assumeDisplay: ["y >= 20"],
      },
    );
    expect(assumeConsumed()).toContain(premise);
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(1);
    expect(issues[0]!.message).toContain("y >= 20");
  });

  it("Φ 没被依赖（去掉 Φ 也能证）⇒ 不记账 ⇒ 不报 assume-relied", () => {
    resetAssumeConsumed();
    // ret.pred 自身已蕴含契约 ⇒ 证明不依赖 Φ ⇒ 公理未被消费 ⇒ 不归因。
    const retYWithPred = abs(
      { k: "prim", type: "number" },
      v("y"),
      gt(v("y"), { op: "lit", value: 20 }),
      "exact",
    );
    const premise = gt(v("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYWithPred,
      {
        phi: premise,
        phiPremises: [premise],
        assumeDisplay: ["y >= 20"],
      },
    );
    expect(assumeConsumed()).not.toContain(premise);
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
  });
});

describe("Bug 1094（任务 2）：生产接线端到端（@nudo:assume ⇒ 返回点 Φ）", () => {
  it("生产接线：@nudo:assume + 返回契约 ⇒ 项身份能对上（前提项 = 返回项）", () => {
    // 实测口径：`@nudo:contract d num` 时入口形参锚在**真实名** `d`
    //（constraintToEntryAbs）⇒ 返回项 term = `d` ⇒ 与前提项 `d` 同项。
    const src = `
/**
 * @nudo:assume d <= max
 * @nudo:contract d num
 * @nudo:contract max num
 */
export function f(d, max) {
  return d;
}
`;
    const r = issuesOf(src, "/t/phi-wiring.js");
    // 无 assume-invalid / 无 error ⇒ 引理被接受（前提 Φ 生效的前提条件）
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    // 返回项的签名显示为 number（形参契约带进来的类型面）
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig?.abs.term).toEqual(v("d"));
  });

  it("生产接线：@nudo:assume 的前提 Φ 不蕴含字面界契约 ⇒ 保持『证不出』+ 零 assume-relied", () => {
    // 实测结论（生产面，非猜测）：`@nudo:assume` 的文法是「<名> <= <名>」⇒
    // 前提恒为**变量对变量**的关系（`d <= max`）⇒ 蕴含判定（区间/线性上下文）
    // 对「变量 ≤ 变量」推不出任何**字面界**（`d <= 10`）——上下文只提取
    // **数值**界，变量界不参与传递（实测：把 `max` 的契约事实 `max <= 100`
    // 并进 Φ 也仍然证不出 `d <= 100`）⇒ Φ 侧对字面界契约**证不出** ⇒
    // 义务保持 `unprovable`（warning），且**不**消费公理（零 assume-relied）。
    //
    // 另：形参契约本身的事实由引擎直接带进返回值域（实测：`@nudo:contract d
    // max100` ⇒ 返回值 pred = `le(d, 100)` ⇒ 同契约**无需** Φ 即可证）——
    // 所以 Φ 的边际价值只落在「引擎推不出、但用户公理能给出」的界上。
    const src = `
/**
 * @nudo:assume d <= max
 * @nudo:contract d num
 * @nudo:contract max num
 * @nudo:contract return positive
 */
export function f(d, max) {
  return d;
}
`;
    const r = issuesOf(src, "/t/phi-wiring.js");
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return")).toHaveLength(1);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:assume-relied")).toEqual([]);
  });

  it("生产接线：无 @nudo:assume ⇒ 行为与改前一致（零 issue 变化面）", () => {
    const src = `
/**
 * @nudo:contract d num
 * @nudo:contract max num
 * @nudo:contract return positive
 */
export function f(d, max) {
  return d;
}
`;
    const r = issuesOf(src, "/t/phi-wiring.js");
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return")).toHaveLength(1);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("生产接线是活的：@nudo:assume 的前提 Φ 真的交到了证明通道（opts.phi 非空）", () => {
    const spy = vi.mocked(assertImplies);
    spy.mockClear();
    // 源文本/文件名取**独立**的一份（checkSource 有整文件 memo：同源二次调用
    // 直接命中缓存 ⇒ 证明通道不再跑 ⇒ 观测不到 Φ）。
    const src = `
/**
 * @nudo:assume liveProbe <= liveMax
 * @nudo:contract liveProbe num
 * @nudo:contract liveMax num
 * @nudo:contract return positive
 */
export function liveProbeFn(liveProbe, liveMax) {
  return liveProbe;
}
`;
    issuesOf(src, "/t/phi-wiring-live.js");
    // 生产路径（check.ts → checkReturnConstraint → assertImplies）传入了 Φ
    const withPhi = spy.mock.calls.filter((c) => c[2]?.phi !== undefined);
    expect(withPhi.length).toBeGreaterThan(0);
    // Φ 的项 = 真实形参名（与返回项同项判定能对上）
    const phi = withPhi[0]![2]!.phi!;
    expect(JSON.stringify(phi)).toContain('"id":"liveProbe"');
  });

  it("生产接线：无 @nudo:assume ⇒ 证明通道拿到的仍是 pTrue（零行为变化）", () => {
    const spy = vi.mocked(assertImplies);
    spy.mockClear();
    const src = `
/**
 * @nudo:contract noPhi num
 * @nudo:contract noPhiMax num
 * @nudo:contract return positive
 */
export function noPhiFn(noPhi, noPhiMax) {
  return noPhi;
}
`;
    issuesOf(src, "/t/phi-wiring-none.js");
    const phis = spy.mock.calls.map((c) => c[2]?.phi);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(phis.every((p) => p === undefined)).toBe(true);
  });
});
