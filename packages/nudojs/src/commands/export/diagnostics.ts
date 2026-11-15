/**
 * export — 诊断汇总面：check 面诊断、`nudo:contract-load`、冲突。
 *
 * 诊断**只上屏不改产物**：产物面（dts / zod / standard / guard）的字节内容不受
 * 诊断影响；诊断面走 stderr，stdout 投影面保持可钉住。
 *
 * ⚠ **阻断级诊断**（Bug 610 / 607 / 625）：契约面装载失败 / 契约形参名与声明
 * 形参表不匹配 / 契约合取不可满足 —— 这三类诊断意味着**产物面会发布一份与
 * 契约不符的投影**（整条契约丢失 / 形参槽位名错位 / 只编码了无解契约的一半）。
 * 命中即：真实诊断上屏（stderr）+ exit 1 + **不发布产物**（发布错的比不发布
 * 更坏）。
 */
import { checkSource, pTrue, type EffectiveContractOpts } from "@nudojs/core";
import {
  DIAG,
  isDegradedCode,
  recordPublishGateShadow,
} from "@nudojs/core/internal";
import { collectSkipReturns, type AnalysisResult } from "@nudojs/service";

/** export 面的一条诊断（码 + 严重级 + 消息 [+ 关联函数]）。 */
export type ExportDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** 关联函数名（契约面诊断有；侧车装载失败等文件级诊断无）。 */
  fn?: string;
};

/** 诊断汇总面：一次 export 的全部诊断 + 阻断判定。 */
export type ExportDiagnostics = {
  /** 全部诊断条目（分析面 + check 面，去重后按来源顺序）。 */
  entries: ExportDiagnostic[];
  /** 侧车 / 契约装载诊断（`nudo:contract-load`）。 */
  contractLoad: ExportDiagnostic[];
  /** 契约冲突诊断（`nudo:contract-conflict`）。 */
  conflicts: ExportDiagnostic[];
  /** 阻断级（error）诊断存在 ⇒ **不得发布产物**。 */
  blocking: boolean;
};

/** 诊断收集的输入。 */
export type ExportDiagnosticOptions = {
  /** 被投影的源文件路径（诊断的定位基准）。 */
  filePath: string;
  /** 源文件文本。 */
  source: string;
  /** 分析面结果（诊断来源之一：分析面诊断）。 */
  result: AnalysisResult;
  /** 契约面装载口径（与 check / iface 面同口径）。 */
  effOpts: EffectiveContractOpts;
  /**
   * 导出面判据（模块公开面）：**只报导出面函数的诊断**——内部实现的契约问题
   * 不影响产物面（产物面不发布内部函数）。缺省 = 不过滤。
   */
  onExportFace?: (name: string) => boolean;
};

/**
 * 契约面三族（ADR 0001 §4 D3）。它们**既是**上屏码，**也是**「用户申报过契约」
 * 的证据——这三族只可能由契约解析 / 装载 / 合取产生：
 * - `nudo:contract-load`：侧车 / 模板装载失败 ⇒ 整条契约丢失（产物面把「未
 *   申报」当「无约束」发布）；
 * - `nudo:contract-param-mismatch`：契约形参名不在声明形参表 ⇒ 槽位名错位
 *   （产物面的参数名与函数签名对不上，调用方拿到错的校验器）；
 * - `nudo:contract-conflict`：契约合取不可满足 ⇒ 产物面只编码了一半契约。
 */
export const EXPORT_BLOCKING_CODES: readonly string[] = [
  DIAG.contractLoad,
  DIAG.contractParamMismatch,
  DIAG.contractConflict,
];

/**
 * 「用户申报过契约」的证据码：这些诊断**只可能**由契约解析 / 装载 / 合取产生，
 * 因此它们的存在本身就是申报意图的证明（不是阻断码表）。
 *
 * 必须含 `nudo:contract-syntax`（BUG-021）：契约**解析失败**时签名面拿不到
 * provenance，诊断是唯一的申报痕迹。
 */
const CONTRACT_DECLARATION_EVIDENCE: ReadonlySet<string> = new Set<string>([
  ...EXPORT_BLOCKING_CODES,
  DIAG.contractSyntax,
]);

