/**
 * Bug 950：断言判定**没有「推导失败」第三态**（LSP agent `testTool` 的报告面）。
 *
 * 本模块（`packages/service/src/test-report.ts`）是 CLI `nudo test` 报告面的
 * **平行副本**（LSP agent 工具面 `packages/lsp/src/agent-tools.ts` 的
 * `testTool` 调它）⇒ 第三态必须**两处同改**，否则 CLI 与 agent 工具面口径分叉。
 *
 * 根因：断言判定是**二值**的——实测侧 `unknown`（**引擎没推出来**）被压成
 * 「断言不符」（假红），而 `any()` 期望又借 core `leqAbs` 的「目标放宽 ⇒ 通过」
 * 捷径**空洞通过**（假绿）⇒ 同一事实两种期望都不可用；且与 check 面把同一
 * 状态判成 INFO（`nudo:opaque-result`、exit 0）**严重度相反**。
 *
 * 修法：报告面引入**第三态**——实测侧是 `unknown` / `conf === "opaque"`
 * （推导失败）⇒ 记 **unchecked（无法判定）**：`failed` 不计它、`passed` 不计它、
 * `unchecked` 计它；outcome 带 `uncheckedReason: "inference-failed"` 供消费方
 * 区分「无法判定」与「没写期望」。
 *
 * 钉（service 报告面）：
 * - 推导失败 + 期望 `number()` ⇒ unchecked（**不是** failed）+ reason；
 * - 推导失败 + 期望 `any()` ⇒ 同样 unchecked（**不是** passed）；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 failed；
 * - 负控制：声明了但**没写**期望 ⇒ 既有 `no-expectation` 口径不变；
 * - 负控制：抛错（实测 `never`）⇒ 仍是 failed（**不是**「推导失败」——
 *   `never` 是底元素，Bug 649 的判定层已把它拦成「不满足」）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { buildTestReport } from "../test-report.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

/** 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持 ⇒ 实测 unknown）。 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

type Report = ReturnType<typeof buildTestReport>;

/** 跑一个带声明期望的 case 文件，返回报告面结果。 */
function reportOf(src: string): Report {
  return withTmpProject("nudo-b950-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return buildTestReport(file, analyzeFile(file, readFileSync(file, "utf-8")));
  });
}

describe("Bug 950 — service 报告面（agent testTool）的第三态：推导失败 ⇒ unchecked", () => {
  it("推导失败 + 期望 number() ⇒ unchecked（不是 failed）", () => {
    const report = reportOf(`/**
 * @nudo:case "num" (1) => number()
 */
${OPAQUE_BODY}`);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.unchecked).toBe(1);
    const o = report.outcomes.find((x) => x.caseName === "num")!;
    expect(o.unchecked).toBe(true);
    expect(o.uncheckedReason).toBe("inference-failed");
    expect(o.ok).toBe(false);
    expect(o.expected).toBe("number");
    expect(o.actual).toBe("unknown");
  });

  it("推导失败 + 期望 any() ⇒ 同样 unchecked（不是空洞 passed）", () => {
    const report = reportOf(`/**
 * @nudo:case "any" (1) => any()
 */
${OPAQUE_BODY}`);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.unchecked).toBe(1);
    const o = report.outcomes.find((x) => x.caseName === "any")!;
    expect(o.unchecked).toBe(true);
    expect(o.uncheckedReason).toBe("inference-failed");
  });

  it("负控制：推导成功 + 期望不符 ⇒ 仍是 failed（既有行为不变）", () => {
    const report = reportOf(`/**
 * @nudo:case "wrong" (1) => string()
 */
export function g(x) { return x + 1; }
`);
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(0);
    expect(report.unchecked).toBe(0);
    const o = report.outcomes.find((x) => x.caseName === "wrong")!;
    expect(o.unchecked).toBe(false);
    expect(o.uncheckedReason).toBeUndefined();
  });

  it("负控制：声明了但没写期望 ⇒ no-expectation 口径不变", () => {
    const report = reportOf(`/**
 * @nudo:case "free" (1)
 */
export function g(x) { return x + 1; }
`);
    expect(report.unchecked).toBe(1);
    expect(report.failed).toBe(0);
    const o = report.outcomes.find((x) => x.caseName === "free")!;
    expect(o.uncheckedReason).toBe("no-expectation");
  });

  it("负控制：抛错（实测 never）⇒ 仍是 failed（never 不是「推导失败」）", () => {
    const report = reportOf(`/**
 * @nudo:case "t" (1) => 42
 */
export function g(x) { throw new Error("boom"); }
`);
    expect(report.failed).toBe(1);
    expect(report.unchecked).toBe(0);
    const o = report.outcomes.find((x) => x.caseName === "t")!;
    expect(o.uncheckedReason).toBeUndefined();
  });
});
