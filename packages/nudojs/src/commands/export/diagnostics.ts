/**
 * export — 诊断汇总面：check 面诊断、`nudo:interface-load`、冲突。
 *
 * 诊断**只上屏不改产物**：产物面（dts / zod / standard / guard）的字节内容不受
 * 诊断影响；诊断面走 stderr，stdout 投影面保持可钉住。
 */
import type { AnalysisResult, Diagnostic } from "@nudojs/service";

/** 诊断汇总面：一次 export 的全部诊断。 */
export type ExportDiagnostics = {
  /** 分析面诊断（check 面同源） */
  analysis: Diagnostic[];
  /** 侧车 / 契约装载诊断（`nudo:interface-load` 等） */
  interfaceLoad: Diagnostic[];
  /** 契约冲突诊断（合取不可满足等） */
  conflicts: Diagnostic[];
};

/**
 * 诊断汇总：分析面诊断归集（check 面同源）。
 *
 * 只**归集**不上屏——export 面的诊断呈现策略由后续分片决定（当前口径：诊断面
 * 走 stderr，stdout 投影面保持可钉住）。
 */
export function collectExportDiagnostics(result: AnalysisResult): ExportDiagnostics {
  return { analysis: result.diagnostics, interfaceLoad: [], conflicts: [] };
}

/**
 * 无证据参数位的 stderr 提示（docs/design/cli-semantics.md §2 的 unknown
 * 例外面）：指向三条补证据路径，stdout 投影面保持可钉住。
 */
export function reportUnevidencedParams(unevidencedParams: readonly string[]): void {
  if (unevidencedParams.length === 0) return;
  console.error(
    `note: ${unevidencedParams.join(", ")} rendered as unknown (no contract/case evidence) — add a sidecar contract (*.nudo.js), @nudo:contract, or @nudo:case / call-site evidence`,
  );
}

/**
 * mock 种子求值失败的 stderr 警告：导出面会无告警变 unknown ⇒ 上屏（含原因）
 * 后仍降级（不炸导出）。
 */
export function reportMockSeedFailure(filePath: string, reason: string): void {
  console.error(
    `warning: @nudo:mock seed evaluation failed for ${filePath}: ${reason} — mocks not applied; contract faces may render unknown`,
  );
}
