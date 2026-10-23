/**
 * 族 30 · S0（串行前置 · 只抽不改）—— **上报面**：诊断上报循环 /
 * `failOnError` 聚合 / `buildEnd` 汇总 / 输出通道选择 / **消息装配的唯一出口**。
 *
 * ## S0 的共享契约（**冻结** —— S1 / S2 / S3 / S4 只能消费，不许改签名）
 *
 * 1. **模块职责边界**：本模块只管「**诊断怎么被渲染、怎么被上报、怎么被汇总**」。
 *    - 诊断上报循环（error → `this.error` / `this.warn`；warning → `this.warn`；
 *      info → `this.info`）。
 *    - `failOnError` 聚合（返回要 `this.error` 的消息数组）。
 *    - `buildEnd` 汇总（error / warning 计数 + 汇总行）。
 *    - **输出通道选择**（Vite logger vs `console.log`）与**位置 / 消息装配的
 *      唯一出口**（`renderDiagnostic`）。
 *    - 诊断来源之一：path env 加载失败 → `nudo:env-unresolved` warning（Bug 474 面）——
 *      它是 `Diagnostic[]` 的**生产者**，与上报管道同处一个模块。
 *    - **不**含：分析范围判定（`scope.ts`）、`checkSource` 装配（`check-assembly.ts`）。
 * 2. **导出函数签名**（显式 ctx 对象，不许散参数）：
 *    - `emitDiagnostics(ctx: ReportContext, diags: Diagnostic[]): string[]`
 *      —— 返回**要 `this.error` 的消息数组**（S3 起：首条由宿主抛，其余 error
 *      在本函数内逐条 `ctx.warn` 出来 —— Bug 904）。
 *    - `renderDiagnostic(id: string, diag: Diagnostic): string`
 *      —— **位置与消息装配的唯一出口**（S3 的 982 / 987 已在此改：
 *      位置缺失 ⇒ 省略 `:line:col`；两个来源都追加 ` (<code>)`）。
 *    - `logAnalysisSummary(ctx: ReportContext, errorCount: number, warnCount: number): void`
 *      —— **走 Vite logger**（S3 已改：不再用裸 `console.log` ⇒ 受
 *      `build.logLevel` 管辖 —— Bug 1002）。
 *    - 配套件：`mergeDiagnostics(input: MergeInput): AnalysisResult`
 *      （**合并 + 噪声档过滤**的唯一落点；S3 的 899 已在此改：`off` 档
 *      **不**抹 check 门禁通道）、`viteDiagnosticsLevel`、
 *      `envUnresolvedDiagnostics`、`renderCheckFailure`、`renderAnalysisFailure`。
 * 3. **零新增公共导出**：本模块只被 `./index.ts` **相对 import**，
 *    **一律不许**从 `index.ts` re-export ⇒ 打包面（`tsup src/index.ts`）零变化。
 * 4. **`configResolved` 惰性落点**：与本模块无关（落在 `scope.ts`）。
 * 5. **守卫与早退落点**：与 `scope.ts` 的三处早退**互不重叠** —— 本模块
 *    只在「已决定分析」之后做事；check 管线崩溃的收口在 `check-assembly.ts`，
 *    其消息装配在本模块（`renderCheckFailure`）。
 * 6. **行为等价证据**：改前（HEAD 只读副本）/ 改后（工作树）用同一批夹具
 *    （`tmp/probe/fix-r80/fx/**`）跑 `transform` 逐字对拍 —— 见
 *    `tmp/probe/fix-r92/s0/before.txt` / `after.txt`（`diff` 为空）。
 */
import {
  analysisConfig,
  collectEnvNames,
  filterDiagnosticsByLevel,
  findProjectConfig,
  getPathEnvLoadErrors,
  type AnalysisResult,
  type Diagnostic,
  type DiagnosticsLevel,
} from "@nudojs/service";
import { dirname, resolve as resolvePath } from "node:path";
import { DIAG } from "@nudojs/core/internal";

/**
 * 上报上下文（**显式 ctx 对象**）：承载「上报到哪儿」与「按什么档位上报」。
 * 由 `index.ts` 在钩子里从 vite 的插件上下文装配。
 */
export type ReportContext = {
  /** 当前模块 id（位置渲染用）。 */
  id: string;
  /** error 级诊断是否让构建失败（`failOnError` 选项）。 */
  failOnError: boolean;
  /** vite 的 `this.warn`。 */
  warn: (msg: string) => void;
  /** vite 的 `this.error`（真实宿主里会抛）。 */
  error: (msg: string) => void;
  /** vite 的 `this.info`（宿主不提供时为 `undefined`）。 */
  info?: (msg: string) => void;
};

