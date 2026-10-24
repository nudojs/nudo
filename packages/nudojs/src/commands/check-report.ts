/**
 * nudo check 报告渲染/格式化族（自 commands/check.ts 拆出，纯搬移零行为变化）：
 * docs 深链、#1 onboarding 块、语法错 tsc 风格块、runCheck 段 3/3 的
 * report+exit 打印面（终端/JSON/GHA/GitLab）+ 缓存回写 + exit。
 * 编排（loadCache / buildInjection / runCheck / runCheckFix）留在 check.ts，
 * commander 装配在 check-command.ts；函数签名与上屏字节不变
 * （verify:examples 逐字节 pin CLI 输出）。
 */
import { basename } from "node:path";
import { paint } from "../ui.ts";
import {
  formatCheckReport,
  formatGithubAnnotations,
  formatGitlabCodeQuality,
  serializeCheckJson,
  type CheckIssue,
  type CheckJson,
  type CheckReport,
} from "@nudojs/core";
import { entryVariantIssueForFile, mergeCheckIssues } from "@nudojs/service";
import { runAbsView } from "./shared.ts";
import {
  docsDiagnosticCodes,
  dualEntryIssue,
  mergeJsonIssues,
  serializeCheckJsonForCache,
  stripConfigShapeIssues,
  stripEnvUnresolvedIssues,
} from "../check-json-map.ts";
import { shouldEmitGha, shouldPrintDocsLinks } from "../check-ci-flags.ts";
import { DIAG } from "@nudojs/core/internal";
import type { CheckCacheState, RunCheckOptions } from "./check.ts";

// 诊断 → 文档深链：问题码映射到 reference/diagnostics.md 的显式锚点。
// 锚点 id 规则 = code.replaceAll(":", "-")；诊断码覆盖测试
// （packages/website/tests/docs-coverage.test.ts）保证每个上屏码都有锚点。
const DOCS_DIAGNOSTICS =
  "https://nudojs.github.io/nudo/docs/reference/diagnostics";
function printDocsLinks(issues: Array<{ code?: string }>): void {
  const codes = docsDiagnosticCodes(issues);
  if (codes.length === 0) return;
  console.log("");
  console.log("docs");
  for (const code of codes) {
    console.log(`  ${code} → ${DOCS_DIAGNOSTICS}#${code.replaceAll(":", "-")}`);
  }
}


/** L2 入口 may-throw 诊断码（onboarding 指纹：error 全为此码才打引导块） */
const ENTRY_MAY_THROW_CODE = DIAG.entryMayThrow;

/**
 * 1145：**模块级求值失败**（引擎内部回落）诊断的 message 前缀。
 *
 * 这是 CLI 面识别「分析失败 ⇒ 闸门未能判定」的**唯一**判据：
 * `nudo:internal` 这个码本身还被 core 的 assign 通道降级路径占用
 * （severity **warning**，message 形如 `assign channel check failed: …`）
 * ⇒ 不得用「码相同」当判据（否则把那条 warning 误判成分析失败 ⇒ 缓存
 * 不回写 ⇒ 性能退化）。
 */
export const ANALYSIS_FAILED_PREFIX = "analysis failed: module evaluation failed";

/**
 * 该报告是否含「模块级求值失败」诊断（⇒ 降级产物**不得**回写磁盘缓存：
 * 回写会让下次 check 命中缓存整体跳过求值 ⇒ 静默转绿）。
 */
function hasAnalysisFailure(report: { issues: CheckIssue[] }): boolean {
  return report.issues.some(
    (i) =>
      i.code === DIAG.internal &&
      typeof i.message === "string" &&
      i.message.startsWith(ANALYSIS_FAILED_PREFIX),
  );
}

/** #1 onboarding 块：issues 段之后、docs 段之前（措辞是文档/verify-examples 同步基线） */
function printOnboardingBlock(): void {
  console.log("");
  console.log("onboarding");
  console.log(
    "  every error above is an L2 entry may-throw — unconstrained entry points, not broken contracts.",
  );
  console.log(
    "  no @nudo:* directives and no package.json#nudo config found in this project yet. next steps:",
  );
  console.log("    nudo init                      write an adoption baseline config (L2 → warning)");
  console.log("    nudo contract --draft <file>   draft a *.nudo.js sidecar contract for one file");
  console.log("    nudo check --profile adoption  preview the gate with L2 as warnings");
}

