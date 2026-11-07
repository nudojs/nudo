/**
 * Bug 649：抛错函数的 `@nudo:case` **声明期望恒通过**（假绿）。
 *
 * 根因（`packages/service/src/analyzer-orchestrate-uncached-cases.ts` 的
 * `caseExpectedSatisfied`）：实测 Abs 是 `never`（函数抛了 ⇒ 没有返回值），
 * 而 `never` 是类型格的**底元素**（`never ⊑ 任何类型` 恒真）⇒ 结构面判定
 * （`leqAbs`）必然通过 ⇒ 带 `=> expected` 的 case **恒判 ok** ⇒
 * `nudo test` 报「✓ 1 passed」，`nudo:case-expected` 零诊断。
 *
 * 修法：判定层加**前置条件**——实测是 `never` ⇒ **不得判 ok**。
 * 一处修覆盖三个面（service 侧 `nudo:case-expected` 发射点 /
 * `packages/nudojs/src/run-test.ts` 的报告面 / `packages/service/src/test-report.ts`）。
 *
 * ⚠ **展示层不变**：`comparableExpected` 在「不满足」时**原样**返回 expected
 * ⇒ 期望的展示形态（`number (> 0)` 这类谓词期望）**不许**跟着变形
 * （本钉同时钉住这一面）。
 *
 * 钉：
 * - 抛错 + 声明期望 ⇒ 报 `nudo:case-expected`（改前恒 0 条）；
 * - 抛错 + **谓词**期望 ⇒ 报，且诊断文案保留谓词展示形态（`number (> 0)`）；
 * - 负控制：不抛错 + 期望满足 ⇒ 0 条（口径不变）；
 * - 负控制：不抛错 + 期望不满足 ⇒ 1 条（口径不变）；
 * - 负控制：抛错 + **无**期望 ⇒ 0 条（unchecked 口径不变）；
 * - 消费侧单测：`caseExpectedSatisfied(never, expected)` ⇒ 不满足。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { numLit } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import {
  caseExpectedSatisfied,
  formatExpected,
} from "../analyzer-orchestrate-uncached-cases.ts";
import { neverAbs } from "../evaluator/call-record.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

type Diag = { code?: string; message?: string };

/** 跑一个 `@nudo:case` 文件，返回分析结果。 */
function analyzeSrc(src: string): {
  diagnostics: readonly Diag[];
  functions: readonly {
    name: string;
    cases: readonly { name: string; abs: { shape: { k: string } }; expected?: unknown }[];
  }[];
} {
  return withTmpProject("nudo-b649-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return analyzeFile(file, readFileSync(file, "utf-8"));
  });
}

/** `nudo:case-expected` 诊断条数（期望不满足）。 */
function caseExpectedCount(src: string): number {
  return analyzeSrc(src).diagnostics.filter((d) => d.code === "nudo:case-expected").length;
}

/** `nudo:case-expected` 诊断文案。 */
function caseExpectedMessage(src: string): string {
  const d = analyzeSrc(src).diagnostics.find((x) => x.code === "nudo:case-expected");
  return d?.message ?? "";
}

describe("Bug 649：实测 never（抛错）的 case 带声明期望 ⇒ 不得判 ok", () => {
  it("抛错 + 声明期望（=> 42）⇒ 报 nudo:case-expected（改前恒 0 条）", () => {
    const src = `/**
 * @nudo:case "t" (1) => 42
 */
export function f(x) { throw new Error("boom"); }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });

  it("抛错 + 声明期望 ⇒ 诊断文案如实报出「实测 never」", () => {
    const src = `/**
 * @nudo:case "t" (1) => 42
 */
export function f(x) { throw new Error("boom"); }
`;
    const msg = caseExpectedMessage(src);
    expect(msg).toContain("expected 42");
    expect(msg).toContain("got never");
  });

  it("展示层不变：抛错 + 谓词期望 ⇒ 期望展示形态仍是「number (> 0)」", () => {
    const src = `/**
 * @nudo:case "t" (1) => number().gt(0)
 */
export function f(x) { throw new Error("boom"); }
`;
    // 诊断文案（formatExpected 口径）保留谓词形态
    expect(caseExpectedMessage(src)).toContain("expected number (> 0)");
    // 台账里的 expected 形态（comparableExpected 在「不满足」时原样返回）
    const result = analyzeSrc(src);
    const fn = result.functions.find((f) => f.name === "f")!;
    const c = fn.cases.find((x) => x.name === "t")!;
    expect(c.abs.shape.k).toBe("never");
    expect(c.expected).toBeDefined();
    expect(formatExpected(c.expected as never)).toBe("number (> 0)");
  });

  it("负控制：不抛错 + 期望满足 ⇒ 0 条 nudo:case-expected", () => {
    const src = `/**
 * @nudo:case "t" (1) => 2
 */
export function f(x) { return x + 1; }
`;
    expect(caseExpectedCount(src)).toBe(0);
  });

  it("负控制：不抛错 + 期望不满足 ⇒ 1 条 nudo:case-expected（口径不变）", () => {
    const src = `/**
 * @nudo:case "t" (1) => 42
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  });

  it("负控制：抛错 + 无期望 ⇒ 0 条 nudo:case-expected（unchecked 口径不变）", () => {
    const src = `/**
 * @nudo:case "t" (1)
 */
export function f(x) { throw new Error("boom"); }
`;
    expect(caseExpectedCount(src)).toBe(0);
  });
});

describe("Bug 649：caseExpectedSatisfied 的 never 前置条件（消费侧单测）", () => {
  const one = numLit(1);

  it("实测 never ⇒ 不满足（底元素恒真被拦住）", () => {
    expect(caseExpectedSatisfied(neverAbs, numLit(42))).toBe(false);
  });

  it("负控制：实测 1、期望 1 ⇒ 满足（口径不变）", () => {
    expect(caseExpectedSatisfied(one, numLit(1))).toBe(true);
  });

  it("负控制：实测 1、期望 2 ⇒ 不满足（口径不变）", () => {
    expect(caseExpectedSatisfied(one, numLit(2))).toBe(false);
  });
});
