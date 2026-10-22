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
 * **本模块是那份并入逻辑的落点**：三面都调它 ⇒ 不再分叉。
 *
 * 与 CLI 的既有实现保持**逐字同源**（并入顺序：指令文法 → mock 装载 →
 * env 未解析；severity / code / message / suggestion 文案逐字一致）。
 */
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
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
 * mock 装载失败 → CheckIssue。
 *
 * 表达式认不出（mockInvalid）= **指令被忽略**（mock 不生效），按文档是
 * warning（reference/diagnostics.md#nudo-mock-invalid「Warning」；
 * guides/check.md 诊断表「nudo:mock-invalid | engine | warning」）；
 * mock 文件缺失 / 加载失败（moduleMissing）才是 error。
 */
export function mockFromErrorIssues(mockFromErrors: MockFromError[]): CheckIssue[] {
  return mockFromErrors.map((fe) => {
    const isExpr = fe.code === DIAG.mockInvalid;
    return {
      severity: isExpr ? ("warning" as const) : ("error" as const),
      code: (fe.code ?? DIAG.moduleMissing) as string,
      message: fe.message,
      suggestion: isExpr
        ? "Fix the @nudo:mock expression (constraint builders, literals, or arrow functions)"
        : `Create the mock file or fix the path in @nudo:mock ${fe.name} from "${fe.fromPath}"`,
    };
  });
}

/** path env 加载失败告警码（live 瞬态：每轮 preloadPathEnvs 现场收集）。 */
export const ENV_UNRESOLVED_CODE = DIAG.envUnresolved;

/**
 * path env 未解析 → CheckIssue（warning）。
 *
 * 两条来源合并去重（同一 path+error 只报一条）：
 * 1. **进程级 live 记录**（`getPathEnvLoadErrors`）——宿主 preload 过 path env
 *    时可见（CLI check 路径 / LSP 编辑器面都 preload）；
 * 2. **同步可见的缺失文件**——同步入口（agent 工具面不 await preload）看不到
 *    ①，此时按同一文案补齐：path 形 env（`./x.mjs` / `../x.mjs` / `a/b.mjs`）
 *    解析后不存在 ⇒ `path env not found: <resolved>`。
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
  for (const e of getPathEnvLoadErrors(baseDir)) push(e);
  for (const e of missingPathEnvs(filePath, source, baseDir)) push(e);
  return out;
}

/** path 形 env 指向的文件不存在（同步可见的那一半）。 */
function missingPathEnvs(
  filePath: string,
  source: string,
  baseDir: string,
): Array<{ path: string; error: string }> {
  let names: string[];
  try {
    names = collectEnvNames(filePath, source, true);
  } catch {
    return [];
  }
  const out: Array<{ path: string; error: string }> = [];
  for (const name of names) {
    if (typeof name !== "string") continue;
    // path 形 env：含 "/"（含 "./" / "../" 前缀）——内建名（es/web/node）不是 path 形
    if (!name.includes("/")) continue;
    const resolved = resolvePath(baseDir, name);
    if (existsSync(resolved)) continue;
    out.push({ path: resolved, error: `path env not found: ${resolved}` });
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
