/**
 * **字面量同一性的口径分工钉**（族 11 / S6 任务⑤）——把三个面**分别**钉死，
 * 并写清**为什么它们不该被「统一」**。
 *
 * ── 三个面，三个问题，三个答案 ─────────────────────────────────────────
 *
 * | 面 | 问的问题 | 同一性 | 由谁钉死 |
 * |---|---|---|---|
 * | ① **赋值 / 期望面**（`leq.ts` 的 `leqAbs`） | 「实现给出的值**是不是同一个值**？」 | **SameValue**（`Object.is`） | Bug 398 钉（`core-bug-398-lit-samevalue.test.ts`） |
 * | ② **契约 / 类型执法面**（`scan/literal-preds.ts` + `scan/domain-membership.ts`） | 「这个值**是不是落在这个契约的类型域内**？」 | **SameValueZero**（`===` + NaN 特例） | Bug 915 钉（`core-bug-915-literal-identity.test.ts`） |
 * | ③ **项身份**（`term.ts` 的 `termEquals`） | 「这两个**项**是不是同一个项？」（不是精确期望） | **`===` + NaN**（= ②） | 本钉 |
 *
 * ①与②**故意不同**：`-0` 与 `0` 在 JS 里 `===` 为 **true** ⇒ 在**类型域**上
 * `-0` **就是** `0`（契约面放行）；但在**值级断言**上 `-0` 与 `0` 是**两个
 * 不同的值**（`Object.is(0, -0) === false`）⇒ 精确期望不能被静默放宽
 * （否则 `@nudo:case` 期望 -0、实现给 0 会**假绿**通过）。
 *
 * ⚠ **不要**因为「看着不一致」就把 ② 改成 `Object.is`：
 *   - 那会让 `-0` 在**契约面**报红（`lit(0)` 的契约收到 `-0` 变成违例）⇒
 *     与 Bug 398 的期望面语义**混淆**，且与 Bug 915 的要求（标量位与字段位
 *     **同一个裁决**）直接冲突；
 * ⚠ **也不要**改 ③ 的 `termEquals`：那是**项身份**（结构 + NaN 特例），不是
 * 精确期望；把它改成 SameValue 会让 `lit(-0)` 与 `lit(0)` 的项不再相等 ⇒
 * 波及项层面的折叠 / 缓存键。
 *
 * 本钉的职责：**让任何「统一口径」的改动在这里变红**，并把理由写在钉上。
 */
import { describe, it, expect } from "vitest";
import { leqAbs } from "../leq.ts";
import { abs, litValue } from "../abs.ts";
import { lit, termEquals, v, type Term } from "../term.ts";
import { litC } from "../constraint.ts";
import { literalMeetsConstraint } from "../domain-membership.ts";
import { judgeLiteralPred } from "../scan/literal-preds.ts";
import { checkSource, pTrue, resetCheckSourceMemo } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";
import type { Pred } from "../pred.ts";

/** 数字字面量 Abs（term 保留 -0 的符号） */
function numLitAbs(value: number) {
  return abs({ k: "prim", type: "number" }, lit(value), undefined, "exact");
}

/** eq(x, lit v) 谓词（契约面的 eq 原子形态） */
function eqPred(value: number): Pred {
  return { op: "eq", a: v("x"), b: lit(value) as Term };
}

