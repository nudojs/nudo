/**
 * BUG-245：并集（sum）作为**源**时，结构判定通过后不得再跑聚合层 `leqPred`。
 *
 * `leqShape` 的 sum 源分支已逐成员跑过 `leqWithPred(m, tgt, …)`（含每个成员的
 * `leqPred`）⇒ `leqWithPred` 尾部再跑一次聚合 `leqPred` 是重复的。而 sum 聚合体
 * **不携带**顶层 pred（`makeSum` / parser `constraintToCaseArgAbs` 都不写 pred）
 * ⇒ 聚合判定走「源无 pred」分支（`implies(phi, tp)`）⇒ 目标只要带谓词就恒假
 * ⇒ `union(number().gt(0), number().gt(5)) ⊭ number().gt(0)` 假红，且两侧渲染串
 * 完全相同（诊断不可读）。
 *
 * TS 的并集源规则正是「每个成员可赋给目标即可」⇒ 聚合层不得再加一条独立判据。
 * 这里按 parser `constraintToCaseArgAbs` 的同口径构造 case 实参 Abs（union →
 * sum，无顶层 pred），逐条钉住正例 / 反例，防止把「跳过聚合判定」放宽成
 * 「并集全绿」。
 */
import { describe, it, expect } from "vitest";
import { leqAbs } from "../leq.ts";
import {
  constraintToEntryAbs,
  derefConstraint,
  number,
  string,
  union,
  type NudoConstraint,
} from "../constraint.ts";
import { abs, type Abs } from "../abs.ts";
import { lit, v } from "../term.ts";
import { lt } from "../pred.ts";

/** 约束（builder 或已解引用）→ 入口 Abs（锚在 `__arg` 上的 var 项）。 */
function entry(c: NudoConstraint): Abs {
  return constraintToEntryAbs(c, "__arg");
}

/**
 * 与 parser `constraintToCaseArgAbs` 同口径：union 成员递归再拼 sum，
 * **不带顶层 pred**（`{ shape: { k: "sum", members }, conf: "path" }`）。
 */
function caseArg(c: NudoConstraint): Abs {
  if (c.members && c.members.length > 0) {
    const parts = c.members.map(caseArg);
    if (parts.length === 1) return parts[0]!;
    return { shape: { k: "sum", members: parts }, conf: "path" };
  }
  return entry(c);
}

const C = (b: unknown): NudoConstraint => derefConstraint(b as never);

describe("BUG-245 并集源不再重复跑聚合 leqPred", () => {
  it("union(number().gt(0), number().gt(5)) ≤ number().gt(0)", () => {
    // 复现：`@nudo:case "B" (union(number().gt(0), number().gt(5))) => number().gt(0)`
    const actual = caseArg(C(union(number().gt(0), number().gt(5))));
    const expected = caseArg(C(number().gt(0)));
    expect(leqAbs(actual, expected).ok).toBe(true);
  });

  it("三成员并集同样按成员判定（不因成员数而回退）", () => {
    const actual = caseArg(
      C(union(number().gt(0), number().gt(5), number().gt(9))),
    );
    const expected = caseArg(C(number().gt(0)));
    expect(leqAbs(actual, expected).ok).toBe(true);
  });

  it("单个成员的 sum 与裸成员同判", () => {
    const single = caseArg(C(union(number().gt(0))));
    expect(leqAbs(single, caseArg(C(number().gt(0)))).ok).toBe(true);
  });

  it("反例：并集里含类型不符成员仍判红", () => {
    const actual = caseArg(C(union(number().gt(0), string())));
    const r = leqAbs(actual, caseArg(C(number().gt(0))));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sum member/);
  });

  it("反例：并集里含谓词不符成员仍判红（x<0 ⊄ x>0）", () => {
    const actual = caseArg(C(union(number().gt(0), number().lt(0))));
    const r = leqAbs(actual, caseArg(C(number().gt(0))));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sum member: pred/);
  });

  it("聚合体确实带顶层 pred 时仍参与判定（信息不丢）", () => {
    // `narrow.ts` 的 `{ ...a, shape: sum }` 会保留 a.pred ⇒ 此时不得跳过聚合判定。
    const members = [entry(C(number().gt(0))), entry(C(number().gt(5)))];
    const withTopPred = abs(
      { k: "sum", members },
      v("__arg"),
      lt(v("__arg"), lit(0)),
      "path",
    );
    expect(leqAbs(withTopPred, caseArg(C(number().gt(0)))).ok).toBe(false);
    // 对照：同成员、无顶层 pred ⇒ 放行（本 BUG 的修复点）
    expect(
      leqAbs(abs({ k: "sum", members }, undefined, undefined, "path"), caseArg(C(number().gt(0))))
        .ok,
    ).toBe(true);
  });

  it("目标侧并集语义不变：单成员 ≤ 并集", () => {
    expect(
      leqAbs(
        caseArg(C(number().gt(0))),
        caseArg(C(union(number().gt(0), number().gt(5)))),
      ).ok,
    ).toBe(true);
  });
});
