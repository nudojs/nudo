/**
 * check 报告的**补充诊断通道**（CLI / LSP 编辑器面 / agent 工具面共用同一份实现）。
 *
 * 背景（Bug 752 / 991）：core 的 `checkSource` 只产出**门禁面**诊断；另有三类
 * 诊断在**旁路通道**里产生，宿主必须显式并进报告：
 *
 * 1. 指令文法诊断（`nudo:directive-syntax`）——parser 的 `extractDirectives`
 *    与 service 的 `collectEvalReplacements` 把诊断写进**调用方自备**的
 *    `diags` 数组，不会流进 `checkSource` 的返回值；
 * 2. mock 装载失败（`nudo:module-missing` / `nudo:mock-invalid`）——求值
 *    通道的旁路产物；
 * 3. path env 加载失败（`nudo:env-unresolved`）——service **进程级 live 状态**
 *    （`getPathEnvLoadErrors`），既不是 `checkSource` 的入参也不是其返回值。
 *
 * CLI（`packages/nudojs/src/commands/check.ts`）与 LSP 编辑器面
 * （`packages/lsp/src/validation.ts`）曾各手写一份并入逻辑，agent 工具面
 * （`packages/lsp/src/agent-tools.ts` 的 `checkTool`）**一份都没有** ⇒ 同一
 * 文件三个面给出三份 issue 集（agent 面把「指令写错了」整条吞掉）。
 *
 * **本模块是那份并入逻辑的落点**：三个宿主面都调它 ⇒ 不再分叉；CLI 侧原有的
 * 私有副本（`mockFromErrorIssues` / `directiveDiagIssues` / `mergeCheckIssues`）
 * 已删除，改为直接 import 本模块。
 *
 * 并入顺序（指令文法 → mock 装载 → env 未解析）与 severity / code / message
 * 逐字口径是三面共用的事实；mock 装载失败的 suggestion 按**错误种类**细分
 * （重复声明 / 导出名缺失 / 表达式解析失败 / 文件缺失，见
 * {@link mockFromErrorSuggestion}）。
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { type CheckIssue } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import {
  extractDirectives,
  extractFileDirectives,
  parse,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "@nudojs/parser";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";
import { collectEnvNames } from "./analyzer-orchestrate-calls.ts";
import { collectEvalReplacements } from "./eval-run.ts";
import { findProjectConfig } from "./evaluator/config.ts";
import { getPathEnvLoadErrors } from "./evaluator/env-loader.ts";
import { applyMockModuleDirectivesFromSource } from "./mock-module.ts";
import { mockDirectivesToAbsSeeds } from "./mock-abs.ts";
import type { LoadModule } from "./load-module.ts";

/** check 报告的最小可并入形状（`CheckReport` / `CheckJson` 都满足）。 */
export type Summarized = {
  issues: CheckIssue[];
  ok: boolean;
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/** 追加 issues 并同步 summary/ok（有新 error 则 ok=false）。 */
export function mergeCheckIssues<T extends Summarized>(report: T, issues: CheckIssue[]): T {
  if (issues.length === 0) return report;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  return {
    ...report,
    issues: [...report.issues, ...issues],
    ok: report.ok && errors === 0,
    summary: {
      ...report.summary,
      errors: report.summary.errors + errors,
      warnings: report.summary.warnings + warnings,
      infos: report.summary.infos + infos,
    },
  };
}

/** D1: 指令文法诊断（nudo:directive-syntax）→ CheckIssue（warning，不挡 exit）。 */
export function directiveDiagIssues(
  diags: Array<{ code: string; message: string }>,
): CheckIssue[] {
  return diags.map((d) => ({
    severity: "warning" as const,
    code: d.code,
    message: d.message,
    suggestion: "Fix the directive syntax (see docs/reference/diagnostics.md)",
  }));
}

/** `@nudo:mock name from "path"` 解析失败（缺文件/缺绑定/求值失败）。 */
export type MockFromError = {
  name: string;
  fromPath: string;
  message: string;
  code?: string;
};

/**
 * mock 装载失败的**种类**（决定 suggestion 文案）。
 *
 * - `duplicate`：mock-module **重复声明**（同一 specifier 两条指令）
 * - `missing-export`：mock 文件**没有导出**被点名的那个名字
 * - `expression`：`@nudo:mock` 内联**表达式**解析失败
 * - `missing-file`：mock **文件**缺失 / 装载失败
 */
type MockFromErrorKind = "duplicate" | "missing-export" | "expression" | "missing-file";

/**
 * 重复声明族 message 前缀（`mock-module.ts`：
 * `Duplicate @nudo:mock-module directive for "…" — …`）。
 */
const MOCK_MODULE_DUPLICATE_PREFIX = "Duplicate @nudo:mock-module directive";

/**
 * 点名缺失族 message 形状（`mock-module.ts`：`Mock module "…" does not export "…"`）
 * —— 捕获组 1 = 缺失的导出名。
 */
const MOCK_MODULE_MISSING_EXPORT_RE = /does not export "([^"]+)"/;