// ---------------------------------------------------------------------------
// 语法错 UX（tsc 风格）：path:line:col — syntax error + 源码摘录 + ^ 指位
// ---------------------------------------------------------------------------

/** 语法错定位 + 本质信息（line/column 为 Babel 原生 1-based line / 0-based column） */
type SyntaxErrorInfo = { line: number; column: number; essence: string };

/**
 * 解析/装配阶段的语法类错误识别。两种定位形态都处理：
 *  - `err.loc`（Babel SyntaxError 原生，{line, column}）；
 *  - message 尾部 `(l:c)`（经 service 层转发丢失 loc 的包装错）。
 * 非语法类装配失败返回 null（走 `analysis setup failed` 通道）。
 */
export function syntaxErrorInfo(err: unknown): SyntaxErrorInfo | null {
  const message = String((err as Error | undefined)?.message ?? err ?? "");
  const name = (err as { name?: unknown } | null | undefined)?.name;
  const loc = (err as { loc?: { line?: unknown; column?: unknown } } | undefined)?.loc;
  const looksSyntax =
    err instanceof SyntaxError ||
    name === "SyntaxError" ||
    (loc !== undefined && loc !== null) ||
    /\(\d+:\d+\)\s*$/.test(message);
  if (!looksSyntax) return null;
  let line: number | undefined;
  let column: number | undefined;
  if (loc && typeof loc.line === "number" && typeof loc.column === "number") {
    line = loc.line;
    column = loc.column;
  } else {
    const m = /\((\d+):(\d+)\)\s*$/.exec(message);
    if (m) {
      line = Number(m[1]);
      column = Number(m[2]);
    }
  }
  if (line === undefined || column === undefined) return null;
  const essence = message.replace(/\s*\(\d+:\d+\)\s*$/, "").trim() || "syntax error";
  return { line, column, essence };
}

/**
 * 语法错上屏块（对齐 tsc 的 file:line:col + 源码 + 指位风格）：
 * `path:line:col — syntax error: <本质信息>` + 源码行摘录 + 下一行 `^` 指位。
 * 显示列 1-based（Babel 0-based + 1）；错误行越界/为空（EOF 错）时摘录回落
 * 到最后一个非空行、`^` 落行尾；空源码退化为首行。
 */
export function formatSyntaxErrorBlock(filePath: string, source: string, info: SyntaxErrorInfo): string {
  const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
  const header = `${filePath}:${info.line}:${info.column + 1} — syntax error: ${info.essence}`;
  let excerpt: string | undefined;
  let caretIndent: number | undefined;
  const at = info.line >= 1 && info.line <= lines.length ? lines[info.line - 1] : undefined;
  if (at !== undefined && at.trim().length > 0) {
    excerpt = at;
    caretIndent = Math.min(info.column, at.length);
  } else {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (l.trim().length > 0) {
        excerpt = l;
        caretIndent = l.length;
        break;
      }
    }
  }
  if (excerpt === undefined || caretIndent === undefined) return header;
  return `${header}\n${excerpt}\n${" ".repeat(caretIndent)}^`;
}


// ---------------------------------------------------------------------------
// nudo:dual-entry 的缓存口径（live 瞬态 issue：写盘剥除 + 读回剥除）
// ---------------------------------------------------------------------------