describe("字面量同一性的口径分工（① 赋值面 SameValue / ② 契约面 SameValueZero / ③ 项身份 === + NaN）", () => {
  it("① 赋值面（leqAbs）：lit(-0) ⊭ lit(0)（SameValue —— 精确期望不被静默放宽）", () => {
    expect(leqAbs(numLitAbs(-0), numLitAbs(0)).ok).toBe(false);
    expect(leqAbs(numLitAbs(0), numLitAbs(-0)).ok).toBe(false);
  });

  it("① 赋值面（leqAbs）：NaN ≡ NaN（SameValue 覆盖 NaN）", () => {
    expect(leqAbs(numLitAbs(NaN), numLitAbs(NaN)).ok).toBe(true);
  });

  it("② 契约面（域隶属）：lit(0) 接受 -0（SameValueZero —— -0 就是 0）", () => {
    expect(literalMeetsConstraint(-0, litC(0))).toBe(true);
    expect(literalMeetsConstraint(0, litC(-0))).toBe(true);
  });

  it("② 契约面：真正不同的字面量仍不满足（不放宽过头）", () => {
    expect(literalMeetsConstraint(1, litC(0))).toBe(false);
    expect(literalMeetsConstraint(-1, litC(0))).toBe(false);
  });

  it("② 契约面：NaN 特例（lit(NaN) 接受 NaN）", () => {
    expect(literalMeetsConstraint(NaN, litC(NaN))).toBe(true);
    expect(literalMeetsConstraint(0, litC(NaN))).toBe(false);
  });

  it("② 契约面：标量实参位与字段位对同一份 lit(0) 契约**同一个裁决**（-0 都放行）", () => {
    resetCheckSourceMemo();
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, fn, any } from "@nudojs/core";
export const fldLit = fn({ o: shape({ v: lit(0) }) }, any());`,
    });
    const src = `
export function fldLit(o) { return o; }
fldLit({ v: -0 });
`;
    const r = checkSource("/t/lib.js", src, pTrue, { loadModule, fromFile: "/t/lib.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("② 契约面：标量实参位对 lit(0) 契约收到 -0 也放行（与字段位同裁决）", () => {
    resetCheckSourceMemo();
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, fn, any } from "@nudojs/core";
export const scLit = fn({ x: lit(0) }, any());`,
    });
    const src = `
export function scLit(x) { return x; }
scLit(-0);
`;
    const r = checkSource("/t/lib.js", src, pTrue, { loadModule, fromFile: "/t/lib.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("③ 项身份（termEquals）：-0 与 0 是**同一个项**（=== 口径，不改成 SameValue）", () => {
    expect(termEquals(lit(-0), lit(0))).toBe(true);
    expect(termEquals(lit(0), lit(-0))).toBe(true);
  });

  it("③ 项身份（termEquals）：NaN 与自身同项（NaN 特例）", () => {
    expect(termEquals(lit(NaN), lit(NaN))).toBe(true);
  });

  it("③ 项身份（termEquals）：不同项仍不同（1 ≠ 2）", () => {
    expect(termEquals(lit(1), lit(2))).toBe(false);
  });

  it("② 契约面（谓词判定层）：字面量同一性 = `===` + NaN 特例（-0 与 0 同值、NaN 与自身同值）", () => {
    // `judgeLiteralPred` 是契约面（`scan/literal-preds.ts`）的判定入口 ⇒
    // 直接断言它，避免「只能从集成路径间接看到」的漂移。
    expect(judgeLiteralPred(eqPred(0), numLitAbs(-0), undefined)).toBe(true); // -0 === 0
    expect(judgeLiteralPred(eqPred(0), numLitAbs(0), undefined)).toBe(true);
    expect(judgeLiteralPred(eqPred(NaN), numLitAbs(NaN), undefined)).toBe(true); // NaN 特例
    expect(judgeLiteralPred(eqPred(1), numLitAbs(0), undefined)).toBe(false);
  });

  it("分工仍然成立：同一个 -0 在①判不同、在②③判相同（两套口径并存，不是 bug）", () => {
    // ① 值级断言：不是同一个值 ⇒ 精确期望不被放宽
    expect(leqAbs(numLitAbs(-0), numLitAbs(0)).ok).toBe(false);
    // ② 类型域：-0 落在 lit(0) 的域内
    expect(literalMeetsConstraint(-0, litC(0))).toBe(true);
    // ③ 项身份：同一个项
    expect(termEquals(lit(-0), lit(0))).toBe(true);
  });

  it("分工仍然成立：NaN 在①（SameValue）与②（NaN 特例）都判同值", () => {
    expect(leqAbs(numLitAbs(NaN), numLitAbs(NaN)).ok).toBe(true);
    expect(literalMeetsConstraint(NaN, litC(NaN))).toBe(true);
    const lv = litValue(numLitAbs(NaN));
    expect(lv.ok).toBe(true);
  });
});
