/**
 * Bug 342 —— `.int()` 是**数据标志**（不产 pred）⇒ 约束 → Abs 投影把整性
 * 整条蒸发 ⇒ zod / standard 两个产物面静默放行 `3.5`，而门禁（读**约束**）
 * 判红 ⇒ 跨产物面自相矛盾 + 假绿。
 *
 * 根因：约束 → Abs 的转换只搬 `preds`；`isInt` 是数据标志，没有对应的
 * pred ⇒ 投影层（zod / standard）只能照抄 pred 集合，整性在投影时蒸发。
 * 投影层其实**早就会认**整性——`projection.ts` 的 `isIntZeroModOne` 认
 * `eq(self % 1, 0)` 这套编码——但生产代码里**没有一处**产出它（解码器是
 * 悬空的生产死代码）。
 *
 * 修法：`constraintOnTermAbs` 在 int 标志上产出 `eq(self % 1, 0)`（与解码器
 * 同一套编码）⇒ Abs 面有承载位 ⇒ 投影层从 Abs 侧拿得到整性。
 */
import { describe, it, expect } from "vitest";
import {
  absToConstraint,
  constraintToEntryAbs,
  isIntFlag,
  number,
} from "../index.ts";

/** pred 树节点（只读本测试关心的字段） */
type IntPredNode = {
  op?: string;
  fn?: string;
  value?: unknown;
  a?: IntPredNode;
  b?: IntPredNode;
  args?: IntPredNode[];
};

/** pred 树里有没有 `eq(x % 1, 0)` 这条整性编码 */
function hasIntEncoding(pred: unknown): boolean {
  if (!pred || typeof pred !== "object") return false;
  const p = pred as IntPredNode;
  if (p.op === "eq") {
    const isModOne = (t: IntPredNode | undefined): boolean =>
      t?.op === "app" &&
      t.fn === "%" &&
      t.args?.length === 2 &&
      t.args[1]?.op === "lit" &&
      t.args[1]?.value === 1;
    const isZero = (t: IntPredNode | undefined): boolean => t?.op === "lit" && t.value === 0;
    if ((isModOne(p.a) && isZero(p.b)) || (isModOne(p.b) && isZero(p.a))) return true;
  }
  if (p.op === "and" && Array.isArray(p.args)) {
    return p.args.some((x) => hasIntEncoding(x));
  }
  return false;
}

describe("Bug 342 —— int 标志投影成 pred（约束 → Abs）", () => {
  it("number().int().gt(0) 的 entry Abs 带整性编码 eq(self % 1, 0)", () => {
    const a = constraintToEntryAbs(number().int().gt(0), "n");
    expect(hasIntEncoding(a.pred)).toBe(true);
  });

  it("裸 number().int() 也带整性编码（不依赖别的界）", () => {
    const a = constraintToEntryAbs(number().int(), "n");
    expect(hasIntEncoding(a.pred)).toBe(true);
  });

  it("投影层（absToConstraint）能把它解回 .int() 标志", () => {
    const a = constraintToEntryAbs(number().int().gt(0), "n");
    const c = absToConstraint(a);
    expect(c).toBeDefined();
    expect(isIntFlag(c!)).toBe(true);
  });

  it("无 int 标志时不产整性编码（负控制）", () => {
    const a = constraintToEntryAbs(number().gt(0), "n");
    expect(hasIntEncoding(a.pred)).toBe(false);
    const c = absToConstraint(a);
    expect(isIntFlag(c!)).toBe(false);
  });

  it("string() 不带 int 标志（int 只对数值域有意义）", () => {
    const a = constraintToEntryAbs({ prim: "string", preds: [] } as never, "s");
    expect(hasIntEncoding(a.pred)).toBe(false);
  });
});
