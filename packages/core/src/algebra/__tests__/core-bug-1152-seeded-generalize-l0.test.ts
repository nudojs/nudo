/**
 * Bug 1152 —— generalize 的 L0（进程内 PolyFn memo）键**不含种子动态域**
 * （`@nudo:assume` 引理 / `@nudo:invariant` 循环界）⇒ 有种子求值命中无种子
 * 缓存（或反之）造成双向错误：
 *
 * - **正向漏报**：check 对带引理的函数求值时以 `withAssumePremises` 种子；
 *   若 L0 命中（第二次 check / 只改了无关兄弟函数 / 先跑过一次无种子
 *   generalize）⇒ body 不再重新求值 ⇒ 引理消费账本（`assume-ledger.ts`）
 *   没被填 ⇒ `nudo:assume-relied` 丢失（用户以为引理被用上，审计面蒸发）。
 * - **反向泄漏**：种子求值把「折了界的 PolyFn」写进 L0 ⇒ 之后无种子
 *   `generalizeFromAst`（LSP/CLI 签名面）读到它 ⇒ 签名里出现只有引理才能
 *   证出的界（`proved via @nudo:assume` 的精度泄漏到无公理上下文）。
 *
 * 修法：种子的非平凡窗口内**绕过 L0**（既不读也不写；键仍只装静态身份）。
 * 本套件钉住：(a) 冷跑 relied=1；(b) 清 check memo 后仍 1；(c) 只改兄弟
 * 函数后仍 1；(d) 无种子 generalize 先行后 check 仍 1 且不误报 unproven；
 * (e) check 之后无种子 generalize 与冷跑逐字一致（无泄漏）；(f) 负控制：
 * 无引理 ⇒ 无 relied、返回义务诚实未证；(g) `@nudo:invariant` 同型
 * （种子后无种子不得泄漏、无种子先行的 check 不得丢 relied）。
 *
 * ⚠ 形参契约（nonNeg / atLeast1）与返回契约（unit）缺一不可：没有形参
 * 契约时连冷跑都是 unproven-return；没有返回契约则引理不参与证明。
 * 函数必须**非导出**：导出入口在 L2 面重新求值会顺手回填账本，掩盖 L0 缺陷。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, generalizeFromAst, parseSource, formatAbs } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
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

const SIDE = `import { number } from "@nudojs/core";
export const unit = number().ge(0).le(1);
export const nonNeg = number().ge(0);
export const atLeast1 = number().ge(1);
`;

/** 引理折叠 `1 - d/max` 的相关性下界（div 消费点），证得 unit 契约 */
const srcWithLemma = (K: number) => `/// @nudo:import { unit, nonNeg, atLeast1 } from "./std.nudo.js"
/**
 * @nudo:assume d <= max
 * @nudo:contract d nonNeg
 * @nudo:contract max atLeast1
 * @nudo:contract return unit
 */
function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
export function other(x) { return x + ${K}; }
`;

/** 同源去掉引理行（负控制：善意的 unproven-return 必须留下） */
const srcNoLemma = (K: number) => srcWithLemma(K).replace(" * @nudo:assume d <= max\n", "");

/** 无种子 generalize（LSP/签名面）——与 check 同一 loader 身份才能命中同一 L0 */
const unseeded = (fn: string, src: string, o: ReturnType<typeof sidecarOpts>) =>
  generalizeFromAst(fn, src, { file: parseSource(src), refine: o });

const reliedCount = (r: { issues: { code: string }[] }) =>
  r.issues.filter((i) => i.code === "nudo:assume-relied").length;
const issueSet = (r: { issues: { code: string; fn?: string }[] }) =>
  r.issues.map((i) => `${i.code}:${i.fn ?? ""}`).sort();