/**
 * mock 错误 → 种类。
 *
 * 码只能分出「表达式认不出」（mock-invalid）与其余（module-missing）两族；
 * **重复声明**与**表达式解析失败**同码（都是 mock-invalid）⇒ 用 message 族区分。
 */
function mockFromErrorKind(fe: MockFromError): MockFromErrorKind {
  if (fe.message.startsWith(MOCK_MODULE_DUPLICATE_PREFIX)) return "duplicate";
  if (fe.code === DIAG.mockInvalid) return "expression";
  if (MOCK_MODULE_MISSING_EXPORT_RE.test(fe.message)) return "missing-export";
  return "missing-file";
}

/**
 * 种类 → 贴切的 suggestion 文案（每族一句，指向该族的**修法**）。
 *
 * 「重复声明」与「导出名缺失」原先都落到通用句（提示与事实不符 ⇒ 提示无用）：
 * - 重复声明 ⇒ 让用户**只保留一条**声明；
 * - 导出名缺失 ⇒ 点名那个缺失的导出（mock 文件在，只是没导出它）。
 */
function mockFromErrorSuggestion(fe: MockFromError, kind: MockFromErrorKind): string {
  switch (kind) {
    case "duplicate":
      return "Remove the duplicate @nudo:mock-module declaration — keep only one directive per module specifier";
    case "missing-export": {
      const name = MOCK_MODULE_MISSING_EXPORT_RE.exec(fe.message)?.[1];
      return name
        ? `Add "${name}" to the mock file "${fe.fromPath}", or drop it from the @nudo:mock-module directive`
        : `Add the missing export to the mock file "${fe.fromPath}", or drop it from the @nudo:mock-module directive`;
    }
    case "expression":
      return "Fix the @nudo:mock expression (constraint builders, literals, or arrow functions)";
    case "missing-file":
      return `Create the mock file or fix the path in @nudo:mock ${fe.name} from "${fe.fromPath}"`;
  }
}

/**
 * mock 装载失败 → CheckIssue。
 *
 * 表达式认不出（mockInvalid）= **指令被忽略**（mock 不生效），按文档是
 * warning（reference/diagnostics.md#nudo-mock-invalid「Warning」；
 * guides/check.md 诊断表「nudo:mock-invalid | engine | warning」）；
 * mock 文件缺失 / 加载失败（moduleMissing）才是 error。
 *
 * suggestion 按**错误种类**给（见 {@link mockFromErrorSuggestion}）：重复声明 /
 * 导出名缺失 / 表达式解析失败 / 文件缺失 四族各有各的修法。
 */
export function mockFromErrorIssues(mockFromErrors: MockFromError[]): CheckIssue[] {
  return mockFromErrors.map((fe) => {
    const isExpr = fe.code === DIAG.mockInvalid;
    return {
      severity: isExpr ? ("warning" as const) : ("error" as const),
      code: (fe.code ?? DIAG.moduleMissing) as string,
      message: fe.message,
      suggestion: mockFromErrorSuggestion(fe, mockFromErrorKind(fe)),
    };
  });
}

/** path env 加载失败告警码（live 瞬态：每轮 preloadPathEnvs 现场收集）。 */
export const ENV_UNRESOLVED_CODE = DIAG.envUnresolved;

