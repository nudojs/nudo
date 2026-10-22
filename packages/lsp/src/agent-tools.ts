/**
 * Agent-facing tool implementations. Wire/protocol names match the CLI
 * product surface from design-cli-semantics.md:
 *   signatures → `nudo check` · cases → `nudo test` · contracts → `nudo contract`
 *   projections → `nudo export` · health → `nudo health`
 * Like validation.ts, this module holds pure logic with injected readers so
 * tests exercise it without a live connection; server.ts supplies the
 * document/disk readers. Also hosts computeInterfaceLenses.
 *
 * **E5 同源契约**：agent 工具与 LSP 命令 / CLI 共享同一底层入口
 * （`AGENT_TOOL_SOURCES`）；`resolveProjectAutoBind` 保证 autoBind 与
 * CLI runCheck / LSP validate / CodeLens 同口径。测试钉住语义一致。
 */
import type { ClassDeclaration } from "@babel/types";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import {
  buildCaseDirective,
  serializeCaseJson,
  interfaceSurface,
  draftInterface,
  emitInterface,
  emitDerivedFromRoot,
  deriveFromRoot,
  formatEmitSummary,
  formatDraftSummary,
  formatInterfaceSurfaceLine,
  sidecarDraftPath,
  writeInterfaceDraft,
  type EmitInterfaceResult,
  type EmitDerivedResult,
  type CaseJson,
} from "@nudojs/service/emit";
import { getHoverAtPosition, getCasesForFile, type HoverInterfaceOpts } from "./lsp-surface.ts";
import { sanitizeErrorMessage } from "./sanitize.ts";
import {
  analyzeFile,
  analyzeFileAsync,
  findProjectConfig,
  interfaceConfig,
  checkConfig,
  collectSkipReturns,
  collectCallsiteRecords,
  isNudoTargetPath,
  // A1：check 补充诊断通道 + test 断言汇总 + 路径错误通道（自 service 共用）
  mergeCheckIssues,
  collectCheckSupplementIssues,
  buildTestReport,
  pathNotFoundError,
  targetPathError,
  formatPathErrorText,
  type CallRecord,
  type PathError,
} from "@nudojs/service";
import {
  parse,
  programBody,
  getClassMembers,
  classMemberKeyName,
  extractDirectives,
} from "@nudojs/parser";
import {
  abs,
  num,
  str,
  bool,
  formatAbs,
  formatShape,
  checkSource,
  serializeCheckJson,
  pTrue,
  formatInterfaceTierLine,
  generatedExportNames,
  interfaceDiagCount,
  interfaceTierOf,
  localNamedExports,
  isNodeModulesPath,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  extractFileEnvNames,
  type Abs,
  type AbsModuleExports,
  type InterfaceSource,
  type RunTranspiledOptions,
} from "@nudojs/core";
import type { CheckJson, CheckJsonMulti } from "@nudojs/core";
import { collectAbsInlays, DIAG } from "@nudojs/core/internal";
import { lspLoadModule, evalAnalysisModules } from "./validation.ts";
import {
  injectBindings,
  typeExprToDirective,
  type TypeBinding,
} from "@nudojs/service";
import {
  applyMockModuleDirectivesFromSource,
  collectEnvGlobals,
  collectEnvModules,
  collectEvalReplacements,
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
} from "@nudojs/service";

export { injectBindings, typeExprToDirective, type TypeBinding };

/** MCP-compatible tool result shape — keeps bridge layers zero-rewrite. */
export type AgentToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