describe("Bug 1152 —— 种子（assume）求值不得命中 L0", () => {
  it("(a) 冷跑：引理被消费 ⇒ nudo:assume-relied = 1，返回契约证得", () => {
    const f = "/t/bug1152-a.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const r = checkSource(f, srcWithLemma(1), pTrue, { ...o, entryThrows: "off" as const });
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied")!;
    expect(relied.fn).toBe("sim");
    expect(relied.message).toContain("proved via @nudo:assume d <= max");
  });

  it("(b) 清 check memo（L0 仍在）后重跑 ⇒ relied 仍为 1（不得跳过账本回填）", () => {
    const f = "/t/bug1152-b.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o, entryThrows: "off" as const };
    expect(reliedCount(checkSource(f, srcWithLemma(1), pTrue, c))).toBe(1);
    resetCheckSourceMemo();
    const r = checkSource(f, srcWithLemma(1), pTrue, c);
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  });

  it("(c) 只改无关兄弟函数（per-fn 指纹不变 ⇒ 仅 L0 可能命中）⇒ relied 仍为 1", () => {
    const f = "/t/bug1152-c.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o, entryThrows: "off" as const };
    expect(reliedCount(checkSource(f, srcWithLemma(1), pTrue, c))).toBe(1);
    const r = checkSource(f, srcWithLemma(2), pTrue, c);
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  });

  it("(d) 无种子 generalize 先行（L0 里是无引理 PolyFn）⇒ 随后 check 仍 relied=1，且不误报 unproven", () => {
    const f = "/t/bug1152-d.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const src = srcWithLemma(1);
    const pre = unseeded("sim", src, o);
    expect(pre).toBeDefined();
    const r = checkSource(f, src, pTrue, { ...o, entryThrows: "off" as const });
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
  });

  it("(e) check 之后无种子 generalize 与冷跑逐字一致（折后界不得经 L0 泄漏）", () => {
    const f = "/t/bug1152-e.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const src = srcWithLemma(1);
    const coldFmt = formatAbs(unseeded("sim", src, o)!.symbolic);
    // 冷跑（无种子）不含引理折出的界
    expect(coldFmt).not.toContain("≥ 0");
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const o2 = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o2, entryThrows: "off" as const };
    expect(reliedCount(checkSource(f, src, pTrue, c))).toBe(1);
    const afterFmt = formatAbs(unseeded("sim", src, o2)!.symbolic);
    expect(afterFmt).toBe(coldFmt);
  });

  it("(f) 负控制：去掉引理行 ⇒ 无 relied，返回义务诚实未证（与冷跑同一 issue 面）", () => {
    const f = "/t/bug1152-f.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o, entryThrows: "off" as const };
    const cold = checkSource(f, srcNoLemma(1), pTrue, c);
    expect(reliedCount(cold)).toBe(0);
    expect(cold.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(true);
    resetCheckSourceMemo();
    const again = checkSource(f, srcNoLemma(1), pTrue, c);
    expect(issueSet(again)).toEqual(issueSet(cold));
  });
});

// ---------------------------------------------------------------------------
// (g) @nudo:invariant 同型：种子 / 无种子双向都不得借道 L0
// ---------------------------------------------------------------------------

const scalarSrc = `
/**
 * @nudo:invariant last >= 1
 */
export function lastLoop(n) {
  let last = 0;
  for (let j = 1; j <= n; j++) last = j;
  return last;
}
`;
const SCALAR_SIDE = `export const lastLoop = fn({ n: number() }, number().ge(1));`;

const invariantRelied = (r: { issues: { code: string }[] }) =>
  r.issues.filter((i) => i.code === "nudo:invariant-relied").length;

describe("Bug 1152 —— 种子（invariant）求值不得命中 L0", () => {
  it("(g1) 无种子 generalize 先行 ⇒ 随后 check 仍 invariant-relied=1 且未证不误报", () => {
    const f = "/t/bug1152-g1.js";
    const o = sidecarOpts("nudo", SCALAR_SIDE, f);
    expect(unseeded("lastLoop", scalarSrc, o)).toBeDefined();
    const r = checkSource(f, scalarSrc, pTrue, { ...o, entryThrows: "off" as const });
    expect(invariantRelied(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  });

  it("(g2) check 之后无种子 generalize 与冷跑逐字一致（invariant 折后界不得泄漏）", () => {
    const f = "/t/bug1152-g2.js";
    const o = sidecarOpts("nudo", SCALAR_SIDE, f);
    const coldFmt = formatAbs(unseeded("lastLoop", scalarSrc, o)!.symbolic);
    expect(coldFmt).not.toContain("inv#");
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const o2 = sidecarOpts("nudo", SCALAR_SIDE, f);
    expect(invariantRelied(checkSource(f, scalarSrc, pTrue, { ...o2, entryThrows: "off" as const }))).toBe(1);
    const afterFmt = formatAbs(unseeded("lastLoop", scalarSrc, o2)!.symbolic);
    expect(afterFmt).toBe(coldFmt);
  });
});