/**
 * env 名的**解析基准**分层（两层口径，与 CLI `assembleEnvs` 同源）。
 *
 * Bug 647（重犯 Bug 1081）：`package.json#nudo.env` 是**项目级**（文档承诺
 * 「项目里每个文件都用它」）⇒ 相对说明符按**项目根**解析；`/// @nudo:env`
 * 是**文件级** ⇒ 按**被分析文件所在目录**解析。旧实现把两者一律按文件目录
 * 解析 ⇒ ① 项目级 env 明明存在却被报成「找不到」（假阳）；② 项目级 env 的
 * **真实加载失败**记在项目根基准下、按文件目录取不到 ⇒ 被静默丢弃（假阴）。
 */
type EnvTier = {
  /** env 名（原始拼写） */
  names: string[];
  /** 该层的解析基准目录 */
  baseDir: string;
};

/** 项目级 env 名（`package.json#nudo.env`）——按项目根解析。 */
function projectEnvTier(filePath: string, fileBaseDir: string): EnvTier | null {
  const proj = findProjectConfig(dirname(filePath));
  const names = proj?.config.env;
  if (!Array.isArray(names) || names.length === 0) return null;
  return {
    names: names.filter((n): n is string => typeof n === "string"),
    // 项目根；找不到项目配置时退回文件级基准（与 CLI 的
    // `proj?.projectDir ?? fileEnvBaseDir` 同口径）。
    baseDir: proj?.projectDir ?? fileBaseDir,
  };
}

