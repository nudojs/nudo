/**
 * 缓存只允许加速，不允许改变结果：同一文件、同一 caseMode，无论进程此前
 * 跑过哪种 caseMode，`analyzeFile*` 的见证与诊断必须逐字一致。
 *
 * 覆盖两层缺陷（同一个逐函数快照）：
 * - 快照必须含 entry@/call@ 合成产物 ⇒ `all` 之后的 `none` 不得丢掉 call@ 见证；
 * - 快照诊断必须与最终共享通道对账 ⇒ 早期登记后被 `settleEntryOnlyCandidates`
 *   撤销的 `nudo:contract-entry-only` 不得在缓存命中时复活。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  analyzeFile,
  analyzeFileAsync,
  clearAnalysisFileCache,
  clearFnAnalysisCache,
  type AnalysisResult,
} from "@nudojs/service";
import { tmpProject } from "./tmp-project.ts";

const SOURCE = `/**
 * @nudo:case "literal" (1)
 */
export function inc(x) { return x + 1; }

export function useInc() { return inc(2); }

export function noCall() { return 42; }
`;

function resetCaches(): void {
  clearAnalysisFileCache();
  clearFnAnalysisCache();
}

/** 结果里「读者能看到」的两份事实：函数见证 + 诊断（含顺序）。 */
function observable(result: AnalysisResult): unknown {
  return {
    functions: result.functions.map((fn) => ({
      name: fn.name,
      entryOnly: fn.entryOnly,
      cases: fn.cases.map((c) => ({
        name: c.name,
        source: c.source,
        result: c.abs,
        throws: c.throwsAbs,
      })),
      combinedAbs: fn.combinedAbs,
      entryThrowsAbs: fn.entryThrowsAbs,
    })),
    diagnostics: result.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      line: d.range.start.line,
    })),
  };
}

function analyzeNone(file: string): AnalysisResult {
  return analyzeFile(file, SOURCE, undefined, undefined, undefined, "none");
}

describe("逐函数分析缓存与 caseMode 的组合一致性", () => {
  beforeEach(resetCaches);
  afterEach(resetCaches);

  it("none → all → none：第三次与第一次逐字相同（含 call@ 见证与 entry-only 诊断）", async () => {
    const file = `${tmpProject("nudo-fn-cache-mode-")}/lib.js`;
    const first = analyzeNone(file);
    await analyzeFileAsync(file, SOURCE, undefined, undefined, undefined, "all");
    const third = analyzeNone(file);

    expect(observable(third)).toEqual(observable(first));

    const inc = third.functions.find((f) => f.name === "inc");
    expect(inc?.cases.map((c) => `${c.name}/${c.source}`)).toEqual(["call@L6/callsite"]);
    // 点观测是见证、不是域声明 ⇒ 入口兜底仍合成调用点；有调用点证据 ⇒ 不发 entry-only
    expect(third.diagnostics.filter((d) => d.code === "nudo:contract-entry-only")).toHaveLength(2);
  });

  it("all → none → all：第三次与第一次逐字相同（directive + call@ 见证不丢不增）", async () => {
    const file = `${tmpProject("nudo-fn-cache-mode-")}/lib.js`;
    const first = await analyzeFileAsync(file, SOURCE, undefined, undefined, undefined, "all");
    analyzeNone(file);
    const third = await analyzeFileAsync(file, SOURCE, undefined, undefined, undefined, "all");

    expect(observable(third)).toEqual(observable(first));
    const inc = third.functions.find((f) => f.name === "inc");
    expect(inc?.cases.map((c) => `${c.name}/${c.source}`)).toEqual([
      "literal/directive",
      "call@L6/callsite",
    ]);
  });
});