/** 合并输入（`mergeDiagnostics` 的显式 ctx）。 */
export type MergeInput = {
  /** 当前模块 id（噪声档按文件查项目配置）。 */
  id: string;
  /** evaluator 面（`analyzeFileAsync`）的分析结果。 */
  result: AnalysisResult;
  /** check 门禁面（L1 / L2）的诊断。 */
  checkDiagnostics: Diagnostic[];
  /** path env 加载失败面（`nudo:env-unresolved`）的诊断。 */
  envDiagnostics: Diagnostic[];
};

/**
 * 位置装配（**Bug 982** 的唯一落点）：`<id>[:<line>:<col>]`。
 *
 * 「无源位置」在上游有两种表达法，**都**不是真位置：
 * - service 的占位 range `{line: 0, column: 0}`（指令文法诊断 / mock 绑定失败等）
 * - core 的返回契约类 issue **干脆不带** `line`（本层拿到的是 `0` 或 `undefined`）
 * ⇒ `line <= 0`（或非有限数 / 缺失）一律**省略 `:line:col`**：
 * 既不写越界的 `:0:0`，也不**编造**第 1 行（`:1:0`）。
 * 与 CLI 人类面同口径（`core/src/algebra/check-report.ts`：
 * `const loc = i.line != null ? \`L${i.line}\` : ""` ⇒ 无位置就不打位置）。
 */
function renderLocation(id: string, diag: Diagnostic): string {
  const start = diag.range?.start;
  const line = start?.line;
  if (typeof line !== "number" || !Number.isFinite(line) || line <= 0) return id;
  const column = start?.column;
  const col = typeof column === "number" && Number.isFinite(column) ? column : 0;
  return `${id}:${line}:${col}`;
}

/** 正则元字符转义（诊断码里含 `:` 等非字母数字字符）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 消息装配（**Bug 987** 的唯一落点）：`<message> (<code>)`。
 *
 * 两个诊断来源（evaluator 面 / check 面）**同款**在消息尾部追加 ` (<code>)`
 * ⇒ 同一次构建只有**一种**文本格式（此前 evaluator 面直接用 `diag.message`，
 * `diag.code` 从不被读 ⇒ 码恒丢 ⇒ 日志里「一半带码、一半不带码」，
 * `grep '(nudo:'` 只能捞到一半）。
 *
 * 尾部**已自带**同码时（check 面 `check-assembly.ts` 仍自拼 ` · (<code>)`）：
 * **剥掉**它再由本层统一追加 ⇒ 两种来源的分隔符也归一（不出现
 * `(nudo:x) … (nudo:x)`，也不出现「一个空格、一个 ` · `」的两种写法）。
 */
function renderMessage(diag: Diagnostic): string {
  const code = diag.code;
  if (!code) return diag.message;
  const suffix = `(${code})`;
  const tail = new RegExp(`(?:\\s*·)?\\s*${escapeRegExp(suffix)}\\s*$`);
  if (tail.test(diag.message)) {
    return `${diag.message.replace(tail, "")} ${suffix}`;
  }
  // 码出现在消息中段（非尾部）⇒ 不重复追加
  if (diag.message.includes(suffix)) return diag.message;
  return `${diag.message} ${suffix}`;
}

/**
 * 位置与消息装配的**唯一出口**（S3 的 982「无位置不写 `:line:col`」与
 * 987「两种文本格式统一」都在此改）。
 *
 * S0 = 与重构前**逐字一致**：`[nudo] <id>:<line>:<col> <severity>: <message>`。
 * **S3 之后**：`[nudo] <id>[:<line>:<col>] <severity>: <message> (<code>)`
 * —— 位置缺失时省略 `:line:col`（Bug 982）；诊断带码时在消息尾部统一追加
 * ` (<code>)`（Bug 987，无码的诊断则不加）。
 */
export function renderDiagnostic(id: string, diag: Diagnostic): string {
  return `[nudo] ${renderLocation(id, diag)} ${diag.severity}: ${renderMessage(diag)}`;
}

/**
 * 诊断上报循环（error / warning / info 三条通道）。
 *
 * 返回**要 `this.error` 的消息数组**（`failOnError: true` 时的 error 级诊断）。
 * S0 = 与重构前**逐字一致**：error 级在 `failOnError` 档下**只进数组**
 * （由 `index.ts` 抛首条 ⇒ Bug 904 留给 S3 在本函数内改）。
 *
 * **S3 之后（Bug 904）**：`failOnError` 档下**首条** error 由宿主
 * `this.error(fatal[0])` 抛出（红构建），**其余 error 级诊断逐条 `this.warn`
 * 出来**——不许静默丢弃（此前只留首条 ⇒ 摘要说「2 error(s)」而报错只有 1 条，
 * 第二条诊断在构建日志里**一条都没出现**，用户无从定位）。
 */
