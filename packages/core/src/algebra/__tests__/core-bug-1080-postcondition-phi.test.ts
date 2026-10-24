/**
 * Bug 1080 —— 后置证明通道的 **Φ 侧（路径前提）**此前**从未被接入**：
 * `assertImplies` 的 `opts.phi` 恒为 `pTrue`（唯一生产调用方
 * `check-return.ts` 不传 opts）⇒ 证据面「Φ ∧ ret.pred」退化成 `ret.pred`
 * ——本分支注释声称的「关系事实落在 Φ 里，两边都要看」这一半从不生效。
 *
 * 而按注释语义直接接线又**不健全**：Φ 里的界原子可能约束的是**另一个项**
 * （`if (x > 0) return y` 的 `x > 0` 与 y 无关）⇒ `implies` 失败被判
 * `disproved`（error），而真实结论是「证不出」⇒ **用无关证据制造假红**。
 *
 * 修法（`packages/core/src/algebra/postcondition.ts`）：Φ 侧只按**同项**
 * 口径计入证据面（界原子的左侧与被约束项 `termEquals`；`length(item)`
 * 形态算同一项的界）；`check-return.ts` 的审计上下文开 `phi` 口子
 * （返回点的路径前提）。
 */
import { describe, it, expect } from "vitest";
import { abs, gt, v } from "../index.ts";
import { number } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";
import { checkReturnConstraint } from "../check-return.ts";

/** 返回项：number，term = y（无 pred ⇒ 无值域证据） */
const retY = abs({ k: "prim", type: "number" }, v("y"), undefined, "exact");
/** 返回项：number，term = y，带值域证据 `y > 0` */
const retYWithPred = abs(
  { k: "prim", type: "number" },
  v("y"),
  gt(v("y"), { op: "lit", value: 0 }),
  "exact",
);
/** Φ：约束**另一个项** x 的界事实（`if (x > 0) return y`） */
const phiOnX = gt(v("x"), { op: "lit", value: 0 });
/** Φ：约束**返回项本身** y 的界事实 */
const phiOnY = gt(v("y"), { op: "lit", value: 0 });
/** 契约：number().gt(0) */
const positive = number().gt(0);

describe("Bug 1080: Φ 侧只按「同项」口径计入证据面", () => {
  it("Φ 约束的是另一个项 ⇒ 判『证不出』（unprovable），不得判『确定违约』（disproved）", () => {
    // 改前：Φ 的界原子（x > 0）被当成 y 的值域证据 ⇒ 蕴含失败 ⇒ error（假红）
    const r = assertImplies(retY, positive, { phi: phiOnX });
    expect(r.status).toBe("unprovable");
  });

  it("Φ 约束的是另一个项 ⇒ 不得产出 error 级 issue（生产入口同口径）", () => {
    const issues = checkReturnConstraint("f", "positive", positive, retY, {
      phi: phiOnX,
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.filter((i) => i.code === "nudo:unproven-return")).toHaveLength(1);
  });

  it("Φ 约束的是返回项本身 ⇒ 义务可证（proved）——Φ 侧真的生效", () => {
    const r = assertImplies(retY, positive, { phi: phiOnY });
    expect(r.status).toBe("proved");
  });

  it("Φ 约束的是返回项本身 ⇒ 生产入口无 issue（既不 error 也不 warning）", () => {
    const issues = checkReturnConstraint("f", "positive", positive, retY, {
      phi: phiOnY,
    });
    expect(issues).toEqual([]);
  });

  it("不传 Φ ⇒ 仍是『证不出』（证据面只有 ret.pred）", () => {
    const r = assertImplies(retY, positive);
    expect(r.status).toBe("unprovable");
  });

  it("无关 Φ 不得压掉已由 ret.pred 证出的义务（值域事实优先）", () => {
    const r = assertImplies(retYWithPred, positive, { phi: phiOnX });
    expect(r.status).toBe("proved");
  });

  it("同项 Φ 与 ret.pred 同口径：界弱于契约 ⇒ 判确定违约（fail-closed 既有约定）", () => {
    // Φ 的 `y > 0` 与 ret.pred 的 `y > 0` 是同一类证据（返回项的界）⇒
    // 同口径：契约 `y > 5` 蕴含失败 ⇒ 确定违约（与守卫弱于契约的既有
    // 口径一致，见 check-return-constraint-guard.test.ts）。
    const r = assertImplies(retY, number().gt(5), { phi: phiOnY });
    expect(r.status).toBe("disproved");
  });
});