export type AgentToolDeps = {
  /** Disk reader for files not open in the editor; defaults to readFileSync. */
  readFile?: (filePath: string) => string;
  /** Open-document lookup by absolute file path; the editor buffer wins over disk. */
  getOpenText?: (filePath: string) => { text: string } | undefined;
  /**
   * LSP client workspace folders（server 注入）。emit 写盘仅允许落在这些根内
   * （fail-closed，realpath 比较）；undefined = 无 bound（CLI/测试）。
   */
  workspaceRoots?: string[];
  /**
   * E5：与 validate/hover 同源的侧车装载（server 注入 buffer-aware loadModule）。
   * 缺省回落 lspLoadModule 读盘。
   */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/**
 * 成功面返回体（MCP 形状）：**不带** `isError`。
 *
 * 不变量（Bug 767）：语义为「失败」的返回点**必须**用 `toolError`
 * （`isError: true`）——协议层据此把工具报错与成功区分开，客户端不必
 * 解析文本猜。`textResult` 只用于真的成功（含「此处没有 X」这类
 * 合法空结果）。
 */
export function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Parse an agent-facing type expression into an Abs.
 * Ported from packages/mcp/src/tools.ts: primitive names, `|` unions,
 * everything else unknown.
 */
export function parseTypeExpr(expr: string): Abs {
  const trimmed = expr.trim();
  if (trimmed === "number") return num();
  if (trimmed === "string") return str();
  if (trimmed === "boolean") return bool();
  if (trimmed === "null") return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
  if (trimmed === "undefined") return abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
  if (trimmed === "bigint") return abs({ k: "prim", type: "bigint" }, undefined, undefined, "exact");
  if (trimmed === "symbol") return abs({ k: "prim", type: "symbol" }, undefined, undefined, "exact");
  if (trimmed.includes("|")) {
    const members = trimmed.split("|").map(parseTypeExpr);
    if (members.length === 1) return members[0]!;
    return abs({ k: "sum", members }, undefined, undefined, "exact");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * Normalize a `file` parameter: strips and percent-decodes a `file://` prefix
 * (mirrors validation.ts uriToFilePath), then resolves to an absolute path.
 *
 * **共用入口闸（Bug 955）**：`file` 非法（非字符串 / 空串 / 缺失）时
 * - 不得让裸 JS TypeError（`file.startsWith is not a function`）当工具文案
 *   回给客户端（那是引擎实现细节，不是可诊断信息）；
 * - 不得回落服务器 cwd 建「幽灵条目」（`resolve("")` ⇒ cwd）。
 *
 * ⇒ 统一抛 `TypeError`；各工具的 catch 转成结构化工具错误
 * （`isError: true`，文案 `file is required …`——与 `server-commands.ts`
 * 的 `FILE_REQUIRED` 同款）。A1/A2/A5 的工具都走本入口 ⇒ 一处改，全覆盖。
 */
export function normalizeFilePath(file: string): string {
  if (typeof file !== "string" || file.trim() === "") {
    throw new TypeError("file is required (a non-empty path or file:// URI)");
  }
  const path = file.startsWith("file://") ? decodeURIComponent(file.slice(7)) : file;
  return resolve(path);
}

function tryRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

/**
 * 目标是否落在 root 内（**按路径分量**判定逃逸）。
 *
 * Bug 766：`relative()` 返回的是**相对路径字符串**——「向上逃逸」的判据是
 * 「整段等于 `..`」或「以 `..` + 分隔符开头」，**不是**裸 `startsWith("..")`：
 * 后者把 `..dotted.js` / `...triple.js` / `..cfg/x.js` 这类**合法**相对路径
 * 误判成逃逸 ⇒ IDE 拒绝对合法文件写侧车（CLI 侧却接受）。
 *
 * - `rel === ""`：目标就是 root 本身 ⇒ 不算「在 root 内」（root 是目录，
 *   不是可写侧车的源文件）。
 * - `isAbsolute(rel)`：跨盘（Windows）⇒ 逃逸。
 */
function pathInsideRoot(root: string, filePath: string): boolean {
  const rel = relative(root, filePath);
  if (rel === "" || isAbsolute(rel)) return false;
  if (rel === "..") return false;
  return !rel.startsWith(`..${sep}`);
}

/**
 * emit 路径边界：目标必须是可分析的 JS/TS 源（非侧车契约模块本身），
 * 不得落在 node_modules（含侧车路径），且在提供 workspaceRoots 时必须
 * 落在某个 root 内（realpath 防符号链接逃逸）。
 *
 * - workspaceRoots === undefined：CLI/无 bound 场景，只做类型/node_modules 检查。
 * - workspaceRoots 提供（含空数组）：LSP agent 写盘，fail-closed——没有任何
 *   root 能包含目标就拒；不回落到 findProjectConfig 祖先 package.json
 * （那会把 workspace 外的项目根误当成授权根）。
 */
export function assertEmitTargetAllowed(
  filePath: string,
  workspaceRoots?: string[],
): string | undefined {
  if (!isNudoTargetPath(filePath)) {
    return `Error: '${filePath}' is not an analysis target (.js/.mjs/.ts required; sidecar contract modules cannot be emit targets)`;
  }
  if (isNodeModulesPath(filePath) || isNodeModulesPath(sidecarPathOf(filePath))) {
    return `Error: '${filePath}' is inside node_modules; emit never writes contract sidecars there`;
  }
  if (workspaceRoots === undefined) return undefined;

  const realFile = tryRealpath(filePath) ?? filePath;
  const roots = resolvedWorkspaceRoots(workspaceRoots);
  // fail-closed：有 bound 却没有任何可用 root（或 root 不含目标）→ 拒
  if (roots.length === 0) {
    return `Error: emit requires at least one workspace root; '${filePath}' cannot be authorized`;
  }
  const ok = roots.some((root) => pathInsideRoot(root, realFile));
  if (!ok) {
    return `Error: '${filePath}' is outside allowed roots (${roots.join(", ")})`;
  }
  return undefined;
}

/**
 * workspace roots 归一（realpath + 去重）——emit 写盘边界的唯一 root 口径。
 * 空数组 = 有 bound 但无可用 root ⇒ fail-closed（调用方须拒）。
 */
function resolvedWorkspaceRoots(workspaceRoots: string[]): string[] {
  const roots: string[] = [];
  for (const r of workspaceRoots) {
    const abs = resolve(r);
    const real = tryRealpath(abs) ?? abs;
    if (!roots.includes(real)) roots.push(real);
  }
  return roots;
}

/**
 * 下游侧车（root 驱动推导写出的侧车）的写盘边界——与本地侧车**同口径**：
 * 必须落在某个 workspace root 内。root 驱动推导会写**别的文件**的侧车，
 * 没有这道闸 ⇒ agent 能借根文件的 import 图把契约写进工作区之外。
 *
 * - workspaceRoots === undefined：无 bound 场景（CLI/测试）⇒ 不限制。
 * - 提供（含空数组）：fail-closed（空 root 列表 ⇒ 一律不许写）。
 */
function derivedSidecarAllowed(sidecarPath: string, workspaceRoots?: string[]): boolean {
  if (workspaceRoots === undefined) return true;
  const roots = resolvedWorkspaceRoots(workspaceRoots);
  if (roots.length === 0) return false;
  const real = tryRealpath(sidecarPath) ?? sidecarPath;
  return roots.some((root) => pathInsideRoot(root, real));
}

/**
 * Source resolution for agent tools: open editor buffer first, disk fallback
 * (readFileSync) for files the agent changed without didOpen.
 */
export function readSource(filePath: string, deps: AgentToolDeps = {}): string {
  const open = deps.getOpenText?.(filePath);
  if (open) return open.text;
  return (deps.readFile ?? ((p: string) => readFileSync(p, "utf-8")))(filePath);
}

function analysisError(err: unknown, deps?: AgentToolDeps): AgentToolResult {
  // BUG-023：agent 工具结果回传远端 LLM 会话——
  // 原始 message 的绝对路径等于回传工作区布局，
  // 脱敏后再出（根前缀 → 占位）。G7：roots 用 server 注入的
  // workspaceRoots（扩展宿主 fork 的 cwd ≠ 工作区根，多根更无单一
  // cwd）；未注入（CLI/测试）回落 sanitize 的 [process.cwd()] 默认
  return {
    content: [
      { type: "text", text: `Error: ${sanitizeErrorMessage((err as Error).message, deps?.workspaceRoots)}` },
    ],
    isError: true,
  };
}

/**
 * 失败面返回体：MCP 风格 `isError: true` —— 协议层与成功**可区分**
 * （agent API 契约：「Tool errors carry `isError: true`」）。
 *
 * 所有「语义为失败」的返回点（参数非法 / 目标不存在 / 门禁拒绝）走这里；
 * `textResult` 只走成功面（Bug 767）。
 */
export function toolError(message: string): AgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * E5：项目级 `package.json#nudo.contract.autoBind`（与 CLI check / LSP
 * validate / CodeLens 同口径）。客户端不能借 agent 工具把项目关闭的
 * autoBind 打开——有效值 = 项目配置 AND 客户端请求。
 */
export function resolveProjectAutoBind(
  filePath: string,
  clientAutoBind?: boolean,
): boolean {
  const projectAutoBind = interfaceConfig(
    findProjectConfig(dirname(filePath))?.config,
  ).autoBind;
  return projectAutoBind && (clientAutoBind ?? true);
}

/** draft 写盘 projectDir：与 CLI runInterfaceDraft 同口径
 * （nudo 配置 → package.json 祖先，上溯到 fs root，无层级上限） */
function resolveDraftProjectDir(filePath: string): string | undefined {
  const proj = findProjectConfig(dirname(filePath));
  if (proj?.projectDir) return proj.projectDir;
  // package.json 祖先回落（与 CLI 对齐：无 nudo 配置时仍用包根约束写盘）
  let dir = dirname(filePath);
  const fsRoot = resolve("/");
  while (dir !== fsRoot) {
    const pkg = resolve(dir, "package.json");
    try {
      if (existsSync(pkg)) return dir;
    } catch {
      /* ignore */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * E5：agent 工具与 LSP 命令 / CLI 共享的数据源表（同源验收钉住此表）。
 * 任一工具改实现时必须继续消费同一底层入口，禁止旁路第二套语义。
 * test/whatIf/trace/suggestCase 将 deps.loadModule 传入分析入口
 * （buffer-aware 侧车可见）。validate/pull 的 analyzeFileAsync 同样接线。
 *
 * Bug 993：观察类工具（whatIf / suggestCase / trace）改走**异步**入口
 * `analyzeFileAsync` —— 同步 `analyzeFile` 不预载 path 型 env，工具输出
 * 会随「同一进程里谁先被调用过」变（未预载 ⇒ env 全局不可见 ⇒ never /
 * unknown）。异步入口先 `await preloadPathEnvs`，输出只取决于文件内容。
 */
export const AGENT_TOOL_SOURCES = {
  whatIf: "injectBindings + analyzeFileAsync",
  suggestCase: "analyzeFileAsync + buildCaseDirective",
  trace: "analyzeFileAsync cases",
  check: "checkSource + mergeCheckIssues + serializeCheckJson",
  hover: "getHoverAtPosition + interfaceTierOf",
  test: "analyzeFileAsync + buildTestReport + serializeCaseJson",
  contract: "interfaceSurface + formatInterfaceSurfaceLine",
  "contract.draft": "draftInterface + formatDraftSummary",
  "contract.emit": "emitInterface",
  codeLens: "computeInterfaceLenses + interfaceTierOf",
} as const;

export type CheckToolParams = {
  file: string;
  source?: string;
  /** "json" → CheckJson only；缺省人类可读摘要 + JSON */
  format?: "text" | "json";
  /** 解析 @nudo:import 的相对 .nudo.js（测试可注入） */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 测试注入；有效值与项目 autoBind AND（客户端不能打开已关闭项） */
  autoBind?: boolean;
};

/**
 * IDE 面**注入装配器**（Bug 785 / 786 的唯一装配点）。
 *
 * **为什么必须有**：CLI 的 `buildCheckInjection`
 * （`packages/nudojs/src/commands/check.ts:494-559`）把行内指令
 * （`@nudo:as` / `@nudo:replace`）与 `@nudo:mock` / env 全局装进
 * `RunTranspiledOptions`（= core 的 `inject` 通道）再交给 `checkSource` /
 * `generalizeFromAst`；**LSP 侧此前一次都没调用收集器**
 * （`collectEvalReplacements` 在 `packages/lsp/src/` 零命中）⇒ IDE 跑的
 * 不是同一份注入 ⇒ 同一文件 **CLI 绿 / IDE 红**（Bug 785 假红），
 * 且 hover / inlayHint 签名面显示 `unknown`（Nudo 词汇里 = 「推断失败」）
 * 而 CLI 显示 `number`（Bug 786）。
 *
 * **落点约束**：CLI 是产品包、LSP 是库 ⇒ **不许从 lsp 反向 import nudojs**。
 * 本函数用 service / core 已导出的装配件（`collectEvalReplacements` /
 * `mockDirectivesToAbsSeeds` / `mockSeedsToAbsMocks` / `collectEnvGlobals` /
 * `collectEnvModules` / `applyMockModuleDirectivesFromSource`）复刻
 * `buildCheckInjection` 的口径 ⇒ **零新增 core / service 导出**。
 *
 * **返回语义**：core 的 `inject` 包（`RunTranspiledOptions`）——
 * - `modules`：跨模块导出表 + env 模块 + `@nudo:mock-module` 覆盖；
 * - `mocks`：`@nudo:mock` 覆盖表（带作用域覆盖表 ⇒ 与 CLI 同款 mock 语义）；
 * - `envGlobals`：命名 env（`es` / `node` / `web`…）与项目级 env 的全局；
 * - `replacements` + `replacementTargets`：`@nudo:replace`；
 * - `asOverrides` + `asOverrideTargets`：`@nudo:as`。
 *
 * **空表不入包** ⇒ 无行内指令的文件得到 `{}`
 * （`Object.keys(inject).length === 0`）⇒ 调用方可据此判断「无需注入」。
 *
 * **传递协议**（三处消费面统一，缺 `inject` 即行内指令缺席）：
 * - 门禁面：`checkSource(file, source, pTrue, { ..., inject })`；
 * - 签名面：`generalizeFromAst(name, source, { ..., inject })`；
 * - inlay 面：`collectAbsInlays(source, { ..., inject })`。
 */
export function buildLspInjection(
  filePath: string,
  source: string,
  opts?: {
    /** buffer-aware 侧车/依赖装载（LSP 注入；缺省 service 默认装载器） */
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    /**
     * 预解析的 eval 模块图（调用方已算好时传入，避免重复求值）。
     * 缺省时按 LSP 既有口径现场求值（`evalAnalysisModules`：检出环 ⇒ 不注入图）。
     */
    modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  },
): RunTranspiledOptions {
  const loadModule = opts?.loadModule;
  // env 名单：文件级 `@nudo:env`（文本扫描，不 parse ⇒ 语法错文件也不炸）
  // ∪ 项目级 package.json#nudo.env —— 与 CLI `allEnvNames` 同口径。
  const projEnv = findProjectConfig(dirname(filePath))?.config.env;
  const projectEnvNames = Array.isArray(projEnv) ? projEnv : [];
  const envNames = [
    ...new Set([...projectEnvNames, ...extractFileEnvNames(source)]),
  ];
  const envGlobals = collectEnvGlobals(envNames);
  const envMods = collectEnvModules(envNames);
  // 模块图：调用方给了就复用（同一文件一次求值），否则现场求值
  const baseModules =
    opts?.modules ??
    evalAnalysisModules(filePath, source) ??
    undefined;
  // mock-module 覆盖的基底是**窄型**导出表（service 的
  // applyMockModuleDirectivesFromSource 签名）；LSP 侧的图类型更宽
  // （`AbsModuleExports | Record<string, unknown>`），运行期取值仍是
  // AbsModuleExports ⇒ 窄化只发生在类型层。
  let mergedMods: Record<string, AbsModuleExports> = {
    ...((baseModules ?? {}) as Record<string, AbsModuleExports>),
    ...(Object.keys(envMods).length > 0 ? envMods : {}),
  };
  // `@nudo:mock-module`：覆盖 import 说明符导出（全量/局部）
  mergedMods = applyMockModuleDirectivesFromSource(source, mergedMods, {
    fromFile: filePath,
  }).modules;
  // `@nudo:mock`：函数级 mock 覆盖表（含同函数作用域表）
  // 语法错文件 ⇒ parse 抛 ⇒ mock 表留空（**不**让装配器把整个工具打挂：
  // hover 面对语法错文件是「无 hover」而不是「工具报错」；门禁面仍由
  // checkSource 自己抛语法错 ⇒ 错误照常上屏）。
  let mocks: Record<string, Abs> = {};
  try {
    const ast = parse(source);
    mocks = mockSeedsToAbsMocks(
      mockDirectivesToAbsSeeds(extractDirectives(ast), {
        fromFile: filePath,
        ...(loadModule ? { loadModule } : {}),
      }),
    );
  } catch {
    mocks = {};
  }
  // 行内指令：`@nudo:replace` / `@nudo:as` 的覆盖表
  const reps = collectEvalReplacements(source);
  return {
    ...(Object.keys(mergedMods).length > 0 ? { modules: mergedMods } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    ...(Object.keys(envGlobals).length > 0 ? { envGlobals } : {}),
    ...(reps.targets.length > 0
      ? { replacements: reps.values, replacementTargets: reps.targets }
      : {}),
    ...(reps.asTargets.length > 0
      ? { asOverrides: reps.asValues, asOverrideTargets: reps.asTargets }
      : {}),
  };
}

/**
 * Agent 门禁工具：返回 CheckJson v1 契约（与 CLI `nudo check --json` 同构）。
 * 数据源：checkSource + serializeCheckJson；autoBind 与 CLI runCheck 同口径。
 *
 * **目标闸门（Bug 770）**：侧车契约模块（`*.nudo.js` / `*.nudo.draft.*`）、
 * 类型声明（`.d.ts`）、JSX（`.jsx` / `.tsx`）**不是分析目标**——把它们送进
 * 分析器会得到「0 个函数 ⇒ 0 error ⇒ 判绿」的**假绿**（CLI 对同一文件
 * exit 1「Not an analysis target」）。入口先过闸门：非分析目标 ⇒ 明确错误
 * （文案与码同 CLI `resolveTargetsCollect`）。
 *
 * **补充诊断通道（Bug 752 / 991）**：core 的 `checkSource` 只产**门禁面**
 * 诊断；指令文法（`nudo:directive-syntax`）、mock 装载失败
 * （`nudo:module-missing`）、path env 未解析（`nudo:env-unresolved`）三条
 * **旁路通道**必须显式并进报告——CLI 与 LSP 编辑器面都并了，agent 面此前
 * 一条都没有 ⇒ 同一文件三个面三份 issue 集（agent 面把「指令写错了」整条
 * 吞掉）。现在三面共用 service 的**同一份**并入实现。
 *
 * **路径错误通道（Bug 956）**：路径不可用时给**结构化**信封
 * （`pathErrors[]` + `nudo:path-not-found` 码 + suggestion），不是裸 errno
 * 文本——`format:"json"` 必须真的返回 JSON。
 */
export function checkTool(
  params: CheckToolParams,
  deps: AgentToolDeps = {},
): AgentToolResult {
  try {
    const filePath = normalizeFilePath(params.file);
    // 闸门（Bug 770）：非分析目标 ⇒ 明确错误（不送进分析器）
    const targetError = targetPathError(filePath);
    if (targetError) return checkPathErrorResult(targetError, params.format);
    let source: string;
    try {
      source = params.source ?? readSource(filePath, deps);
    } catch (err) {
      // 路径错误通道（Bug 956）：文件不存在 ⇒ 结构化 pathErrors（不是裸 errno）
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return checkPathErrorResult(pathNotFoundError(filePath), params.format);
      }
      throw err;
    }
    const autoBind = resolveProjectAutoBind(filePath, params.autoBind);
    // 与 CLI runCheck 同源读取 package.json#nudo.check（L2）
    const cCfg = checkConfig(findProjectConfig(dirname(filePath))?.config);
    const projectDir = resolveDraftProjectDir(filePath);
    // 模块图（与 checkToLspDiagnostics 同源）：缺图时跨模块
    // 调用塌缩 unknown → nudo:unproven-return 假红（CLI/LSP
    // 同文件干净，agent 面分叉——E5 同源契约）
    const analysisModules = evalAnalysisModules(filePath, source);
    const loadModule = params.loadModule ?? deps.loadModule ?? lspLoadModule;
    // 注入装配（Bug 785）：与 CLI `buildCheckInjection` 同源 —— 行内指令
    // （`@nudo:as` / `@nudo:replace`）+ `@nudo:mock` + env 全局必须进包，
    // 否则 IDE 与 CLI 对同一文件给出**相反**的门禁结论（IDE 假红：
    // 用户声明过 `raw` 是 number，IDE 仍按 string 判 `raw.toFixed` 不存在）。
    const inject = buildLspInjection(filePath, source, {
      loadModule,
      ...(analysisModules ? { modules: analysisModules } : {}),
    });
    const report = checkSource(filePath, source, pTrue, {
      loadModule,
      fromFile: filePath,
      ...(analysisModules ? { modules: analysisModules } : {}),
      ...(Object.keys(inject).length > 0 ? { inject } : {}),
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(projectDir ? { projectDir } : {}),
      entryThrows: cCfg.entryThrows,
      ...(cCfg.ignoreThrows.length > 0 ? { ignoreThrows: cCfg.ignoreThrows } : {}),
      skips: collectSkipReturns(source),
    });
    // 补充诊断通道（Bug 752 / 991）：与 CLI / LSP 编辑器面同一份并入实现
    const supplemented = mergeCheckIssues(
      report,
      collectCheckSupplementIssues(filePath, source, {
        ...(analysisModules ? { modules: analysisModules } : {}),
        loadModule,
      }),
    );
    const json = serializeCheckJson(supplemented);
    if (params.format === "json") {
      return textResult(JSON.stringify(json, null, 2));
    }
    const lines: string[] = [
      json.ok ? "nudo check OK" : "nudo check FAILED",
      `${json.summary.errors} error · ${json.summary.warnings} warning · ${json.summary.functions} fn`,
    ];
    for (const i of json.issues) {
      if (i.severity === "info") continue;
      const loc = i.line != null ? ` L${i.line}` : "";
      lines.push(`[${i.severity}]${loc} ${i.message}`);
      if (i.actual) lines.push(`  actual:   ${i.actual}`);
      if (i.expected) lines.push(`  expected: ${i.expected}`);
    }
    lines.push("");
    lines.push(JSON.stringify(json, null, 2));
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err, deps);
  }
}

/**
 * 路径错误 → agent 工具返回体（Bug 956 / 770）。
 *
 * - `format:"json"`：**结构化信封**（CLI 同口径）——check 面给 CheckJsonMulti
 *   的 pathErrors 面（CLI 的 `nudo check --json` 对不可用路径正是这个信封），
 *   test 面给 CaseJson 的 pathErrors 面（与 CLI `nudo test --json` 同构）。
 * - 缺省（文本面）：一行原因 + `fix:` 提示（CLI usage error 面同口径）。
 *
 * 两种面都走 `toolError`（`isError: true`）——失败必须与成功**可区分**。
 */
function checkPathErrorResult(
  error: PathError,
  format: "text" | "json" | undefined,
): AgentToolResult {
  if (format === "json") {
    const envelope: CheckJsonMulti = {
      version: 1,
      kind: "multi",
      ok: false,
      summary: { errors: 0, warnings: 0, infos: 0, functions: 0, files: 0 },
      reports: [],
      pathErrors: [
        {
          path: error.path,
          code: error.code,
          message: error.message,
          suggestion: error.suggestion,
        },
      ],
    };
    return toolError(JSON.stringify(envelope, null, 2));
  }
  return toolError(formatPathErrorText([error]));
}

export type HoverToolParams = {
  file: string;
  /** 1-based 行 */
  line: number;
  /** 0-based 列（缺省 0 —— 载荷的 `column` 键恒在） */
  column: number;
  source?: string;
  /** true 时同时返回该文件全部 Abs inlay */
  includeInlays?: boolean;
  /** 可选：*.nudo.js 加载（契约进 inlay / interface 档） */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** autoBind=false 时 interface 档回落 implicit（与 CodeLens 同口径） */
  autoBind?: boolean;
};

/**
 * hover 位置参数校验（Bug 768）。
 *
 * - `line`：1-based 整数（≥1）——缺失 / 非数字 / 非整数 / <1 ⇒ 工具错误。
 * - `column`：0-based 整数（≥0）——**缺省 0**（载荷的 `column` 键恒在，
 *   与文档承诺的 `{ file, line, column, … }` 形状一致）；给了但不是合法
 *   整数 ⇒ 工具错误。
 *
 * 为什么要校验：非法 `line`（如字符串 `"1"`）此前被原样回显，且分析字段
 * 全部落 `null` —— 调用方**分不清**「此处没有 hover」与「我传的参数类型
 * 不对」。校验后：参数非法 ⇒ `isError: true`；此处无 hover ⇒ 成功面
 * （`abs: null`）。
 */
function validateHoverPosition(
  params: HoverToolParams,
): { ok: true; line: number; column: number } | { ok: false; error: AgentToolResult } {
  const rawLine: unknown = params.line;
  if (typeof rawLine !== "number" || !Number.isInteger(rawLine) || rawLine < 1) {
    return {
      ok: false,
      error: toolError(
        `Error: line must be a 1-based integer (got ${JSON.stringify(rawLine ?? null)})`,
      ),
    };
  }
  const rawColumn: unknown = params.column;
  if (rawColumn === undefined || rawColumn === null) {
    return { ok: true, line: rawLine, column: 0 };
  }
  if (typeof rawColumn !== "number" || !Number.isInteger(rawColumn) || rawColumn < 0) {
    return {
      ok: false,
      error: toolError(
        `Error: column must be a 0-based integer (got ${JSON.stringify(rawColumn)})`,
      ),
    };
  }
  return { ok: true, line: rawLine, column: rawColumn };
}

/**
 * Agent hover：无损 Abs（不经 TypeValue bridge）。
 * 与 LSP hover 同一信息源（getHoverAtPosition）；interfaceSource 与
 * CodeLens `● interface` 同源（A7 / E5）。autoBind 与 CLI/LSP 同口径。
 */
export function hoverTool(
  params: HoverToolParams,
  deps: AgentToolDeps = {},
): AgentToolResult {
  try {
    // 入参校验先行：参数非法 ⇒ 工具错误（不与「此处无 hover」混形）
    const position = validateHoverPosition(params);
    if (!position.ok) return position.error;
    const { line, column } = position;
    const filePath = normalizeFilePath(params.file);
    const source = params.source ?? readSource(filePath, deps);
    const loadModule = params.loadModule ?? deps.loadModule ?? lspLoadModule;
    const autoBind = resolveProjectAutoBind(filePath, params.autoBind);
    // 模块图（与 LSP hover 同源）：缺图时跨模块调用塌缩
    // unknown（intension `(_p0: A1) => unknown`——E5 同源契约）
    const analysisModules = evalAnalysisModules(filePath, source);
    // 注入装配（Bug 786）：行内指令 / @nudo:mock / env 全局缺席 ⇒ 推导链
    // 塌缩 unknown（Nudo 词汇里 = 「推断失败」）而 CLI 面显示 number。
    // 传递协议：inject 随 opts 进 hover 的 generalizeFromAst（hover.ts 由
    // 片 C 接线：`HoverInterfaceOpts.inject`），随 opts 进 collectAbsInlays。
    const inject = buildLspInjection(filePath, source, {
      loadModule,
      ...(analysisModules ? { modules: analysisModules } : {}),
    });
    const hoverOpts: HoverInterfaceOpts & { inject?: RunTranspiledOptions } = {
      loadModule,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(resolveDraftProjectDir(filePath)
        ? { projectDir: resolveDraftProjectDir(filePath)! }
        : {}),
      ...(Object.keys(inject).length > 0 ? { inject } : {}),
    };
    const hover = getHoverAtPosition(
      filePath,
      source,
      line,
      column,
      undefined,
      hoverOpts,
      analysisModules ? { modules: analysisModules } : undefined,
    );
    const payload: Record<string, unknown> = {
      file: filePath,
      line,
      column,
      abs: hover?.abs ?? null,
      absMultiline: hover?.absMultiline ?? null,
      intension: hover?.intension ?? null,
      /** 有损外延，仅对照 */
      ext: hover?.typeText ?? null,
      /** CodeLens `● interface` 同源档（A7）；非导出 / 无档 → null */
      interfaceSource: hover?.interfaceSource ?? null,
      interfaceDisplay: hover?.interfaceDisplay ?? null,
      // 724：激活态与 CodeLens 同源（选中 case ⇒ 契约档 ○）——不传 active
      // 会走默认 true（恒 ●），与同一文件的 CodeLens 打架。
      interfaceLine: hover?.interfaceSource
        ? formatInterfaceTierLine(hover.interfaceSource, hover.interfaceActive ?? true)
        : null,
    };
    if (params.includeInlays) {
      payload.inlays = collectAbsInlays(source, {
        loadModule,
        fromFile: filePath,
        ...(analysisModules ? { modules: analysisModules } : {}),
        ...(autoBind === false ? { autoBind: false } : {}),
        // 注入包透传（Bug 786）：缺 inject ⇒ inlay 显示 unknown（= 推断失败）
        ...(Object.keys(inject).length > 0 ? { inject } : {}),
      });
    }
    return textResult(JSON.stringify(payload, null, 2));
  } catch (err) {
    return analysisError(err, deps);
  }
}

export type TestToolParams = {
  file: string;
  source?: string;
  /** "json" → CaseJson only；缺省摘要 + JSON */
  format?: "text" | "json";
  /** 只返回这些函数名（可选过滤） */
  functions?: string[];
  /** buffer-aware loadModule（E5）；缺省 deps.loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/**
 * Agent test：CaseJson v1 契约（与 CLI `nudo test --json` 同构）。
 * intension 携带无损 Abs；args/result 为 TypeValue 投影。
 * E5：deps.loadModule 传入 analyzeFile（buffer-aware 侧车可见）。
 *
 * **目标闸门（Bug 770）**：侧车契约模块（`*.nudo.js`）不是分析目标——对它
 * 跑 test 会把契约 **DSL 构造器**（`fn(...)` / `shape(...)` / `string()`）
 * 当成真实调用点报成 case（误导性见证）。入口先过闸门（与 CLI 同口径）。
 *
 * **断言汇总（Bug 754）**：CLI 的 `nudo test --json` 在 case 报告本体之外并入
 * 一段 `assertions`（passed / failed / unchecked）；agent 面此前**整段缺失**
 * ⇒ 消费方分不出「见证通过」与「见证失败」。现在并入**同一份**计算
 * （service 的 `buildTestReport`）。
 *
 * **过滤计数（Bug 761）**：`functions` 过滤后 `summary.cases` 必须与
 * **自身 payload** 同源——外部（imported）函数不在过滤范围内，其 case 仍
 * 留在 payload 里 ⇒ 计数必须含外部 case（否则 summary 说 1、payload 躺着 2）。
 *
 * **入参形态（Bug 962）**：`functions` 传字符串时被逐字符建集合（函数全被
 * 滤掉 ⇒ 假空报告），传数字 / 对象时过滤被整体跳过（静默失效）⇒ 非
 * 字符串数组一律**工具错误**。
 *
 * **路径错误通道（Bug 956）**：路径不可用 ⇒ 结构化 `pathErrors[]`。
 */
export async function testTool(
  params: TestToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = normalizeFilePath(params.file);
    // 闸门（Bug 770）：非分析目标 ⇒ 明确错误（不送进分析器）
    const targetError = targetPathError(filePath);
    if (targetError) return testPathErrorResult(targetError, params.format);
    // 入参形态校验（Bug 962）：functions 必须是字符串数组
    if (
      params.functions !== undefined &&
      (!Array.isArray(params.functions) ||
        params.functions.some((f) => typeof f !== "string"))
    ) {
      return toolError("Error: functions must be an array of function names");
    }
    let source: string;
    try {
      source = params.source ?? readSource(filePath, deps);
    } catch (err) {
      // 路径错误通道（Bug 956）：文件不存在 ⇒ 结构化 pathErrors（不是裸 errno）
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return testPathErrorResult(pathNotFoundError(filePath), params.format);
      }
      throw err;
    }
    // 分析走**异步**入口（Bug 993，族 25 收口接线）：同步 `analyzeFile` 不预载
    // path 型 env ⇒ 工具输出随「同一进程里谁先被调用过」变，且分析缓存键只有
    // env 文件内容、没有预载状态 ⇒ 陈旧结果被喂给后续调用。
    const result = await analyzeFileAsync(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
      "all",
    );
    let json = serializeCaseJson(result, filePath);
    // 断言汇总（Bug 754）：与 CLI `nudo test --json` 同口径并入
    const report = buildTestReport(filePath, result);
    json = {
      ...json,
      assertions: {
        passed: report.passed,
        failed: report.failed,
        unchecked: report.unchecked,
      },
    };
    // 过滤（Bug 761）：summary.cases 与 payload 同源（外部 case 也计入）
    if (Array.isArray(params.functions) && params.functions.length > 0) {
      const keep = new Set(params.functions);
      const filtered = json.functions.filter((f) => keep.has(f.name));
      let cases = 0;
      for (const f of filtered) {
        cases += (f as { cases?: unknown[] }).cases?.length ?? 0;
      }
      // 外部函数不在过滤范围内 ⇒ 其 case 仍留在 payload 里 ⇒ 计数须含之
      for (const f of json.externalFunctions ?? []) {
        cases += f.cases?.length ?? 0;
      }
      const summary = {
        ...json.summary,
        functions: filtered.length,
        cases,
      };
      json = { ...json, functions: filtered, summary } as typeof json;
    }
    if (params.format === "json") {
      return textResult(JSON.stringify(json, null, 2));
    }
    const lines: string[] = [
      `nudo test  ${json.file}`,
      `${json.summary.functions} fn · ${json.summary.cases} case · ${json.summary.diagnostics} diag`,
    ];
    for (const f of json.functions) {
      lines.push("");
      lines.push(`${f.name}${f.entryOnly ? "  [entry-only]" : ""}`);
      for (const c of f.cases) {
        const args = c.args.join(", ");
        lines.push(`  ${c.name}: (${args}) => ${c.result}`);
        if (c.intension?.abs) lines.push(`    abs: ${c.intension.abs}`);
        else if (c.intension?.display) lines.push(`    intension: ${c.intension.display}`);
      }
    }
    // imported（外部）函数段（Bug 760）：与 CLI 文本面同口径——按来源模块
    // 分组，段头 `--- <mod> (imported) ---`；此前整段消失（头部计数却仍把
    // 外部 case 算进去 ⇒ 「3 case」但正文只有 2 条 case）。
    const externals = json.externalFunctions ?? [];
    if (externals.length > 0) {
      const byModule = new Map<string, typeof externals>();
      for (const f of externals) {
        const mod = f.fromModule ?? "";
        const list = byModule.get(mod) ?? [];
        list.push(f);
        byModule.set(mod, list);
      }
      for (const [mod, fns] of byModule) {
        lines.push("");
        lines.push(`--- ${mod} (imported) ---`);
        for (const f of fns) {
          lines.push("");
          lines.push(`${f.name}`);
          for (const c of f.cases) {
            const args = c.args.join(", ");
            lines.push(`  ${c.name}: (${args}) => ${c.result}`);
            if (c.resultAbs) lines.push(`    abs: ${c.resultAbs}`);
          }
        }
      }
    }
    lines.push("");
    lines.push(JSON.stringify(json, null, 2));
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err, deps);
  }
}

/**
 * 路径错误 → agent test 工具返回体（Bug 956 / 770）。
 *
 * `format:"json"`：**CaseJson 信封**（与 CLI `nudo test --json` 对同一路径
 * 不可用时的产物同构——含 `assertions` 与 `pathErrors[]`）；文本面：一行
 * 原因 + `fix:` 提示。两种面都走 `toolError`（`isError: true`）。
 */
function testPathErrorResult(
  error: PathError,
  format: "text" | "json" | undefined,
): AgentToolResult {
  if (format === "json") {
    const envelope: CaseJson = {
      version: 1,
      file: error.path,
      summary: { functions: 0, externalFunctions: 0, cases: 0, diagnostics: 0 },
      functions: [],
      diagnostics: [],
      assertions: { passed: 0, failed: 0, unchecked: 0 },
      pathErrors: [
        {
          path: error.path,
          code: error.code,
          message: error.message,
          suggestion: error.suggestion,
        },
      ],
    };
    return toolError(JSON.stringify(envelope, null, 2));
  }
  return toolError(formatPathErrorText([error]));
}

export type WhatIfParams = {
  file: string;
  bindings?: TypeBinding[];
  target: string;
  /** Pre-read source (tests / callers that already hold the text). */
  source?: string;
  /** buffer-aware loadModule（E5）；缺省 deps.loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/**
 * what-if 入参校验（Bug 961）。
 *
 * - `target`：**必填**的非空字符串（顶层变量名）。缺失 ⇒ 工具错误
 *   （此前返回 `Type of "undefined": unknown` 的**假成功**——`unknown`
 *   按产品口径是「推断失败」，会把「你根本没传 target」说成「这个变量
 *   推断不出来」）。
 * - `bindings`：必须是**数组**，每项是 `{ name: string, type: string }`。
 *   非数组 ⇒ 工具错误（此前是裸 JS TypeError `bindings.map is not a
 *   function`）；缺 `name` 的项 ⇒ 工具错误（此前静默 no-op + 冒号后为
 *   空的误导提示）。
 *
 * 「target 不是已知绑定」仍是**合法**结果（文档承诺 `unknown`）——只有
 * **请求本身畸形**才走工具错误。
 */
function validateWhatIfParams(
  params: WhatIfParams,
): { ok: true; target: string; bindings: TypeBinding[] } | { ok: false; error: AgentToolResult } {
  const rawTarget: unknown = params.target;
  if (typeof rawTarget !== "string" || rawTarget.trim() === "") {
    return {
      ok: false,
      error: toolError(
        "Error: target is required for nudo.whatIf (a top-level variable name)",
      ),
    };
  }
  const rawBindings: unknown = params.bindings;
  if (rawBindings === undefined || rawBindings === null) {
    return { ok: true, target: rawTarget, bindings: [] };
  }
  if (!Array.isArray(rawBindings)) {
    return {
      ok: false,
      error: toolError("Error: bindings must be an array of { name, type }"),
    };
  }
  const bindings: TypeBinding[] = [];
  for (let i = 0; i < rawBindings.length; i++) {
    const item: unknown = rawBindings[i];
    const name =
      item !== null && typeof item === "object"
        ? (item as { name?: unknown }).name
        : undefined;
    const type =
      item !== null && typeof item === "object"
        ? (item as { type?: unknown }).type
        : undefined;
    if (typeof name !== "string" || name.trim() === "" || typeof type !== "string") {
      return {
        ok: false,
        error: toolError(
          `Error: bindings[${i}] must be { name: string, type: string } (got ${JSON.stringify(item ?? null)})`,
        ),
      };
    }
    bindings.push({ name, type });
  }
  return { ok: true, target: rawTarget, bindings };
}

/**
 * Set type assumptions and observe the inferred type of `target`. Bindings
 * are genuinely injected via `@nudo:as` before analysis — the inference gap
 * of the original MCP tool.
 *
 * 分析走**异步**入口（Bug 993）：同步 `analyzeFile` 不预载 path 型 env，
 * 工具输出会随「同一进程里谁先被调用过」变。
 */
export async function whatIf(
  params: WhatIfParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const checked = validateWhatIfParams(params);
    if (!checked.ok) return checked.error;
    const { target, bindings } = checked;
    const filePath = normalizeFilePath(params.file);
    const original = params.source ?? readSource(filePath, deps);
    const { source, applied, unapplied } = injectBindings(original, bindings);
    // Direct analysis: the injected source never matches the version-keyed
    // editor cache, so bypass it entirely.
    const result = await analyzeFileAsync(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
    );
    const binding = result.bindings.get(target);
    // 无损 Abs
    const typeStr = binding ? formatAbs(binding.abs) : "unknown";

    const notes: string[] = [];
    if (applied.length > 0) notes.push(`Bindings applied: ${applied.join(", ")}`);
    if (unapplied.length > 0) {
      notes.push(`Bindings not applied (no top-level declaration found): ${unapplied.join(", ")}`);
    }
    return textResult(
      `Type of "${target}": ${typeStr}${notes.length > 0 ? `\n${notes.join("\n")}` : ""}`,
    );
  } catch (err) {
    return analysisError(err, deps);
  }
}

export type FunctionToolParams = {
  /**
   * 目标文件（绝对路径或 `file://` URI）。
   *
   * **可缺省**（Bug 780）：`uri` 形态（LSP 内部自产的一律是 uri）此前
   * 落到 `params.file === undefined` ⇒ `normalizeFilePath(undefined)` 抛
   * TypeError ⇒ 工具 100% 失败。`file` 与 `uri` 二选一，缺省时报
   * 「file is required …」（与 `normalizeFilePath` 的共用入口闸同款）。
   */
  file?: string;
  /** LSP uri 形态（`file://…`）——与 `file` 二选一（Bug 780） */
  uri?: string;
  functionName: string;
  /** Pre-read source (tests / callers that already hold the text). */
  source?: string;
  /** buffer-aware loadModule（E5）；缺省 deps.loadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
};

/**
 * 工具入参的文件定位：`file` ∨ `uri` → 绝对路径（Bug 780）。
 *
 * LSP 内部自产的一律是 `file://…` uri 形态（`uriForFileOrUri` 口径），
 * 兄弟命令（`nudo.selectCase` / `nudo.contract*`）都收 uri 形态；此前
 * `nudo.trace` 只读 `params.file` ⇒ uri 形态 ⇒ 参数缺失 ⇒ TypeError。
 * 缺省（两者皆无）⇒ 抛**共用入口闸**的 TypeError（`file is required …`），
 * 不让裸 TypeError 当工具文案回给客户端。
 */
function resolveToolFile(params: { file?: string; uri?: string }): string {
  return normalizeFilePath(params.file ?? params.uri ?? "");
}

/**
 * Suggest @nudo:case directives for a function (ported from MCP).
 *
 * 「函数不存在」是**明确的失败**（用户传了不存在的 functionName）⇒ 走
 * `toolError`（`isError: true`），协议层与成功可区分（Bug 767）。
 * 分析走**异步**入口（Bug 993：path 型 env 必须先预载）。
 */
export async function suggestCase(
  params: FunctionToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = resolveToolFile(params);
    const source = params.source ?? readSource(filePath, deps);
    const result = await analyzeFileAsync(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
      "all",
    );
    const fn = result.functions.find((f) => f.name === params.functionName);

    if (!fn) {
      return toolError(`Function "${params.functionName}" not found`);
    }

    // **已声明** case（源码里的 `@nudo:case` 指令，source = "directive"）与
    // **合成** case（`call@` / `entry@` 见证）分开计数：合成见证是分析器的
    // 观察，不是用户写下的指令（Bug 511：入口兜底见证也会进 case 台账）。
    const declaredCases = fn.cases.filter((c) => c.source === "directive");
    const syntheticCases = fn.cases.filter((c) => c.source !== "directive");

    if (declaredCases.length > 0) {
      return textResult(
        `Function "${params.functionName}" already has ${declaredCases.length} case(s)`,
      );
    }

    if (syntheticCases.length > 0) {
      // 全部为合成 case 时可产出直接粘贴回源码的指令文本
      const directives = syntheticCases
        .map((c) => buildCaseDirective(c.name, c.argAbs ?? []))
        .filter((d): d is string => d !== null);
      if (directives.length > 0) {
        const skipped = syntheticCases.length - directives.length;
        const lines = [
          `Function "${params.functionName}" has ${syntheticCases.length} synthesized case(s); suggested directives:`,
          "/**",
          ...directives,
          "*/",
        ];
        if (skipped > 0) {
          lines.push(`(${skipped} case(s) skipped: not serializable as directives)`);
        }
        return textResult(lines.join("\n"));
      }
      return textResult(
        `Function "${params.functionName}" already has ${syntheticCases.length} case(s) (none serializable as directives)`,
      );
    }

    return textResult(`Suggested: /** @nudo:case */\nfunction ${params.functionName}(...) { ... }`);
  } catch (err) {
    return analysisError(err, deps);
  }
}

/**
 * Trace how a type transforms from input to output across a function's cases (ported from MCP).
 *
 * 「函数不存在」/「该函数没有任何 case」都是**明确的失败** ⇒ 走
 * `toolError`（`isError: true`），协议层与成功可区分（Bug 767）。
 * 分析走**异步**入口（Bug 993：path 型 env 必须先预载）。
 */
export async function trace(
  params: FunctionToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = resolveToolFile(params);
    const source = params.source ?? readSource(filePath, deps);
    const result = await analyzeFileAsync(
      filePath,
      source,
      undefined,
      undefined,
      params.loadModule ?? deps.loadModule ?? lspLoadModule,
      "all",
    );
    const fn = result.functions.find((f) => f.name === params.functionName);

    if (!fn) {
      return toolError(`Function "${params.functionName}" not found`);
    }

    if (fn.cases.length === 0) {
      return toolError(`No cases found for "${params.functionName}"`);
    }

    const traces = fn.cases.map((c) => {
      const args = c.argAbs.map((a) => formatShape(a)).join(", ");
      return `Input: (${args}) => Output: ${formatShape(c.abs)}`;
    }).join("\n");

    return textResult(traces);
  } catch (err) {
    return analysisError(err, deps);
  }
}

/**
 * executeCommand 位置参数桥接：`nudo.trace [uri, functionName]`（Bug 780）。
 *
 * IDE 的 `entry@` / `call@` 观察透镜用**位置参数**发命令（`[uri, fn]`），
 * 与 `nudo.contract*` 同款形态（`contractPositionalArgs` /
 * `contractEmitPositionalArgs`）。此前 `nudo.trace` **没有**桥 ⇒ 位置参数
 * 落到服务端兜底分支（把 uri 字符串当参数对象传下去）⇒ `params.file` 是
 * `undefined` ⇒ 工具 100% 抛 TypeError（每次点击观察透镜都只得到错误）。
 *
 * 返回 `{ uri, functionName }`（uri 形态即 IDE 自产形态，`trace` 工具
 * 已收 `uri` 键）。形态不合法（缺 functionName / 非字符串）⇒ 返回
 * `undefined`，由调用方（server 的命令桥）报**协议层参数形态错误**，
 * 不把字符串当对象传下去。
 */
export function tracePositionalArgs(
  args: unknown[],
): FunctionToolParams | undefined {
  if (
    args.length >= 2 &&
    typeof args[0] === "string" &&
    typeof args[1] === "string"
  ) {
    return { uri: args[0], functionName: args[1] };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// contract 档（design-refine-derivation §7.5/§8）：agent 打印/固化工具 +
// CodeLens 计算纯函数。产品名 contract；case 是 debug 副层。
// ---------------------------------------------------------------------------

export type ContractToolParams = {
  file: string;
  /** 省略 → 打印该文件全部顶层函数 */
  functionName?: string;
  /**
   * 使用点（`--from` 等价通道；Bug 994）：文件或目录路径列表。
   * 采集到的顶层调用记录参与契约求解（与 CLI `nudo contract --from` 同口径）。
   */
  from?: string[];
  /** .nudo.js 侧车装载（测试注入）；缺省 lspLoadModule 真实读盘 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /**
   * 测试注入用。客户端不能借此把项目 `autoBind: false` 打开——有效值与
   * 项目配置 AND：`projectAutoBind && (params.autoBind ?? true)`。
   */
  autoBind?: boolean;
  /** 打开 buffer 源（E5）；缺省 deps.getOpenText */
  source?: string;
};

/**
 * executeCommand 位置参数桥接（server.ts onExecuteCommand 特判移出的纯函数
 * 形态，供请求面测试）：`nudo.contract [uri, functionName?]`。
 */
export function contractPositionalArgs(
  args: unknown[],
): ContractToolParams | undefined {
  if (args.length >= 1 && typeof args[0] === "string") {
    return {
      file: args[0],
      ...(args.length >= 2 && typeof args[1] === "string"
        ? { functionName: args[1] }
        : {}),
    };
  }
  return undefined;
}

/**
 * executeCommand 位置参数桥接：`nudo.contract.emit [uri, functionName, mode]`。
 * 非法 mode 由 contractEmitTool 校验（显式错误文本，不静默降级）。
 */
export function contractEmitPositionalArgs(
  args: unknown[],
): { file: string; functionName: string; mode: "add" | "update" } | undefined {
  if (
    args.length >= 3 &&
    typeof args[0] === "string" &&
    typeof args[1] === "string" &&
    typeof args[2] === "string"
  ) {
    return {
      file: args[0],
      functionName: args[1],
      mode: args[2] as "add" | "update",
    };
  }
  return undefined;
}

/**
 * `--from` 等价通道（Bug 994）：采集使用点记录（顶层调用表达式 ⇒ call@ 记录），
 * 口径与 CLI `nudo contract --from` 同源（service 的 `collectCallsiteRecords`）。
 *
 * 路径错误**不静默**：与记录分开呈现——「现场文件读失败」与「现场文件里没有
 * 调用点」必须可区分；`from` 给了却一条记录都没有 ⇒ 直接报错（不给假面）。
 */
function collectFromRecords(from?: string[]): {
  records?: CallRecord[];
  notes: string[];
  error?: string;
} {
  if (!from || from.length === 0) return { notes: [] };
  // 协议面传的是 file:// URI ⇒ 与 `file` 参数同款归一（normalizeFilePath）
  const { records, errors } = collectCallsiteRecords(from.map((f) => normalizeFilePath(f)));
  const notes = errors.map((e) => `  from: ${e.path} — ${e.message}`);
  if (records.length === 0) {
    return {
      notes,
      error: `Error: no call-site records collected from --from (${errors
        .map((e) => `${e.path} — ${e.message}`)
        .join("; ")})`,
    };
  }
  return { records, notes };
}

/**
 * Agent contract 打印：与 CLI `nudo contract` 同一数据源（interfaceSurface），
 * 逐函数展示有效契约分层 handwritten / generated / implicit。
 * E5：优先 open buffer（getOpenText），磁盘回落；loadModule 走 buffer-aware。
 */
export async function contractTool(
  params: ContractToolParams,
  _deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = normalizeFilePath(params.file);
    const from = collectFromRecords(params.from);
    if (from.error) return toolError(from.error);
    // 有效 autoBind = 项目配置 AND 客户端请求（E5 同源 helper）
    const autoBind = resolveProjectAutoBind(filePath, params.autoBind);
    const open = _deps.getOpenText?.(filePath);
    const source = params.source ?? open?.text;
    const entries = await interfaceSurface(filePath, {
      loadModule: params.loadModule ?? _deps.loadModule ?? lspLoadModule,
      autoBind,
      ...(source !== undefined ? { source } : {}),
      ...(from.records ? { records: from.records } : {}),
    });
    const selected = params.functionName
      ? entries.filter((e) => e.fn === params.functionName)
      : entries;

    const lines: string[] = [filePath];
    if (selected.length === 0) {
      lines.push(
        params.functionName
          ? `  no interface found for '${params.functionName}'`
          : "  (no top-level functions found)",
      );
    }
    for (const line of selected.map(formatInterfaceSurfaceLine)) lines.push(line);
    lines.push(...from.notes);
    lines.push("");
    lines.push(JSON.stringify(selected, null, 2));
    return textResult(lines.join("\n"));
  } catch (err) {
    return analysisError(err, _deps);
  }
}

export type ContractDraftToolParams = {
  file: string;
  functionName?: string;
  /**
   * 使用点（`--from` 等价通道；Bug 994）：文件或目录路径列表。
   * 采集到的顶层调用记录参与契约求解（与 CLI `nudo contract --draft --from` 同口径）。
   */
  from?: string[];
  /** true → 写入 *.nudo.draft.js（不碰手写 *.nudo.js） */
  write?: boolean;
  dryRun?: boolean;
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  autoBind?: boolean;
  source?: string;
};

/**
 * Agent contract 草稿：与 CLI `nudo contract --draft` 同源（draftInterface）。
 * 代码优先 / 迁移：返回可审阅 `*.nudo.draft.js` 文本；write 落盘 draft 文件。
 */
export async function contractDraftTool(
  params: ContractDraftToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    const filePath = normalizeFilePath(params.file);
    // 写盘与 emit 同门禁：目标须为分析文件，且在 workspace roots 内
    if (params.write) {
      const gate = assertEmitTargetAllowed(filePath, deps.workspaceRoots);
      if (gate) return { content: [{ type: "text", text: gate }], isError: true };
    }
    const open = deps.getOpenText?.(filePath);
    const source = params.source ?? open?.text;
    const from = collectFromRecords(params.from);
    if (from.error) return toolError(from.error);
    const result = await draftInterface(filePath, {
      ...(params.functionName ? { fnNames: [params.functionName] } : {}),
      // E5：与 validate/hover 同源 loadModule（buffer-aware）；客户端 autoBind
      // 不再用来打开项目关闭项——draft 内部按侧车是否存在探测 handwritten
      ...(params.loadModule ?? deps.loadModule
        ? { loadModule: params.loadModule ?? deps.loadModule }
        : {}),
      ...(source !== undefined ? { source } : {}),
      ...(from.records ? { records: from.records } : {}),
    });
    const draftRel = sidecarDraftPath(filePath);
    const projectDir = resolveDraftProjectDir(filePath);
    // P2：write 路径与 CLI 对齐 fail-closed——无项目根时拒绝写盘
    // （CLI `nudo contract --draft --write`；可用已存在的 NUDO_DRAFT_FORCE=1 放开）
    if (params.write && !projectDir && !process.env.NUDO_DRAFT_FORCE) {
      return toolError(
        `Error: no project root found for '${filePath}'; draft write refused (set NUDO_DRAFT_FORCE=1 to override)`,
      );
    }
    const lines =
      params.write
        ? formatDraftSummary(
            filePath,
            draftRel,
            result,
            writeInterfaceDraft(filePath, result.draftSource, {
              dryRun: params.dryRun === true,
              entries: result.entries,
              ...(projectDir ? { projectDir } : {}),
            }),
          )
        : formatDraftSummary(filePath, draftRel, result);
    return textResult([...lines, ...from.notes].join("\n"));
  } catch (err) {
    return analysisError(err, deps);
  }
}

export type ContractEmitToolParams = {
  file: string;
  functionName: string;
  mode: "add" | "update";
  /**
   * 使用点（`--from` 等价通道；Bug 994）：文件或目录路径列表。
   * 采集到的顶层调用记录参与契约求解（与 CLI `nudo contract --emit --from` 同口径）。
   */
  from?: string[];
  /**
   * Preview without writing: same result shape as a real emit (paths,
   * would-change, optional unifiedDiff) but `emitInterface` is called with
   * `dryRun: true` — no sidecar write, no invalidation-as-if-written.
   * VS Code persist command sends this first, then a real write on confirm.
   */
  dryRun?: boolean;
};

/**
 * root 驱动下行推导（Bug 762）——与 CLI `nudo contract --emit` **同序同口径**。
 *
 * 设计文档 `docs/design/refine-derivation.md`：「**emit 永远 root 驱动**；
 * 纯下游文件靠生成段 `derived-from` 标注反查根」⇒ 下游侧车的 `derived-from`
 * 锚点**只能**由 `emitDerivedFromRoot` 写出。agent 面此前**从不**调这一步 ⇒
 * CLI 写得出的下游侧车在 IDE 面永远不产生，且工具把「引擎没做的那一步」
 * 说成「no interface changes」＋「not-an-export」（误导性诊断）。
 *
 * `fnNames` 的**命名空间差异**（关键）：CLI 的 `--fn` 传给派生步骤时是
 * **下游导出名**（`--fn add2` 命中派生行）；agent 工具的 `functionName` 是
 * **根文件里的函数名** ⇒ 把它当 `fnNames` 传下去会把派生行**全滤掉**
 * （下游推导整步消失）。故这里按「根文件」口径推导整个闭包（= CLI `--all`），
 * 再用写盘边界（下游侧车须落在 workspace roots 内）筛掉不许写的那些。
 */
function derivedEmit(
  filePath: string,
  mode: "add" | "update",
  extra: {
    dryRun?: boolean;
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    workspaceRoots?: string[];
  },
): EmitDerivedResult {
  const loadModule = extra.loadModule;
  try {
    const rows = deriveFromRoot(filePath, {
      ...(loadModule ? { loadModule } : {}),
    }).derived;
    // 写盘边界：下游侧车必须落在某个 workspace root 内（与本地侧车同口径）
    const allowed = rows.filter((r) =>
      derivedSidecarAllowed(sidecarPathOf(r.file), extra.workspaceRoots),
    );
    if (rows.length > 0 && allowed.length === 0) {
      return {
        sidecars: [],
        hasRoot: true,
        roots: [],
        issues: [
          {
            code: DIAG.interfaceEmitDenied,
            severity: "info",
            message:
              "downstream sidecars are outside the allowed workspace roots — derivation skipped",
          },
        ],
      };
    }
    return emitDerivedFromRoot(filePath, {
      ...(allowed.length > 0
        ? { fnNames: [...new Set(allowed.map((r) => r.fn))] }
        : {}),
      mode,
      ...(extra.dryRun ? { dryRun: true } : {}),
      ...(loadModule ? { loadModule } : {}),
    });
  } catch (err) {
    // 推导是**附加**步骤：它失败不应吃掉本地侧车的写盘（错误如实呈现）。
    return {
      sidecars: [],
      hasRoot: true,
      roots: [],
      issues: [
        {
          code: DIAG.interfaceEmitDenied,
          severity: "warning",
          message: `root-driven derivation failed: ${(err as Error).message}`,
        },
      ],
    };
  }
}

/** 每侧车路径写盘串行化：emitInterface 的读-分析-写之间有 await 边界，
 *  连续两次 emit（如连续点击两个 persist lens）都基于同一份旧侧车内容计算，
 *  后写整文件覆盖 → 前一个 @generated 段丢失且首次结果文本虚报 written。
 *  同路径排队后两次 emit 串行，第二次读到第一次的写盘结果。 */
const emitChains = new Map<string, Promise<unknown>>();
function serializedEmit(
  filePath: string,
  fnNames: string[],
  mode: "add" | "update",
  extra: {
    source?: string;
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    dryRun?: boolean;
    records?: CallRecord[];
    workspaceRoots?: string[];
  } = {},
): Promise<{ derived: EmitDerivedResult; local: EmitInterfaceResult }> {
  const prev = emitChains.get(filePath) ?? Promise.resolve();
  const run = async (): Promise<{ derived: EmitDerivedResult; local: EmitInterfaceResult }> => {
    // CLI 同序：先 root 驱动下行推导（下游侧车），再本地侧车。
    const derived = derivedEmit(filePath, mode, extra);
    const local = await emitInterface(filePath, {
      fnNames,
      mode,
      ...(extra.source !== undefined ? { source: extra.source } : {}),
      ...(extra.loadModule ? { loadModule: extra.loadModule } : {}),
      ...(extra.dryRun ? { dryRun: true } : {}),
      ...(extra.records ? { records: extra.records } : {}),
    });
    return { derived, local };
  };
  const next = prev.then(run, run); // 前次失败不阻塞后续
  const settled = next.then(
    () => {},
    () => {},
  );
  emitChains.set(filePath, settled);
  // 链尾落地后清掉，避免长驻 LSP 会话 Map 无界增长
  void settled.then(() => {
    if (emitChains.get(filePath) === settled) emitChains.delete(filePath);
  });
  return next;
}

/**
 * Agent contract 固化：与 CLI `nudo contract --emit` 同一写盘器
 * （emitInterface），把调用点域固化为侧车 `@generated` 段。结果文本含
 * written / skipped(reason) / issues；name-clash（手写优先）明确呈现。
 */
export async function contractEmitTool(
  params: ContractEmitToolParams,
  deps: AgentToolDeps = {},
): Promise<AgentToolResult> {
  try {
    // 入参校验：非法 mode / 缺 functionName → 显式错误回报（server.ts 的
    // dispatch 对 JSON 请求体只做 as 强转，不校验会静默降级成 add / skipped）
    if (typeof params.functionName !== "string" || params.functionName.trim() === "") {
      return toolError("Error: functionName is required for nudo.contract.emit");
    }
    if (params.mode !== "add" && params.mode !== "update") {
      return toolError(
        `Error: invalid mode '${String(params.mode)}' — expected "add" | "update"`,
      );
    }
    const filePath = normalizeFilePath(params.file);
    const err = assertEmitTargetAllowed(filePath, deps.workspaceRoots);
    if (err) return toolError(err);
    // E5：分析与 validate 同源（open buffer + buffer-aware loadModule）
    const openSource = deps.getOpenText?.(filePath)?.text;
    // 源文件 buffer 脏 ⇒ 拒绝写盘（Bug 765）。侧车守卫只挡了**侧车自己**的
    // 脏 buffer，源文件的脏 buffer 没有对称守卫 ⇒ 侧车会记录一份**磁盘上
    // 并不存在**的代码形状（未保存的 3 参契约落进磁盘、磁盘源仍是 2 参），
    // 且「形参对不上」被完全静默。与侧车守卫同款：先保存或丢弃再固化。
    if (openSource !== undefined) {
      let diskSource: string | undefined;
      try {
        diskSource = readFileSync(filePath, "utf-8");
      } catch {
        diskSource = undefined;
      }
      if (diskSource === undefined || openSource !== diskSource) {
        return toolError(
          `Error: source ${filePath} has unsaved buffer changes; save or discard them before emit (otherwise the sidecar would record a contract for code that is not on disk)`,
        );
      }
    }
    // 侧车 open buffer 脏：emit 写盘后 save 会覆盖 @generated 段 → 拒绝
    const sidecarPath = sidecarPathOf(filePath);
    const openSidecar = deps.getOpenText?.(sidecarPath)?.text;
    if (openSidecar !== undefined) {
      let diskSidecar: string | undefined;
      try {
        diskSidecar = readFileSync(sidecarPath, "utf-8");
      } catch {
        diskSidecar = undefined;
      }
      if (diskSidecar !== undefined && openSidecar !== diskSidecar) {
        return toolError(
          `Error: sidecar ${sidecarPath} has unsaved buffer changes; save or discard them before emit (otherwise save would overwrite @generated sections)`,
        );
      }
    }
    const dryRun = params.dryRun === true;
    const from = collectFromRecords(params.from);
    if (from.error) return toolError(from.error);
    const result = await serializedEmit(filePath, [params.functionName], params.mode, {
      ...(dryRun ? { dryRun: true } : {}),
      ...(openSource !== undefined ? { source: openSource } : {}),
      ...(deps.loadModule ? { loadModule: deps.loadModule } : {}),
      ...(from.records ? { records: from.records } : {}),
      ...(deps.workspaceRoots ? { workspaceRoots: deps.workspaceRoots } : {}),
    });
    return textResult(
      [...formatEmitResult(filePath, result.local, dryRun, result.derived).split("\n"), ...from.notes].join(
        "\n",
      ),
    );
  } catch (err) {
    return analysisError(err, deps);
  }
}

/**
 * 下游侧车（root 驱动推导）结果文本——与 CLI `runContractEmit` 的派生段
 * **同口径**：`Updated <root> → <sidecar> (derived-from <roots>)` /
 * `<sidecar>: no derived contract changes (<reason>)` / `[severity] code: message`。
 */
function formatDerivedResult(
  filePath: string,
  derived: EmitDerivedResult,
  dryRun = false,
): string[] {
  const lines: string[] = [];
  // 顶层 issues（如「下游侧车在工作区外，推导已跳过」）**始终**呈现
  for (const i of derived.issues ?? []) {
    lines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
  }
  if (!derived.hasRoot) return lines;
  for (const sc of derived.sidecars) {
    if (sc.changed && dryRun) {
      lines.push(
        `[dry-run] would update ${sc.sidecarPath} (derived-from ${derived.roots.join(", ")}):`,
      );
      lines.push(sc.diff ?? "");
    } else if (sc.changed) {
      lines.push(
        `Updated ${filePath} → ${sc.sidecarPath} (derived-from ${derived.roots.join(", ")})`,
      );
      lines.push(`  written: ${sc.fn}`);
    } else {
      lines.push(
        `${sc.sidecarPath}: no derived contract changes (${sc.skipped ?? "no-change"})`,
      );
    }
    for (const i of sc.issues) {
      lines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
    }
  }
  return lines;
}

/**
 * emit 结果文本（与 CLI runInterfaceEmit 共用 formatEmitSummary 骨架；
 * 本包装传绝对路径口径）。
 * dryRun：与 CLI `--emit --dry-run` 同口径的 `[dry-run] would update` 预览
 * （含 unifiedDiff / would-write），绝不声称已写盘。
 *
 * `derived`（root 驱动下行推导，CLI 同序在本地侧车**之前**）：给出
 * 「Updated <root> → <downstream sidecar> (derived-from …)」这类行——
 * IDE 面此前**整步缺失**（Bug 762），工具只报「no interface changes」。
 */
export function formatEmitResult(
  filePath: string,
  result: EmitInterfaceResult,
  dryRun = false,
  derived?: EmitDerivedResult,
): string {
  const derivedLines = derived ? formatDerivedResult(filePath, derived, dryRun) : [];
  if (dryRun) {
    const lines: string[] = [];
    if (result.changed) {
      lines.push(`[dry-run] would update ${filePath} → ${result.sidecarPath}`);
      lines.push(`  would write: ${result.written.join(", ") || "(none)"}`);
      if (result.diff) lines.push(result.diff);
    } else {
      lines.push(`${filePath}: no interface changes`);
      if (result.emptyDefaultTargets) {
        lines.push(
          `  tip: default emit only refreshes existing @generated segments; pass functionName to create new ones`,
        );
      }
    }
    for (const s of result.skipped.filter((x) => x.reason !== "no-change")) {
      lines.push(`  skipped ${s.fn} (${s.reason})`);
    }
    for (const i of result.issues) {
      lines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
    }
    lines.push("  (dry-run: no sidecar written)");
    return [...derivedLines, ...lines].join("\n");
  }
  return [
    ...derivedLines,
    ...formatEmitSummary(filePath, result.sidecarPath, result),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CodeLens contract 档计算（design-refine-derivation §8）
// ---------------------------------------------------------------------------

/** 默认层 lens：`●/○ contract / hw|gen|imp`（观察选择器的契约选项，与各 case 互斥） */
export type InterfaceLens =
  | { kind: "interface"; fn: string; line: number; source: InterfaceSource; active: boolean }
  /** 固化动作 lens：add=`⚡ persist interface`，update=`↻ update interface` */
  | { kind: "emit"; fn: string; line: number; mode: "add" | "update" }
  /** 代码优先草稿：`⚡ draft interface`（F6；handwritten 不加） */
  | { kind: "draft"; fn: string; line: number };

/** case 副层 lens（debug 层，标题/命令与既有行为一致） */
export type CaseLens = {
  kind: "case";
  fn: string;
  line: number;
  caseIndex: number;
  caseName: string;
  active: boolean;
};

/**
 * 合成观察 lens（call@ / entry@）：把 `nudo test` 的调用点事实直接钉在
 * 源码上。call@ 落在**调用点行**，entry@ 落在**函数声明行**。只读观察。
 */
export type ObservationLens = {
  kind: "callsite" | "entry";
  fn: string;
  /** 1-based：call@=调用点行；entry@/symbolic=函数行 */
  line: number;
  caseName: string;
  /** CLI test 同形标题：`call@L6  (5, 3) => 2` */
  title: string;
};

export type NudoLens = InterfaceLens | CaseLens | ObservationLens;

export type InterfaceLensDeps = {
  /** .nudo.js 侧车装载（effectiveInterface 同一通道）；缺省不加载侧车 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** fn → 激活 case 下标（●/○ 标题）；缺省全部按 index 0 */
  activeCases?: Map<string, number>;
  /** 侧车 ambient 绑定开关（与 check/validate 同口径；false 时回落 implicit） */
  autoBind?: boolean;
};

/**
 * 顶层函数位（含 export 包裹与箭头/函数表达式 const 声明）——interface 档目标集。
 *
 * 枚举面必须与**导出面**（`localNamedExports`）同口径，否则 CodeLens 的
 * interface 档与 hover / inlay / semantic token 面分裂：
 * - `export default function compute(…)` —— 默认导出此前整段漏掉（753）；
 * - 导出类的实例方法 `Counter.inc` —— 此前只存在于 hover 面（769）；
 * - CJS 成员导出 `exports.f = fn` / `module.exports.f = fn` —— 此前整段漏掉（998）。
 */
function topLevelFunctionSlots(source: string): Array<{ name: string; line: number }> {
  const ast = parse(source);
  const out: Array<{ name: string; line: number }> = [];
  /** 导出类的实例/静态方法 → `Class.method`（契约键同口径，design §3.2） */
  const pushClassMethods = (cls: ClassDeclaration): void => {
    const clsName = cls.id?.name;
    if (!clsName) return;
    for (const m of getClassMembers(cls)) {
      if (m.type !== "ClassMethod") continue;
      if (m.kind && m.kind !== "method") continue;
      const keyName = classMemberKeyName(m);
      if (typeof keyName !== "string") continue;
      const mLine = m.loc?.start?.line;
      if (typeof mLine !== "number") continue;
      out.push({ name: `${clsName}.${keyName}`, line: mLine });
    }
  };
  for (const stmt of programBody(ast)) {
    const line = stmt.loc?.start?.line;
    if (typeof line !== "number") continue;
    // export default：有名取本地名，匿名取 "default"（与 core listTopFunctions 同口径）
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration") {
        out.push({ name: decl.id?.name ?? "default", line });
      } else if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        out.push({ name: "default", line });
      } else if (decl.type === "ClassDeclaration" && decl.id) {
        pushClassMethods(decl);
      }
      continue;
    }
    const d = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (!d) continue;
    if (d.type === "FunctionDeclaration" && d.id) {
      out.push({ name: d.id.name, line });
    } else if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations ?? []) {
        if (
          decl.id?.type === "Identifier" &&
          decl.init &&
          (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression")
        ) {
          out.push({ name: decl.id.name, line });
        }
      }
    } else if (d.type === "ClassDeclaration" && d.id) {
      // 导出类的实例/静态方法 → `Class.method`（契约键同口径，design §3.2）
      pushClassMethods(d);
    } else if (d.type === "ExpressionStatement") {
      // CJS 成员导出：`exports.f = fn` / `module.exports.f = fn`（键名即导出名）
      const expr = d.expression;
      if (expr?.type !== "AssignmentExpression" || expr.operator !== "=") continue;
      const left = expr.left;
      const right = expr.right;
      if (left.type !== "MemberExpression" || left.computed) continue;
      const obj = left.object;
      const isExports = obj.type === "Identifier" && obj.name === "exports";
      const isModuleExports =
        obj.type === "MemberExpression" &&
        obj.object.type === "Identifier" &&
        obj.object.name === "module" &&
        obj.property.type === "Identifier" &&
        obj.property.name === "exports";
      if (!isExports && !isModuleExports) continue;
      const prop = left.property;
      if (prop.type !== "Identifier") continue;
      if (right.type !== "FunctionExpression" && right.type !== "ArrowFunctionExpression") continue;
      out.push({ name: prop.name, line });
    }
  }
  return out;
}