/** summary 形状（剥除类工具的最小面：issues + 计数） */
type StripSummaryLike = {
  issues: Array<{ severity?: string; code?: string }>;
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/**
 * 剔除 nudo:dual-entry（live 瞬态 info，不持久化进磁盘缓存）。
 *
 * 该 issue 在**缓存之后**注入（保证缓存命中轮也上屏）——若把它一并写进
 * 磁盘缓存，下一轮命中缓存就**再注入一次** ⇒ 同文案重复两条（冷 1 条 /
 * 热 2 条），机器面（--json 的 issues 数组长度 / summary.infos）逐轮漂移。
 *
 * 与 env-unresolved / 配置形状诊断同一口径：**写盘前剥除 + 读回后剥除**，
 * 由本轮 live 注入单一来源上屏（命中轮的缓存条目可能来自旧版本 ⇒ 读回
 * 侧同样要剥，否则旧条目 + live 注入仍是两条）。
 *
 * summary 计数按剩余 issues 的 severity 重算（与 checkSource 口径一致）。
 */
function stripDualEntryIssues<T extends StripSummaryLike>(x: T): T {
  if (!x.issues.some((i) => i.code === DIAG.dualEntry)) return x;
  const issues = x.issues.filter((i) => i.code !== DIAG.dualEntry);
  return {
    ...x,
    issues,
    summary: {
      ...x.summary,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    },
  };
}


/**
 * 单条 issue 的 **JSON 形状**（core 的 serializeCheckJson 派生 actions 等
 * 字段：裸 CheckIssue 不带 actions）。
 *
 * 命中轮的 report **不可再序列化**：signatureFromCachedJson 重建的 abs 是
 * lossy 占位（shape 为 undefined）⇒ formatAbs 会炸 ⇒ 这里用空 signatures
 * 的壳只取目标 issue 的形状（issue 的 JSON 字段与签名无关）。
 */
function jsonIssueShape(issue: CheckIssue): CheckJson["issues"][number] | undefined {
  const shell: CheckReport = {
    file: "",
    issues: [issue],
    ok: true,
    signatures: [],
    summary: { errors: 0, warnings: 0, infos: 0, functions: 0 },
  };
  return serializeCheckJson(shell).issues[0];
}


// ---------------------------------------------------------------------------
// runCheck 段 3/3 — report+exit：打印面（终端/JSON/GHA/GitLab）+ 缓存回写 + exit
// ---------------------------------------------------------------------------

export async function emitCheckReport(
  filePath: string,
  reportIn: CheckReport,
  cache: Pick<
    CheckCacheState,
    "disk" | "cacheKey" | "cached" | "useDisk" | "cachedJson"
  >,
  injectionSetupFailed: boolean,
  opts: RunCheckOptions,
): Promise<void> {
  // 缓存里可能带着上一轮注入的 nudo:dual-entry（写盘已剥除；旧缓存条目
  // 仍可能带一份）⇒ 注入前先剥除，避免与本轮 live 注入重复。
  let report = stripDualEntryIssues(reportIn);
  let cachedJson = cache.cachedJson
    ? stripDualEntryIssues(cache.cachedJson)
    : cache.cachedJson;

  // nudo:dual-entry（T4）：browser/node 双入口变体之一被 check → 观察面只覆盖
  // 本入口（info，单入口零误报）。在缓存之后注入，保证缓存命中也上屏。
  // **不落盘**：写盘口径剥除该码（stripDualEntryIssues）⇒ 命中轮与 miss 轮
  // 的 issues 数组逐条相同（不会冷 1 条 / 热 2 条）。
  {
    const dual = entryVariantIssueForFile(filePath);
    if (dual) {
      const dualIssue = dualEntryIssue(dual);
      report = mergeCheckIssues(report, [dualIssue]);
      if (cachedJson) {
        // JSON 面注入**序列化后**的形状：actions 字段由 core 的
        // serializeCheckJson 按诊断码派生（裸 CheckIssue 不带 actions）
        // ⇒ 命中轮若注入裸形状，会比 miss 轮（serializeCheckJson(report)）
        // 少一个 actions 字段 ⇒ 机器面仍不对称（逐条相同的承诺）。
        const dualJson = jsonIssueShape(dualIssue);
        if (dualJson) cachedJson = mergeJsonIssues(cachedJson, [dualJson]);
      }
    }
  }

  const checkJson = cachedJson ?? serializeCheckJson(report);
  // 批次探针聚合（#1/#9）：error 计数、非 L2 error 破坏标记、磁盘缓存启用探测
  if (opts.batchProbe) {
    const errs = report.issues.filter((i) => i.severity === "error");
    opts.batchProbe.errorIssues += errs.length;
    if (injectionSetupFailed || errs.some((i) => i.code !== ENTRY_MAY_THROW_CODE)) {
      opts.batchProbe.nonL2Error = true;
    }
    if (cache.disk.enabled) opts.batchProbe.cacheEnabled = true;
  }
  const wantGha = shouldEmitGha(opts.gha, process.env.GITHUB_ACTIONS);
  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  // CI 注解面：**两个并列通道**，各自独立开关——
  // - GitLab：Code Quality JSON 数组（--gitlab）
  // - GHA：行内注解 ::error/::warning（--gha / GITHUB_ACTIONS=true）
  // 旧实现把 GitLab 挂在 `--json` 的 else 上（且 jsonCollect 恒被设置）
  // ⇒ `--json --gitlab` 的注解整段丢失（既不进 stdout 也不进 stderr）。
  // 机器面（--json）两个通道**都只写 stderr**——stdout 是 CheckJson 契约，
  // 注解不得混进去（与 --gha 的既有口径同形）。
  const emitGitlabAnnotations = (): void => {
    if (!opts.gitlab) return;
    const rows = formatGitlabCodeQuality(report, { workspaceRoot });
    // 多文件 --gitlab：rows 交 action 层聚合成单数组（GitLab Code
    // Quality 只接受一份 JSON 数组报告），本函数不打印
    if (opts.gitlabRowsCollect) {
      opts.gitlabRowsCollect.push(...rows);
      return;
    }
    // 单文件：直接打印；--json 时走 stderr，stdout 保持机器契约
    if (!opts.json) console.log(JSON.stringify(rows, null, 2));
    else console.error(JSON.stringify(rows));
  };
  const emitGhaAnnotations = (): void => {
    if (!wantGha) return;
    const ann = formatGithubAnnotations(report, { workspaceRoot });
    if (ann.length === 0) return;
    // --json 时注解走 stderr，stdout 保持机器契约
    if (opts.json) console.error(ann);
    else console.log(ann);
  };
  const emitCiAnnotations = (): void => {
    // --json 面：两个通道并列（都走 stderr，stdout 是 CheckJson 契约）
    if (opts.json) {
      emitGitlabAnnotations();
      emitGhaAnnotations();
      return;
    }
    // 非 --json 面：GitLab 独占 stdout（stdout 必须恰好是一份 Code Quality
    // JSON 数组）⇒ GHA 不与之并列（否则 stdout 混入 ::error 行）
    if (opts.gitlab) {
      emitGitlabAnnotations();
      return;
    }
    emitGhaAnnotations();
  };

  if (opts.json && opts.jsonCollect) {
    opts.jsonCollect.push(checkJson);
    // 两个注解通道都要发（此前这里只发 GHA ⇒ --gitlab 注解整段丢失）
    emitCiAnnotations();
  } else if (opts.json) {
    if (opts.abs) {
      console.error("error: --json cannot be combined with --abs");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(checkJson, null, 2));
    emitCiAnnotations();
  } else if (opts.gitlab) {
    emitCiAnnotations();
    if (!report.ok) {
      // 仍打印简报，便于日志
      console.error(paint(formatCheckReport(report, { verbose: false })));
    }
  } else if (opts.abs) {
    // 代数观察面（term/pred/conf）；门禁不因 --abs 关闭：L1/L2 error 仍 exit 1
    await runAbsView(filePath, opts.absView ?? {});
    if (!report.ok) {
      // abs 仍计算 report：错误上屏，避免 exit 1 却无可见诊断
      console.log("");
      console.log(paint(formatCheckReport(report, { verbose: false })));
    } else {
      console.log("");
      console.log(`nudo check  ${basename(filePath)}`);
      console.log("OK");
      console.log(
        `  ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.infos} info · ${report.summary.functions} fn`,
      );
    }
    emitCiAnnotations();
  } else if (opts.quiet) {
    // --quiet（人类文本面）：压 signatures 段——issues + summary + 门禁 exit
    // 不变；成功且零 issue 时只打一行摘要（文件 + OK + 计数）。空 signatures
    // 的浅拷贝走同一 formatCheckReport：budget / issues 各段与全量面同构。
    if (report.ok && report.issues.length === 0) {
      console.log(
        `nudo check  ${basename(filePath)}  OK  ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.infos} info · ${report.summary.functions} fn`,
      );
    } else {
      console.log(
        paint(
          formatCheckReport({ ...report, signatures: [] }, { verbose: opts.verbose === true }),
        ),
      );
    }
    emitCiAnnotations();
  } else {
    console.log(paint(formatCheckReport(report, { verbose: opts.verbose === true })));
    emitCiAnnotations();
  }

  // #1 零配置 onboarding（issues 段之后、docs 段之前）：全部 error 为 L2 入口
  // may-throw + 全部目标零 @nudo:* 指令 + 零 nudo 配置的纯净新项目指纹。
  // 门禁语义不变（仍 exit 1）；探针只在人类面创建（--json/--gitlab/--gha 无）。
  // 形状非法（468/936）时**不打**：项目**有** nudo 键（只是形状写坏），
  // 「本项目还没有 nudo 配置」的前提不成立，onboarding 的「nudo init」
  // 建议是错 advice——配置形状诊断已经在 issues 段里说清了。
  if (
    opts.batchProbe &&
    opts.onboardingFinal &&
    opts.batchProbe.errorIssues > 0 &&
    !opts.batchProbe.nonL2Error &&
    opts.batchProbe.filesWithDirectives === 0 &&
    opts.batchProbe.filesWithConfig === 0 &&
    !opts.batchProbe.configShape
  ) {
    printOnboardingBlock();
  }

  // 诊断 → 文档深链（仅终端面；--json / --gitlab 机器契约不打——
  // --gitlab 的 stdout 必须恰好是一个 Code Quality JSON 数组）
  if (
    shouldPrintDocsLinks({
      json: opts.json,
      gitlab: opts.gitlab,
      abs: opts.abs,
      issueCount: report.issues.length,
      reportOk: report.ok,
    })
  ) {
    printDocsLinks(report.issues);
  }

  // 降级产物不回写：注入装配失败时的分析缺注入面（无模块/mock），
  // 回写会让下次 check 命中缓存整体跳过注入装配 → 静默转绿
  // 1145：同理——**模块级求值失败**（引擎内部回落 ⇒ 模块导出丢失 ⇒ 闸门
  // 未能判定）的降级产物也不得回写（回写 ⇒ 下次命中缓存整体跳过求值 ⇒
  // 静默转绿 ⇒ 假绿复发）。
  if (
    cache.useDisk &&
    cache.cacheKey &&
    !cache.cached &&
    !opts.abs &&
    !injectionSetupFailed &&
    !hasAnalysisFailure(report)
  ) {
    try {
      // env-unresolved 是 live 瞬态（每轮现场收集），不持久化——
      // 否则命中轮 live merge 再追加会重复告警
      // 配置形状诊断（468/936）同理：它是**项目配置**的 live 事实，且
      // 「nudo 键形状非法」与「没有 nudo 键」的缓存键相同（配置各维都是
      // null）⇒ 用户把写坏的键改好后，旧的告警条目不得留在缓存里。
      // nudo:dual-entry 同为 live 瞬态（缓存之后注入）：写盘带一份 ⇒
      // 命中轮再注入一份 ⇒ 同文案重复两条（机器面逐轮漂移）。
      // serializeCheckJsonForCache：签名附带缓存私有 ret（miss 轮渲染出的
      // 返回段）——命中轮 reportFromCachedJson 消费它保持签名行字节一致
      cache.disk.set(
        cache.cacheKey,
        serializeCheckJsonForCache(
          stripDualEntryIssues(stripConfigShapeIssues(stripEnvUnresolvedIssues(report))),
        ),
      );
    } catch {
      /* optional: disk cache write failed — check result still valid */
    }
  }

  // --json 单文件：exit 与打印出的 ok 同源（路径错误在 action 层已并入信封）；
  // 注入装配失败独立于 ok 挡红（降级分析可能零诊断 ok:true）
  if (opts.json && !opts.jsonCollect) {
    process.exitCode = checkJson.ok && !injectionSetupFailed ? 0 : 1;
  } else if (!opts.jsonCollect && (!report.ok || injectionSetupFailed)) {
    process.exitCode = 1;
  }
}