/**
 * 诊断条目化：保留「阻断族 ∪ 全部降级证据族」。
 *
 * 此前只保留三族 ⇒ `nudo:contract-syntax` / `nudo:internal` /
 * `nudo:unknown-inference` 连上屏都被丢，产物静默「接受一切」（BUG-021）。
 * 阻断判据不在这里——见 `collectExportDiagnostics` 的语义门。
 */
function toExportDiagnostic(d: {
  severity: string;
  code?: string;
  message: string;
  fn?: string;
}): ExportDiagnostic | undefined {
  if (d.code === undefined) return undefined;
  if (!EXPORT_BLOCKING_CODES.includes(d.code) && !isDegradedCode(d.code)) return undefined;
  const severity =
    d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info";
  return {
    code: d.code,
    severity,
    message: d.message,
    ...(d.fn !== undefined ? { fn: d.fn } : {}),
  };
}

/**
 * check 面诊断（core `checkSource`）：与 `nudo check` **同源同码**。
 *
 * 契约形参名不匹配（`nudo:contract-param-mismatch`）与契约合取冲突
 * （`nudo:contract-conflict`）**只在这里出现**——分析面（analyzer）不产这两
 * 条，export 面此前又完全不看 check 面 ⇒ 契约与产物面对不上时**无人上屏**。
 *
 * L2 入口 may-throw 与导出面的契约诊断无关 ⇒ `entryThrows: "off"`（不评估函数
 * 体）。check 面自身抛错 ⇒ fail-open 返回空（诊断面不得反过来炸导出）。
 */
function checkFaceIssues(opts: ExportDiagnosticOptions): {
  entries: ExportDiagnostic[];
  raw: readonly { readonly code?: string }[];
  /** 契约申报真值（check 签名面自带 provenance）；check 面抛错时为 undefined */
  declaredContract: boolean;
  /** 申报过契约的入口名（降级证据按 `fn` 归因到这个集合才算该入口的保证掉了） */
  contractedEntries: ReadonlySet<string>;
} {
  const out: ExportDiagnostic[] = [];
  const autoBind =
    typeof opts.effOpts.autoBind === "boolean" ? opts.effOpts.autoBind : undefined;
  try {
    const report = checkSource(opts.filePath, opts.source, pTrue, {
      loadModule: opts.effOpts.loadModule,
      fromFile: opts.effOpts.fromFile ?? opts.filePath,
      ...(autoBind !== undefined ? { autoBind } : {}),
      ...(opts.effOpts.projectDir !== undefined ? { projectDir: opts.effOpts.projectDir } : {}),
      entryThrows: "off",
      skips: collectSkipReturns(opts.source),
    });
    for (const issue of report.issues) {
      const entry = toExportDiagnostic(issue);
      if (entry !== undefined) out.push(entry);
    }
    // ADR 0001 §4 D3：申报真值只能来自 `effectiveContract` 的解析结果
    // （generalize 顺带带进签名面）。不读源码字符串、不按诊断码反推。
    const contractedEntries = new Set(
      report.signatures
        .filter((s) => s.entry === true && s.contract !== undefined)
        .map((s) => s.name),
    );
    // 原始诊断（过滤前）只供影子双读使用；开关关闭时不复制、不构造 Evidence。
    return {
      entries: out,
      raw: report.issues,
      declaredContract: contractedEntries.size > 0,
      contractedEntries,
    };
  } catch {
    return { entries: [], raw: [], declaredContract: false, contractedEntries: new Set() };
  }
}

/**
 * 诊断收集（Bug 610 / 607 / 625）：两个来源合并去重。
 *
 * ① **check 面**（core `checkSource`）——契约形参名不匹配 / 契约合取冲突；
 * ② **分析面**（service analyzer）——侧车 / 模板装载失败（`nudo:contract-load`）。
 *
 * 两个来源都会报 `nudo:contract-load`（分析面先报、check 面再报一次）⇒ 按
 * (码, 函数, 消息) 去重后只剩一条。
 */