export function emitDiagnostics(ctx: ReportContext, diags: Diagnostic[]): string[] {
  const fatal: string[] = [];
  for (const diag of diags) {
    const msg = renderDiagnostic(ctx.id, diag);
    if (diag.severity === "error") {
      if (ctx.failOnError) {
        fatal.push(msg);
      } else {
        ctx.warn(msg);
      }
    } else if (diag.severity === "warning") {
      ctx.warn(msg);
    } else if (diag.severity === "info") {
      // info 级走 vite 的 info 通道（**不**混进 warn 流）——
      // 与 LSP 面的 Information 档同语义（Bug 779：verbose 档下
      // `nudo:assume-relied` / `nudo:opaque-result` 等信息类诊断
      // 必须上屏，但不得冒充 warning 污染构建日志的告警流）。
      if (typeof ctx.info === "function") ctx.info(msg);
    }
  }
  // Bug 904：其余 error 级诊断逐条 warn（首条留给宿主的 this.error 抛）。
  // 摘要计数（buildEnd 按全部诊断算）与实际上报条数因此**一致**：
  // N 条 error ⇒ 1 条 this.error（构建失败）+ (N-1) 条 this.warn。
  for (const msg of fatal.slice(1)) ctx.warn(msg);
  return fatal;
}

/**
 * check 管线崩溃消息（`check-assembly.ts` 的 `failure` 字段）的装配。
 * S0 = 与重构前**逐字一致**：`[nudo] <failure>`。
 */
export function renderCheckFailure(failure: string): string {
  return `[nudo] ${failure}`;
}

/**
 * 分析通道崩溃消息的装配（`transform` 的兜底 `catch`）。
 * S0 = 与重构前**逐字一致**：`[nudo] Failed to analyze <id>: <message>`。
 */
export function renderAnalysisFailure(id: string, message: string): string {
  return `[nudo] Failed to analyze ${id}: ${message}`;
}

/**
 * 构建期噪声档：
 * - 项目显式 `nudo.analysis.diagnostics` 优先（与 LSP 同源）。
 * - 有 project config 时跟随 `analysisConfig`（与 LSP 默认档对齐：
 *   mode=directives→errors，exports/all→default）。
 * - 无 project config 时保留 vite 历史默认 `default`（error+warning），
 *   避免 ad-hoc 文件构建日志被 directives→errors 整档抹掉 warning。
 */
export function viteDiagnosticsLevel(id: string): DiagnosticsLevel {
  const proj = findProjectConfig(dirname(id));
  const raw = proj?.config?.analysis?.diagnostics;
  if (
    raw === "off" ||
    raw === "errors" ||
    raw === "default" ||
    raw === "verbose"
  ) {
    return raw;
  }
  if (proj) return analysisConfig(proj.config).diagnostics;
  return "default";
}

/**
 * 合并三个诊断来源 + 噪声档过滤（**合并与过滤的唯一落点** ⇒ S3 的 899 在此改：
 * check 门禁诊断不该被 `off` 档一起抹掉）。
 *
 * S0 = 与重构前**逐字一致**（先合并三个来源，再整体过 `filterDiagnosticsByLevel`）。
 *
 * **S3 之后（Bug 899）—— 插件侧分两条通道**（不改 service 的
 * `filterDiagnosticsByLevel` 签名）：
 * - **门禁通道** = check 面（`checkSource`）的 **error 级**诊断
 *   （L1 `nudo:constraint-violated` / L2 `nudo:entry-may-throw` …）。
 *   它是**构建门禁**，**不参与** `off` 档静音 ⇒ `off` 档下
 *   `failOnError: true` **仍然抛**（CI 不再假绿）。
 * - **显示通道** = evaluator 面 + env 面 + check 面的 warning / info 级
 *   ⇒ 照旧整体过 `filterDiagnosticsByLevel`（`off` 档 = 显示路径全静音）。
 *
 * **判定式**：`isGate(d) = d 来自 check 面 && d.severity === "error"`。
 * 其它档位（errors / default / verbose）口径**不变**（合并顺序仍是
 * evaluator → check → env）。
 */
export function mergeDiagnostics(input: MergeInput): AnalysisResult {
  const level = viteDiagnosticsLevel(input.id);
  if (level === "off") {
    // off 档：显示通道全静音；门禁通道（check 面的 error 级诊断）保留。
    return {
      ...input.result,
      diagnostics: input.checkDiagnostics.filter((d) => d.severity === "error"),
    };
  }
  return {
    ...input.result,
    diagnostics: filterDiagnosticsByLevel(
      [...input.result.diagnostics, ...input.checkDiagnostics, ...input.envDiagnostics],
      level,
    ),
  };
}