/** 文件级 env 名（`/// @nudo:env`）——按被分析文件所在目录解析。 */
function fileEnvTier(filePath: string, source: string, fileBaseDir: string): EnvTier | null {
  let names: string[];
  try {
    names = collectEnvNames(filePath, source, false);
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  return { names, baseDir: fileBaseDir };
}

/** 两层 env 基准（项目级 → 文件级）。 */
function envTiers(filePath: string, source: string, fileBaseDir: string): EnvTier[] {
  const tiers: EnvTier[] = [];
  const project = projectEnvTier(filePath, fileBaseDir);
  if (project) tiers.push(project);
  const file = fileEnvTier(filePath, source, fileBaseDir);
  if (file) tiers.push(file);
  return tiers;
}

/** 本文件**真正请求过**的 env 解析路径（两层并集）。 */
function expectedEnvPaths(tiers: EnvTier[]): Set<string> {
  const out = new Set<string>();
  for (const tier of tiers) {
    for (const name of tier.names) out.add(resolvePath(tier.baseDir, name));
  }
  return out;
}

/**
 * path env 未解析 → CheckIssue（warning）。
 *
 * 两条来源合并去重（同一 path+error 只报一条）：
 * 1. **进程级 live 记录**（`getPathEnvLoadErrors`）——宿主 preload 过 path env
 *    时可见（CLI check 路径 / LSP 编辑器面都 preload）；按**两层基准**取并集
 *    （项目级 env 的加载失败记在**项目根**基准下——只按文件目录取会把它丢掉）；
 * 2. **同步可见的缺失文件**——同步入口（agent 工具面不 await preload）看不到
 *    ①，此时按同一文案补齐：path 形 env（`./x.mjs` / `../x.mjs` / `a/b.mjs`）
 *    解析后不存在 ⇒ `path env not found: <resolved>`。
 *
 * `baseDir` = **文件级** env 的解析基准（缺省 = 被分析文件所在目录）；
 * 项目级 env 的基准由项目配置推导（项目根）——两层口径见 {@link EnvTier}。
 *
 * 文案与 CLI 逐字一致：`path env failed to load: <path> — <error>`。
 */
export function envUnresolvedIssues(
  filePath: string,
  source: string,
  baseDir = dirname(filePath),
): CheckIssue[] {
  const seen = new Set<string>();
  const out: CheckIssue[] = [];
  const push = (e: { path: string; error: string }): void => {
    const key = `${e.path}\u0000${e.error}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      severity: "warning" as const,
      code: ENV_UNRESOLVED_CODE,
      message: `path env failed to load: ${e.path} — ${e.error}`,
    });
  };
  const tiers = envTiers(filePath, source, baseDir);
  // ① 进程级 live 记录（预载时已出错的 env）——按**两个基准**取并集。
  const expected = expectedEnvPaths(tiers);
  for (const tier of tiers) {
    for (const e of getPathEnvLoadErrors(tier.baseDir)) {
      // 只报「本文件自己请求过」的路径：分析器通道按文件目录解析**项目级**
      // env 名 ⇒ 会在文件目录下留下一条本文件从未请求过的路径；报它 = 事实
      // 相反的假阳（与 CLI 的 expectedEnvPaths 过滤同口径）。
      // 非绝对路径 = 「未知 env 名 / 非法条目」这类按名记录的错 ⇒ 一律保留。
      if (isAbsolute(e.path) && !expected.has(e.path)) continue;
      push(e);
    }
  }
  // ② 同步可见的缺失文件（尚未被任何预载尝试过的 path env）。
  for (const e of missingPathEnvs(tiers)) push(e);
  return out;
}

/** path 形 env 指向的文件不存在（同步可见的那一半）——基准按层取。 */
function missingPathEnvs(tiers: EnvTier[]): Array<{ path: string; error: string }> {
  const out: Array<{ path: string; error: string }> = [];
  for (const tier of tiers) {
    for (const name of tier.names) {
      if (typeof name !== "string") continue;
      // path 形 env：含 "/"（含 "./" / "../" 前缀）——内建名（es/web/node）不是 path 形
      if (!name.includes("/")) continue;
      const resolved = resolvePath(tier.baseDir, name);
      if (existsSync(resolved)) continue;
      out.push({ path: resolved, error: `path env not found: ${resolved}` });
    }
  }
  return out;
}

/** 补充诊断通道的采集选项。 */
export type CheckSupplementOptions = {
  /** 宿主已算好的模块图（缺省现场算一次——@nudo:mock-module 通道需要它）。 */
  modules?: Record<string, unknown>;
  /** buffer-aware 侧车 / 相对模块装载器（LSP 注入；缺省磁盘）。 */
  loadModule?: LoadModule;
};

/**
 * 采集三条补充诊断通道（指令文法 / mock 装载 / env 未解析）→ CheckIssue[]。
 *
 * 供 check 报告面（CLI / LSP 编辑器面 / agent 工具面）统一并入；三面共用
 * 同一份实现 ⇒ 同一文件的 issue 集不再分叉。
 */
export function collectCheckSupplementIssues(
  filePath: string,
  source: string,
  opts: CheckSupplementOptions = {},
): CheckIssue[] {
  const dirDiags: DirectiveDiag[] = [];
  // ① 指令文法诊断：三个发射源同袋（与 CLI 的 D1 段同口径）
  try {
    collectEvalReplacements(source, { diags: dirDiags });
  } catch {
    /* 解析失败：门禁面（checkSource）自行报错，不在此处造诊断 */
  }
  let mockFromErrors: MockFromError[] = [];
  try {
    const seedPkg = runWithDirectiveDiags(dirDiags, () => {
      const ast = parse(source);
      const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast), {
        fromFile: filePath,
        ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      });
      // JSDoc 块内错位的文件级指令族标签（@nudo:env / @nudo:mock-module）
      // 不再静默——纯查询 extract 落本域（提取面不变，仍只认行注释）
      extractFileDirectives(ast);
      return seeds;
    });
    mockFromErrors = [...(seedPkg.fromErrors ?? [])];
  } catch {
    /* 指令解析失败：门禁面自行报错 */
  }
  // ② @nudo:mock-module 通道（覆盖 import 说明符导出）——同样产出 from 错误
  try {
    const base = (opts.modules ?? evalAbsModuleGraph(source, filePath).modules) as Record<
      string,
      never
    >;
    const mm = applyMockModuleDirectivesFromSource(source, base, {
      fromFile: filePath,
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
    });
    mockFromErrors = [
      ...mockFromErrors,
      ...mm.errors.map((e) => ({
        name: e.name,
        fromPath: e.fromPath,
        message: e.message,
        ...(e.code !== undefined ? { code: e.code } : {}),
      })),
    ];
  } catch {
    /* 模块图不可用：mock-module 通道降级（不造诊断） */
  }
  const issues: CheckIssue[] = [];
  if (dirDiags.length > 0) issues.push(...directiveDiagIssues(dirDiags));
  if (mockFromErrors.length > 0) issues.push(...mockFromErrorIssues(mockFromErrors));
  issues.push(...envUnresolvedIssues(filePath, source));
  return issues;
}
