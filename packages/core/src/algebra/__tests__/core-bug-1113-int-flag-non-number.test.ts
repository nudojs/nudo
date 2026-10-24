/**
 * Bug 1113 —— `.int()` 对**非 number builder** 暴露 ⇒ 域面 / Abs 面**两个裁决**。
 *
 * 缺陷（口径分裂）：
 * - 域面（`domain-membership.ts` 的 `literalMeetsConstraint`）：int 只在
 *   `prim === "number"` 时执法 ⇒ `literalMeetsConstraint("abc", string().int())`
 *   **接受** "abc"。
 * - Abs / 投影面（`constraint.ts` 的 `constraintOnTermAbs`）：此前对**任何**带
 *   int 位的约束都生成 `eq(self % 1, 0)` ⇒
 *   `constraintToEntryAbs(string().int(), "s").pred` 带整数谓词 ⇒ 同一约束在
 *   产物面（zod / standard / guard）上会要求 `"abc" % 1 === 0` ⇒ 假红。
 *
 * 修法（**拒绝**路线）：`.int()` 只在数值链上成立 —— 与 `shift()` 同口径，
 * 非数值链 / 结构链上直接报错（构造期即失败，不再产出互相矛盾的契约）；
 * `constraintOnTermAbs` 的整性 pred 也只在 `prim === "number"` 时生成 ⇒
 * 域面与 Abs 面口径一致。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  array,
  boolean,
  constraintToEntryAbs,
  isIntFlag,
  lit,
  number,
  string,
  literalMeetsConstraint,
} from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
});

/** pred 树里有没有 `eq(x % 1, 0)` 这条整性编码 */
function hasIntEncoding(pred: unknown): boolean {
  if (!pred || typeof pred !== "object") return false;
  const p = pred as {
    op?: string;
    fn?: string;
    value?: unknown;
    a?: { op?: string; fn?: string; args?: unknown[] };
    b?: { op?: string; value?: unknown };
    args?: unknown[];
  };
  if (p.op === "eq") {
    const isModOne = (t: { op?: string; fn?: string; args?: unknown[] } | undefined): boolean =>
      t?.op === "app" && t.fn === "%" && Array.isArray(t.args) && t.args.length === 2;
    const isZero = (t: { op?: string; value?: unknown } | undefined): boolean =>
      t?.op === "lit" && t.value === 0;
    if ((isModOne(p.a as never) && isZero(p.b as never)) || (isModOne(p.b as never) && isZero(p.a as never)))
      return true;
  }
  if (p.op === "and" && Array.isArray(p.args)) return p.args.some((x) => hasIntEncoding(x));
  return false;
}

describe("Bug 1113 —— .int() 只在数值链上成立（域面 / Abs 面口径一致）", () => {
  it("string().int() 抛错（不再暴露到非数值 builder）", () => {
    expect(() => (string() as unknown as { int: () => unknown }).int()).toThrow(/int\(\)/);
  });

  it("boolean().int() 抛错", () => {
    expect(() => (boolean() as unknown as { int: () => unknown }).int()).toThrow(/int\(\)/);
  });

  it("lit('a') 根本不带 int 方法（非数值字面量链无法产出分裂约束）", () => {
    expect((lit("a") as unknown as { int?: () => unknown }).int).toBeUndefined();
  });

  it("number().int() 仍然可用（负控制）", () => {
    const c = number().int();
    expect(isIntFlag(c)).toBe(true);
  });

  it("域面 / Abs 面口径一致：非数值链上不存在 int 约束", () => {
    // 构造期即拒绝 ⇒ 不存在「域面接受、Abs 面带整数谓词」的分裂约束
    expect(() => (string() as unknown as { int: () => unknown }).int()).toThrow();
    // 数值链上两面一致：3.5 不满足 number().int()
    const c = number().int();
    expect(literalMeetsConstraint(3.5, c)).toBe(false);
    expect(literalMeetsConstraint(3, c)).toBe(true);
  });

  it("数值链的 Abs 面仍带整性编码（Bug 342 语义不回归）", () => {
    expect(hasIntEncoding(constraintToEntryAbs(number().int(), "n").pred)).toBe(true);
  });

  it("纯数据约束（非 number prim）不再产出整性 pred（两面一致）", () => {
    const raw = { __nudoConstraint: true, prim: "string", preds: [], int: true } as never;
    expect(hasIntEncoding(constraintToEntryAbs(raw, "s").pred)).toBe(false);
  });
});

/**
 * 同一约束面（构造器实参 / 界护栏）的其余**静默无效输入**（报告 §附带项，
 * 逐条确认后处理）：
 *
 * - `boolean().gt(1)` / `string().gt(1)` ⇒ 此前静默产出 `gt(self, 1)`
 *   ⇒ ① 域面 / Abs 面两个裁决；② 该约束**恒假** ⇒ 每个合法实参都被判违例
 *   = **假红** ⇒ **已修**（非数值链上直接报错，与 `shift()` 同口径）。
 * - `string().length(-3)` ⇒ 产出 `len(self) === -3` ⇒ **恒假** ⇒ 假红
 *   ⇒ **已修**（长度界必须非负；`length` 还必须是非负整数）。
 * - `array(1, 2)` ⇒ 第二个实参被**静默丢弃** ⇒ 用户的元素约束从未生效
 *   （契约被悄悄削弱 = 假绿）⇒ **已修**（多余实参直接报错）。
 * - `pick(shape({a}), ["b"])` ⇒ 不存在的 key **被忽略**（文档化的既有语义：
 *   「shape 子形状（不存在的 key 忽略）」）⇒ **保持现状**（改成报错会破坏
 *   已文档化的语义与既有侧车）。
 * - `omit(c, ["zzz"])` ⇒ 去掉一个不存在的 key 本就是 no-op ⇒ **保持现状**。
 * - `lit()` ⇒ 与 `lit(undefined)` **语法不可区分**（而 `lit(undefined)` 是合法
 *   契约）⇒ **保持现状**。
 */
describe("Bug 1113 附带 —— 约束构造器的无效输入不再被静默接受", () => {
  it("boolean().gt(1) 抛错（恒假契约 ⇒ 假红）", () => {
    expect(() => (boolean() as unknown as { gt: (n: number) => unknown }).gt(1)).toThrow(/gt\(\)/);
  });

  it("string().gt(1) 抛错（恒假契约 ⇒ 假红）", () => {
    expect(() => (string() as unknown as { gt: (n: number) => unknown }).gt(1)).toThrow(/gt\(\)/);
  });

  it("string().length(-3) 抛错（恒假契约 ⇒ 假红）", () => {
    expect(() => (string() as unknown as { length: (n: number) => unknown }).length(-3)).toThrow(
      /length\(\)/,
    );
  });

  it("负控制：既有的有限界护栏口径不变（length(2.5) 仍合法，Bug 336 钉住）", () => {
    expect(() => (string() as unknown as { length: (n: number) => unknown }).length(2.5)).not.toThrow();
  });

  it("array(1, 2) 抛错（多余实参不再被静默丢弃）", () => {
    expect(() => (array as unknown as (...a: unknown[]) => unknown)(1, 2)).toThrow(/array\(\)/);
  });

  it("负控制：合法用法仍然可用（number().gt(0) / string().min(1) / array(number())）", () => {
    expect(() => number().gt(0)).not.toThrow();
    expect(() => string().min(1)).not.toThrow();
    expect(() => string().max(20)).not.toThrow();
    expect(() => array(number())).not.toThrow();
  });
});