export function collectExportDiagnostics(opts: ExportDiagnosticOptions): ExportDiagnostics {
  const entries: ExportDiagnostic[] = [];
  const seen = new Set<string>();
  const push = (d: ExportDiagnostic): void => {
    const key = `${d.code}|${d.fn ?? ""}|${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(d);
  };
  /** 只报导出面函数的诊断（内部实现的契约问题不发布产物 ⇒ 不阻断）。 */
  const inScope = (fn: string | undefined): boolean => {
    if (fn === undefined || opts.onExportFace === undefined) return true;
    return opts.onExportFace(fn);
  };

  const checkFace = checkFaceIssues(opts);
  for (const issue of checkFace.entries) {
    if (!inScope(issue.fn)) continue;
    push(issue);
  }
  for (const d of opts.result.diagnostics) {
    const entry = toExportDiagnostic(d);
    if (entry === undefined) continue;
    push(entry);
  }
  // ADR 0001 阶段 1 切片 4.1：发布门影子双读。默认关闭 ⇒ 一次布尔判断、
  // 零行为变更；开启后把「按码白名单 vs 语义判据」的分歧输出成清单
  // （不设白名单，§10 决议 4）。
  recordPublishGateShadow([checkFace.raw, opts.result.diagnostics], EXPORT_BLOCKING_CODES);

  // ADR 0001 §4 D3：阻断 = **语义判据**，不是码表（BUG-021 / 决议 2）。
  //
  //   公开面存在降级证据 ∧ 用户申报过契约 ⇒ 阻断
  //
  // 「申报过契约」的真值有两处，都来自契约解析本身，不做源码字符串近似：
  //   ① check 签名面自带的 provenance（`effectiveContract` 解析成功时）；
  //   ② 契约面诊断（装载 / 合取 / 语法）——这些码**只可能**由「申报了契约」
  //      产生，因此也是申报意图的证据。② 是覆盖率的关键：契约本身解析失败
  //      时（BUG-021 的 `nudo:contract-syntax`）① 必然拿不到 provenance。
  //
  // 归因（本轮收紧）：契约面诊断恒阻断；**一般降级族**（`internal` /
  // `unknown-inference`）按 `fn` 归因——只有落在「申报过契约的入口」上才算
  // 该入口的保证掉了（无 `fn` 的模块级降级无法归因 ⇒ 保守阻断）。
  // 否则一个文件里只要**别处**有一个入口推断失败（例如 `fs.readFileSync` 在
  // 严格能力档下恒 unknown），整份产物就会被无关入口卡住 —— 而同类降级落在
  // **未申报**入口上本来就只上屏不阻断（见下）。
  //
  // 这带来三处有意的行为变更：
  //   - `nudo:contract-syntax` 从此阻断（此前 exit 0 且零上屏）；
  //   - 申报过契约的**入口**出现 `nudo:internal` / `unknown-inference` 阻断；
  //   - 降级落在**未申报**的入口时只上屏（纯推导的兄弟入口不得卡住别人的契约）。
  const degradedOnSurface = entries.filter((d) => isDegradedCode(d.code));
  const contractEvidence = degradedOnSurface.filter((d) =>
    CONTRACT_DECLARATION_EVIDENCE.has(d.code),
  );
  const genericDegradation = degradedOnSurface.filter(
    (d) => !CONTRACT_DECLARATION_EVIDENCE.has(d.code),
  );
  const declaredContract = checkFace.declaredContract || contractEvidence.length > 0;
  const attributedToContract = genericDegradation.some(
    (d) => d.fn === undefined || checkFace.contractedEntries.has(d.fn),
  );

  return {
    entries,
    contractLoad: entries.filter((d) => d.code === DIAG.contractLoad),
    conflicts: entries.filter((d) => d.code === DIAG.contractConflict),
    blocking:
      contractEvidence.length > 0 || (declaredContract && attributedToContract),
  };
}

/**
 * 诊断的单行渲染：**唯一**的诊断字符串拼装点——S1 / S2 / S5 要报诊断从这里取，
 * 不要各自拼字符串（否则同一条诊断在四个面上文案漂移）。
 */
export function formatExportDiagnostic(d: ExportDiagnostic): string {
  const label =
    d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "note";
  return `${label}: [${d.code}] ${d.message}`;
}

/**
 * 诊断上屏（stderr）。阻断级诊断附一条 fix 提示（指向 check 面的完整报告）。
 */
export function reportExportDiagnostics(diags: ExportDiagnostics): void {
  for (const d of diags.entries) {
    console.error(formatExportDiagnostic(d));
  }
  if (!diags.blocking) return;
  console.error(
    "fix:  fix the contract (nudo check <file> shows the full report), then re-run nudo export",
  );
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