/**
 * path env 加载失败 → `nudo:env-unresolved` warning（Bug 474）。
 *
 * path-env 的失败信息只存在于 service `getPathEnvLoadErrors` 这一个旁路
 * 收集器里；CLI check / CLI test / LSP 都订阅了它，**vite-plugin 从未订阅**
 * ⇒ `@nudo:env ./missing.js` 加载失败零诊断：env 静默不生效，该 env 提供的
 * 全局退化成 unknown / 宿主真身，而构建日志里没有任何一行提示。
 *
 * 与 CLI / LSP 同源同码同文案（`path env failed to load: <path> — <error>`）：
 * - 只报**本文件** env 名单解析出的路径（env 项被移除后进程级错误表里的
 *   陈旧条目不得继续误报）——与 LSP `envUnresolvedDiags` 同口径；
 * - `seen` 去重：同 baseDir 多文件构建时同一条失败只报一次。
 */
export function envUnresolvedDiagnostics(
  id: string,
  code: string,
  seen: Set<string>,
): Diagnostic[] {
  let envNames: string[];
  try {
    envNames = collectEnvNames(id, code, true);
  } catch {
    // env 名单解析失败不拖垮构建（分析器自身已 fail-closed）
    return [];
  }
  if (envNames.length === 0) return [];
  const baseDir = dirname(id);
  // preloadPathEnvs 记录的 path = resolve(baseDir, name)——同式过滤陈旧条目
  const candidates = new Set(envNames.map((n) => resolvePath(baseDir, n)));
  // **按名字**发的诊断（未知 env 名 / 非字符串 env 项）记录的 path 是
  // **名字本身**（不是解析后的路径）——只按 candidates 过滤 ⇒ 这类条目
  // 永远匹配不上 ⇒ 构建日志里零诊断（与 LSP 面同一个洞，#470/#937）。
  // 按**本文件自己的 env 名单**匹配 ⇒ 同目录别的文件的无 path 诊断
  // 不会误吸进来（getPathEnvLoadErrors(baseDir) 已按 baseDir 收窄）。
  const byName = new Set<string>(envNames);
  for (const raw of envNames as unknown[]) {
    if (typeof raw === "string") continue;
    const rendered = JSON.stringify(raw);
    if (typeof rendered === "string") byName.add(rendered);
  }
  const diags: Diagnostic[] = [];
  for (const e of getPathEnvLoadErrors(baseDir)) {
    if (!candidates.has(e.path) && !byName.has(e.path)) continue;
    const key = `${e.baseDir}\0${e.path}\0${e.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diags.push({
      severity: "warning",
      // 文案 = CLI check/test 面的同一句 + 诊断码后缀（与本插件 check 面诊断
      // 的既有格式一致：`(nudo:xxx)` 随行可见——构建日志是纯文本面，不带码
      // 等于把「env 静默不生效」这条线索又藏回诊断对象里）。
      message: `path env failed to load: ${e.path} — ${e.error} (${DIAG.envUnresolved})`,
      code: DIAG.envUnresolved,
      range: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
    });
  }
  return diags;
}

/**
 * 构建汇总行（Single named sink for the build-summary line — keeps it
 * greppable / swappable）。
 *
 * **S3 之后（Bug 1002）**：汇总行走 **Vite logger**（`ctx.info` → `ctx.warn`），
 * **不再用裸 `console.log`** ⇒ 汇总行**受 `build.logLevel` 管辖**：
 * `logLevel: "silent"` 下**什么都不输出**（含汇总行）——此前汇总行逃出该契约，
 * 静默档下只剩「报数、不给诊断」的一行（用户被告知有 N 个 error，却拿不到
 * 任何位置与理由）。
 *
 * ⚠ **宿主兜底**：`ctx.info` 可能不存在（裸 ctx 宿主 / 旧版 vite）⇒ 逐级
 * 降级到 `ctx.warn`；两者都没有时**静默丢弃**（**不**逃逸回 `console.log`，
 * 否则 1002 的契约就破了）。签名（含 `ctx` 首参）按 S0 契约冻结 ⇒ 只改体。
 */
export function logAnalysisSummary(
  ctx: ReportContext,
  errorCount: number,
  warnCount: number,
): void {
  const summary = `[nudo] Analysis complete: ${errorCount} error(s), ${warnCount} warning(s)`;
  if (typeof ctx.info === "function") {
    ctx.info(summary);
    return;
  }
  if (typeof ctx.warn === "function") {
    ctx.warn(summary);
    return;
  }
}