/**
 * CodeLens 全量计算（server.ts onCodeLens 的可测纯函数形态）：
 * - interface 默认层：每个**导出**函数一条 `● contract / hw|gen|imp`——
 *   effectiveInterface 命中 handwritten/generated，否则 implicit
 *   （隐式 interface 始终可算，§7.1）；私有函数不绑定不落盘（§2.1），不加。
 * - 固化动作：handwritten 只读展示；侧车已含同名 @generated 段 → update，
 *   否则 add。
 * - case 副层：跟在本函数 interface 档之后（标题/命令零改动；来源仍是
 *   getCasesForFile 的指令 case）。
 */
export function computeInterfaceLenses(
  source: string,
  filePath: string,
  deps: InterfaceLensDeps = {},
): NudoLens[] {
  // since 锚：lens 探测只排干自身产生的诊断增量——全量 take 会在 validateText
  // 的 await 窗口窃取在途待消费的 interface-load 等诊断（check 通道被饿死）
  const ifaceSince = interfaceDiagCount();
  const lenses: NudoLens[] = [];
  const exported = localNamedExports(source);

  // 固化状态：侧车是否已含同名 @generated 段（与 effectiveInterface 的
  // generatedExportNames 判定同口径；经 loadModule 读侧车，不直接碰盘）
  const sidecarPath = sidecarPathOf(filePath);
  const sidecarSpec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
  const sidecarSrc = deps.loadModule?.(sidecarSpec, filePath);
  const persisted = sidecarSrc !== undefined ? generatedExportNames(sidecarSrc) : new Set<string>();

  const fnCases = new Map(
    getCasesForFile(filePath, source).map((f) => [f.functionName, f] as const),
  );

  const pushCaseLenses = (fnName: string, line: number): void => {
    const fc = fnCases.get(fnName);
    if (!fc) return;
    // 无显式选择 → -1（全 ○）：契约是默认观察选项（与 contract 选项互斥）
    const activeIdx = deps.activeCases?.get(fnName) ?? -1;
    for (const c of fc.cases) {
      lenses.push({
        kind: "case",
        fn: fnName,
        line,
        caseIndex: c.index,
        caseName: c.name,
        active: c.index === activeIdx,
      });
    }
  };

  const seen = new Set<string>();
  for (const fn of topLevelFunctionSlots(source)) {
    if (seen.has(fn.name)) continue;
    seen.add(fn.name);

    if (exported.has(fn.name)) {
      // A7：与 hover / semantic tokens / inlay 共用 interfaceTierOf（同源）
      const tier = interfaceTierOf(source, fn.name, filePath, {
        ...(deps.loadModule ? { loadModule: deps.loadModule } : {}),
        // §2.2「整体关闭」：autoBind=false 时侧车 ambient 停用，lens 回落
        // implicit（与 check/validate/print 同口径，避免 UI 仍暗示契约生效）
        ...(deps.autoBind === false ? { autoBind: false } : {}),
      });
      const src: InterfaceSource = tier?.source ?? "implicit";
      // 契约选项激活 ⇔ 该函数无激活 case（观察选择器互斥）
      const contractActive = !(deps.activeCases?.has(fn.name) ?? false);
      lenses.push({ kind: "interface", fn: fn.name, line: fn.line, source: src, active: contractActive });
      if (src !== "handwritten") {
        lenses.push({
          kind: "emit",
          fn: fn.name,
          line: fn.line,
          mode: persisted.has(fn.name) ? "update" : "add",
        });
        // F6：代码优先草稿（与 CLI --draft / agent nudo.contract.draft 同源）
        lenses.push({ kind: "draft", fn: fn.name, line: fn.line });
      }
    }

    // case 副层跟随 interface 档之后（同函数同 line，数组序即渲染序）
    pushCaseLenses(fn.name, fn.line);
  }

  // getCasesForFile 宇宙中未被顶层函数扫描覆盖的形态：原样保留 case lens
  for (const fc of fnCases.values()) {
    if (seen.has(fc.functionName)) continue;
    seen.add(fc.functionName);
    pushCaseLenses(fc.functionName, fc.loc.start.line);
  }

  // lens 探测可能积累 interface-load 诊断——只排本次增量，防泄漏进 check 通道
  takeInterfaceDiagsSince(ifaceSince);
  return lenses;
}

