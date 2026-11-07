/**
 * Bug 950（**分析面**）：第三态只活在报告面 ⇒ 同一输出里两条消息口径不一致。
 *
 * 报告面（`packages/nudojs/src/run-test.ts` 与 `packages/service/src/test-report.ts`）
 * 已把「引擎**未能推断**实测值」（实测 Abs 是 `unknown` / `conf === "opaque"`）
 * 记为 **unchecked**（无法判定、不置红、exit 0），
 * 但**分析面**的 `nudo:case-expected` 发射点
 * （`packages/service/src/analyzer-orchestrate-uncached-cases.ts`）
 * 仍用**二值**判定结果直接决定**诊断的严重度**
 * ⇒ 改后人类面 / `--json` 仍可见 `[error] … (nudo:case-expected)`，
 * 而断言面已是「unchecked + exit 0」⇒ **退出码与断言汇总正确、诊断文案却仍说「类型不匹配」**。
 *
 * 修法：发射点先判「推导失败」⇒ 记 **INFO** 的 `nudo:opaque-result`
 * （与 check 面把同一事实判成 INFO、exit 0 **同严重度、同码**），
 * **不发** `nudo:case-expected` error；「推导成功 + 期望不符」的真失败分支**逐字不动**。
 *
 * 钉：
 * - 推导失败 + 期望 `number()` ⇒ **没有** `nudo:case-expected`；
 *   有且仅有 `nudo:opaque-result`，且 **severity = "info"**；
 * - 推导失败 + 期望 `any()` ⇒ 同上（**不被放宽的期望空洞通过**）；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 `nudo:case-expected` **error**；
 * - 负控制：推导成功 + 期望相符 ⇒ 两者都**不**产出。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

/** 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持 ⇒ 实测 unknown）。 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

/** 推导成功（负控制）：实测是 `x + 1`，期望 `string()` ⇒ 真失败。 */
const INFERRED_BODY = `export function g(x) { return x + 1; }
`;

type Diag = { code: string; severity: string; message: string };

/** 分析一个带声明期望的 case 文件，返回全部诊断。 */
function diagsOf(src: string): Diag[] {
  return withTmpProject("nudo-b950-an-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    const result = analyzeFile(file, readFileSync(file, "utf-8"));
    return result.diagnostics.map((d) => ({
      code: d.code ?? "",
      severity: d.severity,
      message: d.message,
    }));
  });
}

describe("Bug 950 — 分析面：推导失败 ⇒ nudo:opaque-result（INFO），不发 nudo:case-expected", () => {
  it("推导失败 + 期望 number() ⇒ 只有 nudo:opaque-result，且严重度是 info", () => {
    const diags = diagsOf(
      `/**\n * @nudo:case "w" (1) => number()\n */\n${OPAQUE_BODY}`,
    );
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(0);
    const opaque = diags.filter((d) => d.code === "nudo:opaque-result");
    expect(opaque).toHaveLength(1);
    expect(opaque[0]!.severity).toBe("info");
    expect(opaque[0]!.message).toContain("could not infer the actual value");
    expect(opaque[0]!.message).not.toContain("does not match the expected type");
  });

  it("推导失败 + 期望 any() ⇒ 同上（不放宽的期望不得空洞通过）", () => {
    const diags = diagsOf(
      `/**\n * @nudo:case "w" (1) => any()\n */\n${OPAQUE_BODY}`,
    );
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "nudo:opaque-result")).toHaveLength(1);
  });

  it("负控制：推导成功 + 期望不符 ⇒ 仍是 nudo:case-expected（error）", () => {
    const diags = diagsOf(
      `/**\n * @nudo:case "w" (1) => string()\n */\n${INFERRED_BODY}`,
    );
    const failed = diags.filter((d) => d.code === "nudo:case-expected");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.severity).toBe("error");
    expect(failed[0]!.message).toContain("does not match the expected type");
    expect(diags.filter((d) => d.code === "nudo:opaque-result")).toHaveLength(0);
  });

  it("负控制：推导成功 + 期望相符 ⇒ 两者都不产出", () => {
    const diags = diagsOf(
      `/**\n * @nudo:case "w" (1) => number()\n */\n${INFERRED_BODY}`,
    );
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "nudo:opaque-result")).toHaveLength(0);
  });
});