/** `call@L6` / `entry@L2` → 行号；`call@symbolic` / `entry@` → undefined */
function observationLineFromName(name: string): number | undefined {
  const m = /@L(\d+)\s*$/.exec(name);
  return m ? Number(m[1]) : undefined;
}

/** 分析结果的合成 case（本地与外部函数同型） */
type AnalysisCase = ReturnType<typeof analyzeFile>["functions"][number]["cases"][number];

/**
 * 合成 call@ / entry@ 观察 lens（CLI `nudo test` 的源码内投影）。
 * - 跳过 `@nudo:case` 指令 case（已有 case 副层 lens）
 * - call@ 挂调用点行；entry@ / call@symbolic 挂函数声明行
 * - 标题与 test 报告同形：`call@L6  (5, 3) => 2`
 * - **跨模块**（1034）：外部函数的 call@ 事实落在**本文件**的调用点行——
 *   只消费 externalFunctions 的 call@（entry@ 属于被导入模块，不在调用方落镜）
 */
export function computeObservationLenses(source: string, filePath: string): ObservationLens[] {
  let analysis: ReturnType<typeof analyzeFile>;
  try {
    analysis = analyzeFile(filePath, source);
  } catch {
    return [];
  }
  const out: ObservationLens[] = [];
  const observationTitle = (c: AnalysisCase): string => {
    const args = c.argAbs.map((a) => {
      try {
        return formatShape(a);
      } catch {
        return "unknown";
      }
    });
    let result: string;
    try {
      result = formatShape(c.abs);
    } catch {
      result = "unknown";
    }
    const argsStr = args.join(", ");
    return `${c.name}  (${argsStr}) => ${result}${c.throwsAbs && c.throwsAbs.shape.k !== "never" ? `  throws ${formatShape(c.throwsAbs)}` : ""}`;
  };
  for (const fn of analysis.functions) {
    const fnLine = fn.loc.start.line;
    for (const c of fn.cases) {
      // 指令 case 由 case 副层负责；这里只钉合成观察
      if (c.source === "directive") continue;
      const isEntry = c.name.startsWith("entry@");
      const isCall = c.name.startsWith("call@");
      if (!isEntry && !isCall && c.source !== "callsite") continue;

      const callLine = observationLineFromName(c.name);
      const line = isEntry ? fnLine : (callLine ?? fnLine);
      out.push({
        kind: isEntry ? "entry" : "callsite",
        fn: fn.name,
        line,
        caseName: c.name,
        title: observationTitle(c),
      });
    }
  }
  // 跨模块调用点：被导入函数的 call@ case 记在本文件的调用点行
  for (const fn of analysis.externalFunctions ?? []) {
    for (const c of fn.cases) {
      if (c.source === "directive") continue;
      // 只取调用点 case：外部函数的 entry@ 属于被导入模块（不在调用方落镜）
      if (!c.name.startsWith("call@") && c.source !== "callsite") continue;
      const callLine = observationLineFromName(c.name);
      // call@symbolic 无行锚 —— 行号会指向别的模块，不在调用方文件落镜
      if (callLine === undefined) continue;
      out.push({
        kind: "callsite",
        fn: fn.name,
        line: callLine,
        caseName: c.name,
        title: observationTitle(c),
      });
    }
  }
  // 稳定序：行号 → 函数名 → case 名
  out.sort((a, b) => a.line - b.line || a.fn.localeCompare(b.fn) || a.caseName.localeCompare(b.caseName));
  return out;
}
