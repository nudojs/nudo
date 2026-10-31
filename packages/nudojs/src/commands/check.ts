/**
 * nudo check — 门禁 + 签名表（Day 0 / CI）。
 * runCheck 拆为 loadCache / buildInjection / report+exit 三段（段3 打印面
 * 在 check-report.ts；commander 装配在 check-command.ts）；
 * 依赖（@nudojs/core / service / parser）均为静态依赖，顶部静态引入。
 */
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import type { File } from "@babel/types";
import { paint } from "../ui.ts";
import {
  actionsForIssue,
  checkSource,
  extractFileEnvNames,
  listFnDirectiveScopes,
  pTrue,
  parseSource,
  setEvalFallbackCollector,
  sidecarPathOf,
  type CheckAction,
  type CheckIssue,
  type CheckJson,
  type CheckOptions,
  type CheckReport,
  type AbsCallRecord,
  type EvalFallback,
  type GitlabCodeQualityIssue,
  type RunTranspiledOptions,
} from "@nudojs/core";
import {
  analysisConfig,
  analyzeFileAsync,
  checkCacheKey,
  checkConfig,
  collectEvalReplacements,
  collectLoadDepContents,
  collectSkipReturns,
  defaultLoadModule,
  directiveDiagIssues,
  DiskCache,
  diskCacheRoot,
  findProjectConfig,
  interfaceConfig,
  mergeCheckIssues,
  mockFromErrorIssues,
  resolveModule,
  type CallRecord,
} from "@nudojs/service";
import {
  extractDirectivesQuiet,
  extractFileDirectives,
  parse,
  type DirectiveDiag,
} from "@nudojs/parser";
import { applyTextEdits, materializeAction, unifiedDiff } from "@nudojs/service/emit";
import { DIAG } from "@nudojs/core/internal";
import {
  preloadPathEnvs,
  getPathEnvLoadErrors,
  getPathEnvDepContents,
} from "@nudojs/service/evaluator";
import {
  emitCheckReport,
  emitHardErrorCiAnnotations,
  formatSyntaxErrorBlock,
  syntaxErrorInfo,
  ANALYSIS_FAILED_PREFIX,
  type CiHardError,
} from "./check-report.ts";
import {
  collectNudoFiles,
  displayPathOf,
  reportPathErrors,
  buildEvalInjection,
  type MockFromError,
  type PathError,
} from "./shared.ts";
import {
  checkGateFromConfig,
  configIgnoreThrows,
  invalidGateConfig,
  invalidIgnoreThrowsConfig,
  mergeIgnoreThrows,
  resolveEntryThrows,
  type EntryThrowsMode,
  type GateProfile,
} from "../check-gate-config.ts";
import {
  dedupeAgainstIssues,
  dedupeFromStaticIssues,
  domainIssuesFromDiagnostics,
  ENV_UNRESOLVED_CODE,
  mergeJsonIssues,
  reportFromCachedJson,
  staticFromDomainIssues,
  stripCachedSigRets,
  stripConfigShapeIssues,
  stripEnvUnresolvedIssues,
  type FromCallsiteFile,
} from "../check-json-map.ts";
import { shouldComputeCacheKey, shouldUseDiskCache } from "../check-ci-flags.ts";
import {
  CONFIG_SHAPE_CODE,
  projectConfigShapeIssue,
  type ConfigShapeIssue,
} from "../config-shape.ts";

// ---------------------------------------------------------------------------
// check — 门禁 + 签名表（Day 0 / CI）
// ---------------------------------------------------------------------------

/** 模块路径归一（realpath 对齐符号链接；读不到时回落原路径） */
function normalizeModulePath(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

/**
 * `--from` 采集的跨文件调用点记录 → core drift 判定用的 AbsCallRecord（Bug 366）。
 *
 * core 的 drift 判定（`nudo:interface-drift`）此前只吃**被检查文件自身**求值
 * 产生的调用记录 ⇒ 调用点在别的文件里时，`--from` 写出的生成段永远判不出
 * 陈旧（落盘契约静默陈旧，0 warning 假绿）。本函数把 `--from` 的跨文件证据
 * 接进同一条通道。
 *
 * 口径：
 * - **只收可归因到本文件的记录**（targetModule = 导出 tag / fnModule = 定义
 *   位点 命中本文件）⇒ 别的模块里的同名函数不会污染本文件的 drift 判定
 *   （zero-FP 红线；与 service 侧 case 合成的 matchingExternal 同口径）。
 * - `fnName` 取**被调方在目标模块里的导出名**（targetExport；缺失或命名空间
 *   通配时回落调用处可见名）⇒ import 别名不影响路由。
 * - **不携带 callLoc**：跨文件调用点在被检查文件内没有位置（不把别的文件的
 *   行号挂到本文件上）。
 */
function externalAbsCallRecords(
  filePath: string,
  records: readonly CallRecord[] | undefined,
): AbsCallRecord[] {
  if (!records || records.length === 0) return [];
  const current = normalizeModulePath(filePath);
  const out: AbsCallRecord[] = [];
  for (const r of records) {
    const attributed =
      (r.fnModule !== undefined && normalizeModulePath(r.fnModule) === current) ||
      (r.targetModule !== undefined && normalizeModulePath(r.targetModule) === current);
    if (!attributed) continue;
    const targetExport = r.targetExport;
    const fnName =
      targetExport !== undefined && targetExport !== "*" && targetExport !== ""
        ? targetExport
        : r.fnName;
    if (!fnName) continue;
    out.push({ fnName, args: r.argAbs, result: r.resultAbs });
  }
  return out;
}

/**
 * 文件级 `@nudo:env` 命名 env 抽取（D5=F1：文法在 core directive-scan 单源）。
 * `//` 与 `///` 等价；字符串/块注释里的同形文本不是指令；
 * env 名 token 只收 `\w+` 或 path-like。
 */
export function fileEnvNamesFromText(source: string): string[] {
  return extractFileEnvNames(source);
}

// ---------------------------------------------------------------------------
// #1 零配置 onboarding / #9 缓存 opt-in 提示（人类面批次探针）
// ---------------------------------------------------------------------------

/**
 * 零配置指纹（#1）：源文件是否出现任何 @nudo:* 指令。
 * parser 面（函数级 case/mock/pure/skip/sample、文件级 env/import/mock-module、
 * 行内 as/replace）与 core 面函数标签（contract/assume/invariant/throws/budget，
 * 清洗行首锚定）取并集——任一在场即不是纯净新项目。
 */
function sourceHasNudoDirectives(source: string): boolean {
  const reps = collectEvalReplacements(source);
  if (reps.targets.length > 0 || reps.asTargets.length > 0) return true;
  const ast = parse(source);
  if (extractDirectivesQuiet(ast).length > 0) return true;
  if (extractFileDirectives(ast, { diags: [] }).length > 0) return true;
  return listFnDirectiveScopes(ast).some((s) =>
    s.commentLines.some((l) => l.startsWith("@nudo:")),
  );
}

/**
 * 人类面批次探针（action 层每轮新建；runCheck 聚合静态指纹，emitCheckReport
 * 聚合 error 计数 / 缓存启用）。#1 onboarding 四条件：
 * errorIssues>0（本次 exit 1）∧ 全部 error 为 L2 ∧ 零 @nudo:* 指令 ∧ 零 nudo 配置。
 */
type BatchProbe = {
  /** 有 @nudo:* 指令的目标文件数（须为 0） */
  filesWithDirectives: number;
  /** 发现 package.json#nudo 配置的目标文件数（须为 0） */
  filesWithConfig: number;
  /** error 级 issue 总数（须 >0 且全为 L2） */
  errorIssues: number;
  /** 非 L2 error（含注入装配失败）出现即破坏指纹 */
  nonL2Error: boolean;
  /** 任一目标项目磁盘缓存已启用（nudo.cache / NUDO_CACHE_DIR） */
  cacheEnabled: boolean;
  /**
   * 任一目标项目的 package.json#nudo 键形状非法（468/936）——出现即
   * **破坏** onboarding 前提：onboarding 说「本项目还没有 nudo 配置」，
   * 但配置键存在（只是形状写坏）⇒ 那个前提不成立，onboarding 的
   * 「nudo init」建议是错 advice。
   */
  configShape: boolean;
};

export function freshBatchProbe(): BatchProbe {
  return {
    filesWithDirectives: 0,
    filesWithConfig: 0,
    errorIssues: 0,
    nonL2Error: false,
    cacheEnabled: false,
    configShape: false,
  };
}


/** #9 缓存 opt-in 提示（stderr 一行；仅人类面批量场景） */
export const CACHE_HINT =
  '[hint] repeat runs: enable "nudo": { "cache": true } in package.json to speed up multi-file checks — see docs/design/persistent-cache.md';

// ---------------------------------------------------------------------------
// 门禁解析链单源（runCheck / runCheckFix 共用）
// ---------------------------------------------------------------------------

/** CLI 门禁选项形状（--entry-throws / --profile / --ignore-throws） */
type GateCliOptions = {
  ignoreThrows?: string[];
  entryThrows?: EntryThrowsMode;
  profile?: GateProfile;
};

/**
 * package.json#nudo.check.profile typo 警告（stderr 一行，不影响 exit code）：
 * 非法 profile 此前被 checkGateFromConfig 静默丢弃回落 strict——用户以为
 * 在 adoption 档。CLI 旗标有 validateGateFlags 校验而配置面没有。
 * entryThrows 不在此报：service 层 checkConfig 已单源告警
 * （`nudo.check.entryThrows: invalid value …`，LSP/CLI 同口径）。
 * 同一 typo 进程内去重（批量/多文件不重复刷屏；watch 跨轮不重报）。
 *
 * **文案按最终生效档位生成**（637）：旧文案写死 `using default strict`，
 * 而生效档位可能来自**同层** `check.entryThrows`（显式值优先）或 CLI 旗标
 * ⇒ 诊断说假话（用户读到「using default strict」以为门禁在 strict 档、
 * 自己的文件没过，实际 warning 档已放行、exit 0）。
 */
const warnedGateConfig = new Set<string>();
function warnInvalidGateConfig(
  config: Parameters<typeof checkConfig>[0],
  effective: { mode: EntryThrowsMode; isDefault: boolean },
): void {
  const invalid = invalidGateConfig(config);
  if (invalid.profile === undefined) return;
  // 去重键含生效档位：同一 typo 值在不同项目可能解析出不同档位 ⇒ 各报各的
  const suffix = effective.isDefault
    ? "using default strict"
    : `using ${effective.mode}`;
  const key = `${invalid.profile}\u0000${suffix}`;
  if (warnedGateConfig.has(key)) return;
  warnedGateConfig.add(key);
  console.error(
    `warning: package.json nudo.check.profile: unknown value "${invalid.profile}" (expected: adoption | strict) — ${suffix}`,
  );
}

/**
 * package.json#nudo.check.ignoreThrows 形状告警（stderr 一行，不影响 exit code）：
 * 数字 / 布尔 / 对象（以及数组里的非字符串元素）不是合法形态 ⇒ 回落默认
 * （= 不忽略任何 throw 类）。合法形态（裸字符串 / 字符串数组，含逗号分隔）
 * 由 configIgnoreThrows 统一解析，不在此报。
 * 同一形状进程内去重（同 profile 告警口径）。
 */
const warnedIgnoreThrowsConfig = new Set<string>();
function warnInvalidIgnoreThrowsConfig(
  config: Parameters<typeof checkConfig>[0],
): void {
  const invalid = invalidIgnoreThrowsConfig(config);
  if (invalid === undefined || warnedIgnoreThrowsConfig.has(invalid)) return;
  warnedIgnoreThrowsConfig.add(invalid);
  console.error(
    `warning: package.json nudo.check.ignoreThrows: invalid value "${invalid}" (expected: a throw type name, a comma-separated string, or an array of them) — using default (no ignored throw classes)`,
  );
}

/**
 * 门禁解析链（项目配置已知时的下半段）：
 * checkGateFromConfig → checkConfig → resolveEntryThrows（CLI 显式 >
 * CLI profile > pkg entryThrows > pkg profile > 默认 error）→
 * mergeIgnoreThrows（CLI 与 package.json 加法合并）。
 * runCheck 与 runCheckFix 共用此单源（G4：adoption 档项目 plain check
 * 与 --fix 不得一门绿一门红）。
 *
 * ignoreThrows 的配置面**不再**用 service checkConfig 的严格 `string[]`
 * 过滤（679）：那条过滤把 `"TypeError"` / `["TypeError,RangeError"]` 静默
 * 丢成空表 ⇒ 用户以为忽略了 TypeError，实际没忽略（门禁假红）。现在配置面
 * 与 CLI 面共用同一解析器（切逗号 + trim + 接受裸字符串 / 数组）。
 */
function resolveGateForConfig(
  config: Parameters<typeof checkConfig>[0],
  cli: GateCliOptions,
): { entryThrows: EntryThrowsMode; ignoreThrows: string[] } {
  const cCfg = checkConfig(config);
  const gate = checkGateFromConfig(config);
  const entryThrows = resolveEntryThrows(cli, gate, cCfg.entryThrows);
  warnInvalidGateConfig(config, {
    mode: entryThrows,
    // 生效档位 = 默认 strict ⟺ 解析链上**没有任何**显式来源（CLI 显式 /
    // CLI profile / 配置 entryThrows / 配置 profile 全空）且归一化回落 error
    isDefault:
      cli.entryThrows === undefined &&
      cli.profile === undefined &&
      gate.entryThrows === undefined &&
      gate.profile === undefined &&
      cCfg.entryThrows === "error",
  });
  warnInvalidIgnoreThrowsConfig(config);
  return {
    entryThrows,
    ignoreThrows: mergeIgnoreThrows(cli.ignoreThrows, configIgnoreThrows(config)),
  };
}

/** 门禁解析链（按文件解析项目配置）：runCheckFix 等 per-file 调用方使用。 */
function resolveGateForFile(
  file: string,
  cli: GateCliOptions,
): { entryThrows: EntryThrowsMode; ignoreThrows: string[] } {
  return resolveGateForConfig(findProjectConfig(dirname(file))?.config, cli);
}

// ---------------------------------------------------------------------------
// runCheck 段 1/3 — loadCache：项目/门禁/环境装配 + 磁盘缓存读取
// ---------------------------------------------------------------------------

/** runCheck 选项（action 层装配；jsonCollect / gitlabRowsCollect / gateFlags 为多文件聚合通道）；段3 渲染面（check-report.ts）消费 */

/**
 * --json 多文件聚合通道：注入装配失败标记 + **路径级错误行**（语法错 /
 * 输入读失败）——后者与路径错误同信封字段（attachPathErrors 挂 ok:false）。
 *
 * code 口径：语法错用非 `nudo:*` 的 file 级事实码 `syntax-error`（不进源
 * 文件诊断术语表）；输入读失败用 `nudo:path-io`（PathError 码表已有，
 * 630：读输入失败此前不走本通道 ⇒ `--json` 下 stdout 0 字节）。
 */
export type GateFlagsChannel = {
  injectionSetupFailed?: boolean;
  syntaxPathErrors?: Array<{
    path: string;
    code: "syntax-error" | typeof DIAG.pathIo;
    message: string;
    suggestion: string;
  }>;
};

export type RunCheckOptions = {
  json?: boolean;
  /** 多文件 --json：收集 CheckJson，不在本函数内打印 / 设 exit */
  jsonCollect?: CheckJson[];
  from?: CallRecord[];
  /**
   * `--from` **现场文件路径**（Bug 643）：调用点义务的静态证据源。
   *
   * `from`（执行态 `CallRecord[]`）只覆盖**被执行过**的调用点 ⇒ 被包在
   * 函数 / 箭头 / 方法体里的调用点整条失明 ⇒ 同一处静态可见的违例，
   * `nudo check <调用方>` 报红、`nudo check <被调方> --from <调用方>` 报绿。
   * 本字段给出现场文件路径 ⇒ check 面按**同文件通道的判据**（core
   * `scanLiteralCalls` 的静态全树扫描）复核一遍 ⇒ 两个通道同码同判据。
   */
  fromPaths?: string[];
  verbose?: boolean;
  abs?: boolean;
  absView?: { fn?: string; assume?: string[]; generalize?: boolean };
  ignoreThrows?: string[];
  entryThrows?: EntryThrowsMode;
  /** 门禁命名档（CLI --profile）；与 entryThrows 在 runCheck 内组合 */
  profile?: GateProfile;
  /** GitHub Actions 行内注解（或 GITHUB_ACTIONS=true 自动） */
  gha?: boolean;
  /** GitLab Code Quality JSON（数组） */
  gitlab?: boolean;
  /** 多文件 --gitlab：收集 Code Quality rows，action 层循环后一次打印单个数组 */
  gitlabRowsCollect?: GitlabCodeQualityIssue[];
  /**
   * 多文件 --json：注入装配失败跨文件聚合——降级分析可能零诊断
   * （CheckJson ok:true），失败态必须经共享对象带到信封 exit，
   * 否则 `envelope.ok ? 0 : 1` 覆盖成假绿。
   */
  gateFlags?: GateFlagsChannel;
  /**
   * --quiet：压 signatures 段（大仓 CI 日志降噪）——issues + summary +
   * 门禁 exit 语义不变；成功且零 issue 时只打一行摘要。仅人类文本面
   * （--json / --gitlab 机器契约不受影响）。
   */
  quiet?: boolean;
  /**
   * 人类面批次探针（#1/#9 聚合通道）：action 层仅在人类模式创建
   * （--json / --gitlab / --gha / --fix 的 stdout 与 stderr 都是机器契约面）。
   */
  batchProbe?: BatchProbe;
  /** 本轮最后一个目标：#1 onboarding 块在其 issues 段之后打印 */
  onboardingFinal?: boolean;
};

/** 段1产物：缓存命中态 + 缓存键输入（段3 决定是否回写）；段3 渲染面（check-report.ts）消费 */
export type CheckCacheState = {
  proj: ReturnType<typeof findProjectConfig>;
  autoBind: ReturnType<typeof interfaceConfig>["autoBind"];
  aCfg: ReturnType<typeof analysisConfig>;
  allEnvNames: string[];
  /** env 装配（项目级 / 文件级分层——Bug 647）：基准目录供诊断过滤与 --fix 面复用 */
  envs: EnvAssembly;
  entryThrows: EntryThrowsMode;
  ignoreThrows: string[];
  disk: DiskCache;
  cacheKey: string | undefined;
  /** 本轮是否命中磁盘缓存（命中则不回写） */
  cached: boolean;
  useDisk: boolean;
  cachedJson: CheckJson | undefined;
  /** package.json#nudo 键形状问题（468/936）或 nudo.env 非数组（934）——报告面可见（不要静默） */
  configShape: ConfigShapeIssue | null;
};

/**
 * package.json#nudo.env 的**形状**问题探针（934）。
 *
 * 背景：`nudo.env` 的值不是数组时，配置层回落默认（env 列表被丢弃），并给
 * 一条 stderr 提示 —— 但**报告面**看不到：用户只看到「env 没生效」的现象，
 * 不知道自己写错了（旧实现更糟：消费点直接 `projectEnvNames is not
 * iterable` ⇒ 五个 verb 全部裸崩；消费点现已显式 Array.isArray 守卫）。
 *
 * 与 468/936 的 `nudo` 键形状探针同一口径：同一个诊断码（config-shape）、
 * 同一种 issue 形状（pkgPath = 出问题的 package.json + value + message），
 * 报告面（人类面 issues 段 + `--json` 面）都可见。
 *
 * 停步规则不需要重走：项目配置已由 findProjectConfig 定位（`proj.projectDir`
 * = 提供配置的 package.json 所在目录），直接读那一份即可。
 */
function projectEnvShapeIssue(projectDir: string | undefined): ConfigShapeIssue | null {
  if (!projectDir) return null;
  const pkgPath = resolve(projectDir, "package.json");
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null; // 读/解析失败：service 侧另有诊断，本探针不重复
  }
  if (pkg === null || typeof pkg !== "object") return null;
  const nudo = (pkg as { nudo?: unknown }).nudo;
  if (nudo === null || typeof nudo !== "object" || Array.isArray(nudo)) return null;
  const raw = (nudo as { env?: unknown }).env;
  if (raw === undefined || Array.isArray(raw)) return null;
  let shown: string;
  try {
    const s = JSON.stringify(raw);
    shown = s === undefined ? String(raw) : s;
  } catch {
    shown = typeof raw;
  }
  return {
    pkgPath,
    value: shown,
    falsy: !raw,
    message:
      `package.json at ${pkgPath} has an invalid "nudo.env" value ` +
      `(${shown}; expected an array of strings) — this env list is ignored ` +
      `(the default env set applies)`,
  };
}

/**
 * env 名装配产物（**分层**：项目级 / 文件级）。
 *
 * `allEnvNames` = 收集期（collectEnvGlobals / collectEnvModules）用的合并名表；
 * `projectEnvNames` / `fileEnvNames` = 两层各自的名单（预载与诊断过滤用）。
 */
export type EnvAssembly = {
  /** 合并后的 env 名（项目级在前，文件级在后） */
  allEnvNames: string[];
  /** 项目级 env 名（相对说明符已按**项目根**绝对化） */
  projectEnvNames: string[];
  /** 文件级 env 名（相对说明符保持相对——按**文件目录**解析） */
  fileEnvNames: string[];
  /** 项目级 env 的解析基准（项目根；无项目配置时回落文件目录） */
  projectEnvBaseDir: string;
  /** 文件级 env 的解析基准（被分析文件所在目录） */
  fileEnvBaseDir: string;
};

/**
 * env 名装配 + path env 预载（**分层**——Bug 647）。
 *
 * 口径：
 * - **项目级**（package.json#nudo.env）按**项目根**解析 —— 文档承诺
 *   「every file in the project uses them」；
 * - **文件级**（`/// @nudo:env <path>`）按**被分析文件所在目录**解析。
 *
 * 旧实现把两层拍平成一个列表、统一按「被分析文件所在目录」预载 ⇒ 子目录里的
 * 文件**永远拿不到**项目级 path env ⇒ 假红（`never` + `nudo:env-unresolved`）。
 *
 * 两处配套细节（缺一不可）：
 * 1. 项目级**相对说明符**先绝对化（按项目根）：收集期（loadEnvs）的查表基准
 *    是「**最后一次** preload 的目录」，而相对说明符只有**唯一候选** ⇒ 不绝对化
 *    则子目录文件查表必然落空；
 * 2. 两次 preload 的顺序 = 项目级先、文件级后 ⇒ 进程级 env 基准槽最后落在
 *    **文件目录**（文件级相对说明符的解析基准）。
 */
async function assembleEnvs(
  filePath: string,
  source: string,
  proj: ReturnType<typeof findProjectConfig>,
): Promise<EnvAssembly> {
  // package.json#nudo.env 必须是数组：非数组时配置层回落默认（[]），但**消费
  // 点**不许裸崩（934：`projectEnvNames is not iterable` ⇒ 五个 verb 全崩）。
  // 形状问题由 projectEnvShapeIssue 报告（见上），门禁本身继续跑（回落默认 env）。
  const rawProjectEnv = proj?.config.env;
  const projectEnvNames = Array.isArray(rawProjectEnv) ? rawProjectEnv : [];
  // 文件级 @nudo:env 命名 env（es/node/web）与项目配置合并——check 的
  // 符号面必须与 test 同口径注入，否则 @nudo:env 文件整体退化 unknown。
  const fileEnvNames = fileEnvNamesFromText(source);
  const fileEnvBaseDir = dirname(filePath);
  const projectEnvBaseDir = proj?.projectDir ?? fileEnvBaseDir;
  const projectEnvSpec = projectEnvNames.map((name) =>
    typeof name === "string" && (name.startsWith("./") || name.startsWith("../"))
      ? resolve(projectEnvBaseDir, name)
      : name,
  );
  await preloadPathEnvs(projectEnvSpec, projectEnvBaseDir);
  await preloadPathEnvs(fileEnvNames, fileEnvBaseDir);
  return {
    allEnvNames: [...new Set([...projectEnvSpec, ...fileEnvNames])],
    projectEnvNames: projectEnvSpec,
    fileEnvNames,
    projectEnvBaseDir,
    fileEnvBaseDir,
  };
}

/**
 * 按键去重（同一 env 文件在两层基准下各记一条 ⇒ 只留一条）。
 * 键由调用方给（env 加载失败 = 路径 + 文案；env 依赖内容 = 路径）。
 */
function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * check 面**自己**试过的 env 解析路径（env 加载失败诊断的过滤基准）。
 *
 * path env 的加载失败按**解析后的路径**记录；进程级注册表里还有**分析器通道**
 * （service 的 `analyzeFileAsync`）的 preload 记录——它按「被分析文件所在目录」
 * 解析**项目级** env 名（service 侧同源缺陷，见报告「越界发现」）⇒ 会留下一条
 * **check 面从未请求过**的路径（例：`<项目根>/src/env/web.ts`）⇒ 报告面若照单
 * 全收就说「env 没加载」，而 env 其实**已加载**（Bug 647 修完后的假绿残留）。
 *
 * ⇒ 只报 check 面**自己**试过的路径（项目级按项目根、文件级按文件目录）；
 * **未知名**（path 形如名字本身，非绝对路径）一律保留（必须可见）。
 */
function expectedEnvPaths(envs: EnvAssembly): Set<string> {
  const out = new Set<string>();
  for (const name of envs.projectEnvNames) {
    if (typeof name === "string") out.add(resolve(envs.projectEnvBaseDir, name));
  }
  for (const name of envs.fileEnvNames) {
    if (typeof name === "string") out.add(resolve(envs.fileEnvBaseDir, name));
  }
  return out;
}

async function loadCheckCache(
  filePath: string,
  source: string,
  opts: GateCliOptions & { from?: CallRecord[]; verbose?: boolean; abs?: boolean },
): Promise<CheckCacheState> {
  const proj = findProjectConfig(dirname(filePath));
  const { entryThrows, ignoreThrows } = resolveGateForConfig(proj?.config, opts);
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const aCfg = analysisConfig(proj?.config);
  // env 名装配（项目级 / 文件级分层）+ path env 预载见 assembleEnvs
  // （Array.isArray 守卫与 934 的形状问题同在那边）。
  const cacheRoot = diskCacheRoot(proj?.config, proj?.projectDir);
  const disk = new DiskCache({ root: cacheRoot, namespace: "check" });
  const dep = collectLoadDepContents(filePath, source, defaultLoadModule);
  const hasBareMiss = (dep.depContents ?? []).some((d) => d.content == null);
  const useDisk = shouldUseDiskCache({
    diskEnabled: disk.enabled,
    hasFrom: !!opts.from,
    depTruncated: dep.truncated,
    hasBareMiss,
  });
  let sidecarContent: string | null = null;
  if (autoBind !== false) {
    // sidecar 读取失败分类：ENOENT = 无 sidecar（合法 miss，静默 absent）；
    // EACCES/EISDIR 等读失败必须上屏——静默当 absent 会让 check 假绿。
    // 措辞必须区分「不存在」与「读不到」（Bug 499）：文件就在那儿，只是
    // 读不了——说成「treating as absent」与事实相反（用户会去建一个
    // 已经存在的契约文件）。
    const scPath = sidecarPathOf(filePath);
    try {
      sidecarContent = readFileSync(scPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          `warning: cannot read sidecar contract ${scPath}: ${(err as Error).message} — the contract is unreadable (not absent); its constraints are not applied`,
        );
      }
      sidecarContent = null;
    }
  }
  // path 型 env（nudo.env / /// @nudo:env <path>）在 check 门禁下必须
  // 与 test/LSP 同口径 preload——否则自定义 env 静默退化 env-关（issue #89）。
  // 基准**分层**（Bug 647）：项目级按项目根、文件级按文件目录。
  const envs = await assembleEnvs(filePath, source, proj);
  // path env 文件内容纳入磁盘缓存指纹（mtime→content sha 变更即 cache miss）；
  // 按**各自**的 preload 目录过滤——批量 check 时其它项目的 env 内容折进
  // 缓存键会造成误 miss（进程级注册表无归属，见 getPathEnvDepContents）
  const envDepContents = dedupeByKey(
    [...getPathEnvDepContents(envs.fileEnvBaseDir), ...getPathEnvDepContents(envs.projectEnvBaseDir)],
    (d) => d.path,
  );
  const depContentsForKey = [...(dep.depContents ?? []), ...envDepContents];
  const cacheKey = shouldComputeCacheKey({
    useDisk,
    verbose: opts.verbose,
    abs: opts.abs,
  })
    ? checkCacheKey(filePath, source, {
          autoBind,
          projectDir: proj?.projectDir,
          sidecarContent,
          depContents: depContentsForKey,
          projectEnvNames: envs.allEnvNames,
          analysisCfg: {
            mode: aCfg.mode,
            evalMissingSlot: aCfg.evalMissingSlot,
            callSiteBudget: aCfg.callSiteBudget,
            entryThrows,
            ignoreThrows: ignoreThrows.join(","),
            maxForks: aCfg.maxForks,
          },
        })
    : undefined;
  const cachedJson =
    !strictParseFails(filePath, source) && cacheKey
      ? disk.get<CheckJson>(cacheKey)
      : undefined;
  return {
    proj,
    autoBind,
    aCfg,
    allEnvNames: envs.allEnvNames,
    /** env 装配（分层基准——诊断过滤与 --fix 面复用同一口径） */
    envs,
    entryThrows,
    ignoreThrows,
    disk,
    cacheKey,
    cached: cachedJson !== undefined,
    useDisk,
    cachedJson,
    // package.json#nudo 键形状问题（468/936）：service 侧按「本包无配置」
    // 处理并给 stderr 提示，但报告面看不到 ⇒ 这里补一份报告面可见的诊断
    // （并让 onboarding 不再谎报「本项目还没有 nudo 配置」）。
    // nudo.env 非数组（934）是同一族的形状问题：`nudo` 键本身合法 ⇒ 上面的
    // 探针看不见它，但 env 已被配置层丢弃（回落默认）⇒ 报告面必须说得出
    // 「你写的 env 被忽略了」，否则用户只看到「env 没生效」的现象。
    configShape:
      projectConfigShapeIssue(dirname(filePath)) ??
      projectEnvShapeIssue(proj?.projectDir),
  };
}

// ---------------------------------------------------------------------------
// runCheck 段 2/3 — buildInjection：eval 注入包装配
//（模块图 + mocks + env 全局 + replace/as）
// ---------------------------------------------------------------------------

/**
 * eval 注入包装配。装配失败 throw——由调用方降级处理（BUG-023：
 * 分析仍跑，但门禁红且缓存不回写）。同文件内复用同一注入对象
 * （checkSource/generalize memo 键按对象身份）。
 *
 * 装配本体是 `shared.ts` 的 buildEvalInjection（#9 去重，与 migrate verify
 * 同一实现）；此处只注入 check 面的解析策略——`parseForCheck`（按扩展名
 * 选插件，Bug 633：`.js` 里的 TS-only 语法在此**抛错** ⇒ 走语法错通道
 * （人类面 tsc 风格块 / --json 面 pathErrors），不静默判绿）。
 */
function buildCheckInjection(
  filePath: string,
  source: string,
  allEnvNames: string[],
  dirDiags: DirectiveDiag[],
): { inject: RunTranspiledOptions; mockFromErrors: MockFromError[] } {
  return buildEvalInjection(filePath, source, allEnvNames, dirDiags, parseForCheck);
}

/**
 * 严格解析（按扩展名）是否失败——**只**用于「不吃旧磁盘缓存」判定，不抛错。
 *
 * Bug 633：旧版本（typescript 插件无条件开）曾把 `.js` 里的 TS-only 语法判绿
 * 并把「OK」写进磁盘缓存 ⇒ 升级后命中那条陈旧条目 ⇒ 假绿继续存活。
 * ⇒ 严格解析失败时**跳过缓存命中**，走正常分析路径 ⇒ 语法错通道判红。
 */
function strictParseFails(filePath: string, source: string): boolean {
  try {
    parseForCheck(filePath, source);
    return false;
  } catch {
    return true;
  }
}

/**
 * check 面的源码解析入口：**按扩展名**选解析插件（core `parseSource` 的
 * `filename` 口径——`.js` 不开 typescript 插件）。
 *
 * Bug 633：`.js` 里的 TS-only 语法（`private x = 0` / `as T` / `interface` /
 * `enum` …）此前被**静默接受** ⇒ `nudo check` 对一个 **Node 自己都拒绝**
 * （`node --check` 报 SyntaxError）的文件判绿 ⇒ CI 门禁假绿。
 *
 * 口径：严格解析失败、而宽松解析（typescript 插件）成功 ⇒ 判定为
 * 「TS-only 语法」⇒ 报成语法错并说清原因（位置信息保留）；两者都失败 ⇒
 * 真语法错，原样上屏。
 */
function parseForCheck(filePath: string, source: string): File {
  try {
    return parseSource(source, { filename: filePath });
  } catch (err) {
    let lenientOk = false;
    try {
      parseSource(source);
      lenientOk = true;
    } catch {
      lenientOk = false;
    }
    if (!lenientOk) throw err;
    throw tsOnlySyntaxError(err);
  }
}

/** TS-only 语法错误（`.js` 里出现 TS 语法）——补一句人话，原错误位置信息保留 */
function tsOnlySyntaxError(err: unknown): SyntaxError {
  const src = err as { message?: string; loc?: { line: number; column: number } };
  const raw = String(src?.message ?? err ?? "");
  const tail = /\s*\(\d+:\d+\)\s*$/.exec(raw)?.[0] ?? "";
  const essence = raw.replace(/\s*\(\d+:\d+\)\s*$/, "").trim();
  const next = new SyntaxError(
    `TypeScript-only syntax is not valid in a .js file: ${essence}${tail}`,
  );
  if (src?.loc) {
    (next as SyntaxError & { loc?: { line: number; column: number } }).loc = src.loc;
  }
  return next;
}

/**
 * import 说明符 → 被调方文件路径（Bug 643 静态扫描的归因键）。
 *
 * service 的 `resolveModule` 吃**目录**并回 `{filePath}`；`defaultLoadModule`
 * 回的是**源码**（不能当路径用）⇒ 这里单独做一层目录适配。
 */
function resolveModulePath(specifier: string, fromFile: string): string | undefined {
  try {
    return resolveModule(specifier, dirname(fromFile))?.filePath;
  } catch {
    return undefined;
  }
}

/**
 * `--from` 现场文件集合（Bug 643）。
 *
 * 两条来源取并集：
 * - `fromPaths`（**路径**通道）：CLI 交上来的 `--from` 现场文件路径 ⇒ 覆盖
 *   「现场文件里没有任何被执行过的调用」的情形（执行态记录为空 ⇒ 旧通道
 *   整条失明，这正是 Bug 643 的症状面）。
 * - 执行态记录上的 `callSiteFile`（**记录**通道）：已有执行态证据时，现场
 *   文件路径已经带在记录上 ⇒ 顺带纳入静态复核（补齐同文件里其余未被执行
 *   的调用点）。
 *
 * 读不到的文件直接跳过（无证据 ⇒ 不造门禁）。
 */
function fromCallsiteFiles(opts: RunCheckOptions): FromCallsiteFile[] {
  const paths = new Set<string>();
  for (const p of opts.fromPaths ?? []) {
    const abs = resolve(p);
    // `--from` 允许目录（与 collectExternalRecords 同口径）⇒ 展开成文件
    try {
      if (statSync(abs).isDirectory()) {
        for (const f of collectNudoFiles(abs)) paths.add(f);
        continue;
      }
    } catch {
      /* 读不到 ⇒ 下面按文件读再跳过一次 */
    }
    paths.add(abs);
  }
  for (const rec of opts.from ?? []) {
    const site = (rec as { callSiteFile?: string }).callSiteFile;
    if (site) paths.add(resolve(site));
  }
  const out: FromCallsiteFile[] = [];
  for (const p of paths) {
    try {
      out.push({ path: p, source: readFileSync(p, "utf-8") });
    } catch {
      /* 读不到现场文件 ⇒ 无证据（不造门禁） */
    }
  }
  return out;
}

/**
 * checkSource 的**分析输入装配**（`runCheck` 与 `runCheckFix` 共用单源）。
 *
 * 口径（Bug 640）：`nudo check` 与 `nudo check --fix` 必须喂给分析器**同一套**
 * 输入——autoBind（侧车是否环境绑定）/ projectDir（项目根）/ entryThrows /
 * ignoreThrows / inject·modules（`@nudo:mock` 的替换、`@nudo:env` 的全局、
 * 模块图）/ skips。旧实现 `runCheckFix` 只传 loadModule / fromFile /
 * ignoreThrows / entryThrows / skips ⇒ 两条命令对**同一文件**给出**相反**的
 * 门禁结论（`@nudo:mock` 不生效 ⇒ 假红；`autoBind:false` 不生效 ⇒ 假绿 /
 * CI 假通过）。
 *
 * 装配项全部来自**同一处**（本函数）⇒ 两条命令**不可能**再分叉。
 */
type CheckSourceInputs = {
  /** 被检查文件（绝对路径） */
  filePath: string;
  /** 文件源码（`skips` 从中抽） */
  source: string;
  /** 侧车环境绑定（`nudo.contract.autoBind`；false ⇒ 不绑定） */
  autoBind: ReturnType<typeof interfaceConfig>["autoBind"];
  /** 项目根（ambient 侧车 / 模块解析的项目基准） */
  projectDir: string | undefined;
  /** L2 门禁档（error / warning / ignore） */
  entryThrows: EntryThrowsMode;
  /** 忽略的 throws 类 */
  ignoreThrows: string[];
  /** eval 注入包（modules / mocks / envGlobals / replacements / asOverrides） */
  inject: RunTranspiledOptions | undefined;
  /** `--from` 采集的执行态调用点证据（仅 plain check 有） */
  from?: AbsCallRecord[];
};

function checkSourceOptions(inputs: CheckSourceInputs): CheckOptions {
  const { filePath, source } = inputs;
  return {
    loadModule: defaultLoadModule,
    fromFile: filePath,
    ...(inputs.autoBind === false ? { autoBind: false } : {}),
    ...(inputs.projectDir ? { projectDir: inputs.projectDir } : {}),
    entryThrows: inputs.entryThrows,
    ...(inputs.ignoreThrows.length > 0 ? { ignoreThrows: inputs.ignoreThrows } : {}),
    ...(inputs.inject && Object.keys(inputs.inject).length > 0
      ? { modules: inputs.inject.modules as never, inject: inputs.inject }
      : {}),
    ...(inputs.from && inputs.from.length > 0 ? { from: inputs.from } : {}),
    skips: collectSkipReturns(source),
  };
}

/**
 * 输入读取失败 → **显式路径错误**（630）。
 *
 * 旧实现：`runCheck` 的 `readFileSync` 无 try/catch ⇒ EACCES/EIO 异常**逃逸**
 * 出命令层 ⇒ 顶层兜底只打一行裸 errno ⇒ `--json` 面 **stdout 0 字节** +
 * exit 1（违反 cli-semantics「--json 下 stdout 永不为空 / 绝不出现空 stdout
 * + 非零 exit」）；同族的其它路径错误（不存在 / 空目录 / 非目标 / --out 写
 * 失败）都走 `pathErrors[]` 信封，唯独「读输入」这条路漏了。
 *
 * 现在：归一到 `PathError{code:"nudo:path-io"}`——
 * - `--json` 面：进 `gateFlags.syntaxPathErrors`（与路径错误同信封字段）⇒
 *   信封 `ok:false` + `pathErrors[]`，stdout 非空；
 * - 人类面：`reportPathErrors` ⇒ 一行 message + `fix:` 提示（同一 face）。
 */
function reportInputReadError(
  filePath: string,
  err: unknown,
  opts: RunCheckOptions,
): void {
  const reason = err instanceof Error ? err.message : String(err);
  const pathError: PathError = {
    path: filePath,
    code: DIAG.pathIo,
    message: `Cannot read ${filePath}: ${reason}`,
    suggestion:
      "check the path exists and is readable (file permissions / IO); fix the path or grant access, then re-run",
  };
  if (opts.json) {
    // json ⇒ gateFlags 必在（action 层两侧都装配）；自愈式兜底防未来调用面
    // 漏传导致静默丢 ok:false
    const flags = (opts.gateFlags ??= {});
    (flags.syntaxPathErrors ??= []).push({
      path: pathError.path,
      code: DIAG.pathIo,
      message: pathError.message,
      suggestion: pathError.suggestion,
    });
  } else {
    reportPathErrors([pathError]);
  }
  // BUG-284：文件级硬错误也必须进 CI 注解通道（--gitlab 恰好一份数组 /
  // --gha 至少一条 ::error）——旧实现只喂 --json 与人类面 ⇒ 两个机器通道
  // 对同一个失败文件给出 0 条。
  emitHardErrorCiAnnotations([pathError], opts);
  // #1 指纹：读输入失败是非 L2 error（不得触发 onboarding 块）
  if (opts.batchProbe) opts.batchProbe.nonL2Error = true;
  process.exitCode = 1;
}

export async function runCheck(file: string, opts: RunCheckOptions = {}): Promise<void> {
  const filePath = resolve(file);
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    // 输入读取失败（EACCES / EIO / …）——**显式路径错误**（630）：
    // 旧实现让异常逃逸出命令层 ⇒ `--json` 面 stdout 0 字节 + stderr 裸 errno
    // （违反「--json 下 stdout 永不为空」）。现在归一到 PathError{path-io}：
    // --json 面并入 pathErrors 信封（ok:false），人类面给 message + fix:。
    reportInputReadError(filePath, err, opts);
    return;
  }

  // 段1 loadCache：项目/门禁/环境装配 + 磁盘缓存读取
  const cache = await loadCheckCache(filePath, source, opts);

  let report: CheckReport;
  let mockFromErrors: MockFromError[] = [];
  // 注入装配失败（BUG-023）：降级分析仍跑，但门禁必须红且缓存不回写
  let injectionSetupFailed = false;
  // interface 家族诊断（entry-only / domain-exceeds）——分析器通道产物
  let domainIssues: CheckIssue[] = [];
  // 1145：**模块级求值失败**观测（本文件求值期间的引擎内部回落）。
  //
  // core 的回落三分类（`exec/run.ts` 的 `evalFallbackOf`）：
  // - `unsupported:*` 能力边界（transpile 未 lowering 的构造）——**不是**闸门失败；
  // - `module-throw`  程序自身抛（NudoThrow；catch 可吸收）——**不是**闸门失败；
  // - `internal`      引擎内部缺陷（生成模块编译失败 / 求值抛内部错误）
  //   ⇒ 该模块**全部导出丢失** ⇒ 闸门看不到任何入口 ⇒ 零诊断 + exit 0
  //   ⇒ **闸门假绿**（合法代码与违约代码都判绿）。
  //
  // ⇒ 判据是**可见性**（core 的 `gateFatal`，与标签是两个维度），不是标签：
  // - `internal`（引擎/宿主边界违约）⇒ 收（既有语义）；
  // - **装载期逃逸的原生异常**（标签 `module-throw`，`gateFatal === true`）⇒ 也收：
  //   模块装载失败 ⇒ 闸门看不到任何入口 ⇒ 零诊断 + exit 0 = **假绿**（BUG-072）；
  //   无句法证据的装载失败（顶层 `JSON.parse(userInput)` / 顶层调用会抛的函数）
  //   只有这条通道能兜住。
  // - `unsupported:*`（能力边界）与**建模内**的 `NudoThrow`（catch 可吸收）
  //   `gateFatal === false` ⇒ **不收**（进了就是**假红**，大面积误判 ⇒ 用户 CI 卡死）。
  //
  // collector 是**进程级单槽**（core 的 `setEvalFallbackCollector`）：本函数
  // 安装期间覆盖全进程 ⇒ 只能有一个观察者（service 的观测面 API 不在本路径
  // 上调用，见 `analyzer-orchestrate.ts` 的 `analyzeFileWithEvalFailures`）。
  const evalFailures: EvalFallback[] = [];
  setEvalFallbackCollector((f: EvalFallback) => {
    if (f.reason === "internal" || f.gateFatal === true) evalFailures.push(f);
  });
  if (cache.cachedJson) {
    // env-unresolved 是 live 瞬态：旧缓存可能已持久化该条目（命中轮 live
    // merge 会再追加 → 重复告警），读回时剔除，由下方 live merge 单一来源注入
    cache.cachedJson = stripEnvUnresolvedIssues(cache.cachedJson);
    // 配置形状诊断（468/936）同理：形状由本轮现场探针判定（配置可能刚被
    // 改好/写坏）⇒ 读回剔除 + live merge 单一来源（mergeCheckIssues 只追加）。
    cache.cachedJson = stripConfigShapeIssues(cache.cachedJson);
    report = reportFromCachedJson(cache.cachedJson);
    // 缓存私有 ret 已被上面消费：--json / jsonCollect / mergeJsonIssues
    // 面必须是纯 CheckJson 契约（与 miss 轮 serializeCheckJson 字节一致）
    cache.cachedJson = stripCachedSigRets(cache.cachedJson);
  } else {
    // D1: 指令文法诊断（nudo:directive-syntax）显式通道——buildCheckInjection
    // 内的发射源同步落 dirDiags（无模块级 buffer、无 seq 锚）
    const dirDiags: DirectiveDiag[] = [];
    // 段2 buildInjection：eval 注入包（模块图 + mocks + env 全局 + replace/as）
    let inject: RunTranspiledOptions | undefined;
    try {
      const built = buildCheckInjection(filePath, source, cache.allEnvNames, dirDiags);
      inject = built.inject;
      mockFromErrors = built.mockFromErrors;
    } catch (err) {
      // 语法错文件：checkSource 走同一解析也会 throw（旧行为漏到顶层
      // catch：裸 message、无文件名/摘录/指位且 stdout 全空）——这里
      // 单点拦下：人类面 tsc 风格块（path:line:col + 摘录 + ^ 指位）、
      // --json 面并入信封 pathErrors（与路径错误同字段，ok:false）。
      const syntax = syntaxErrorInfo(err);
      if (syntax) {
        const syntaxSuggestion =
          "fix the syntax error; run `nudo check` without --json for a source excerpt with a caret";
        // BUG-284：文件级硬错误的事实面（--gitlab / --gha 也要拿到）——
        // 旧实现只有 --json 与人类块两个分支 ⇒ 两个 CI 机器通道完全静默。
        const hardError: CiHardError = {
          path: filePath,
          code: "syntax-error",
          message: `${syntax.line}:${syntax.column + 1} — syntax error: ${syntax.essence}`,
          line: syntax.line,
          column: syntax.column,
          suggestion: syntaxSuggestion,
        };
        if (opts.json) {
          // json ⇒ gateFlags 必在（action 层 1273/1290 两侧都装配）；自愈式
          // 兜底防未来调用面漏传导致静默丢 ok:false
          const flags = (opts.gateFlags ??= {});
          (flags.syntaxPathErrors ??= []).push({
            path: filePath,
            code: "syntax-error",
            message: hardError.message,
            suggestion: syntaxSuggestion,
          });
        } else {
          console.error(paint(formatSyntaxErrorBlock(filePath, source, syntax)));
        }
        emitHardErrorCiAnnotations([hardError], opts);
        injectionSetupFailed = true;
        if (opts.gateFlags) opts.gateFlags.injectionSetupFailed = true;
        // #1 指纹：语法错是非 L2 error（不得触发 onboarding 块）
        if (opts.batchProbe) opts.batchProbe.nonL2Error = true;
        process.exitCode = 1;
        // 1145：早退路径也要卸掉回落 collector（否则下一文件的回落会被
        // 记到本文件名下 ⇒ 误判别的文件）。
        setEvalFallbackCollector(null);
        return;
      }
      // BUG-023：注入装配失败不得静默跳过——无注入的分析
      // 会把未 mock 的模块图当作事实（假绿：签名看似通过
      // 实则基于错误依赖）。上屏（含文件名）+ 失败态标记，分析仍跑
      // （观察面完整）；exit 由段3统一判定（不在此中途赋值：
      // --json 信封 / 缓存判定在其后，中途赋值会被
      // `ok ? 0 : 1` 覆盖回假绿），降级产物也不得写磁盘缓存
      // （否则下次 check 命中缓存整体跳过注入装配 → 静默转绿）。
      console.error(
        `error: analysis setup failed for ${filePath}: ${(err as Error).message}`,
      );
      injectionSetupFailed = true;
      if (opts.gateFlags) opts.gateFlags.injectionSetupFailed = true;
    }
    // Bug 461：普通 check 路径（无 --from）也必须跑分析器 —— 否则
    // `nudo:interface-entry-only`（L1 info：「导出无契约根且无调用点域」）
    // 在 check 面不可达，而 `nudo health` 走分析器统计仍报「N entry-only」
    // ⇒ 同一事实两 verb 口径分裂。文档承诺：guides/check.md 诊断表
    // （`nudo:interface-entry-only | L1 | info`）与 reference/diagnostics.md。
    //
    // **必须先于 checkSource 跑**：core 的侧车加载失败去重表按作用域共享。
    // 分析器先探侧车 → 它取走自己那一份 interface-load 诊断并据此抑制
    // 「无契约根」误报（侧车存在但加载失败 ≠ 没有契约）；checkSource 入口
    // 会 reset 该去重表 ⇒ 它自己重新上报一份 interface-load error
    // ⇒ 两条路径都拿得到诊断。顺序反了，分析器会因去重表已被 checkSource
    // 占用而误报「无契约根」。
    //
    // 白名单仍是 domainIssuesFromDiagnostics（interface 家族的唯一入口）——
    // 分析器的其它诊断不进 check 面，不放大诊断面。
    try {
      const analysis = await analyzeFileAsync(
        filePath,
        source,
        undefined,
        opts.from,
        undefined,
        "none",
      );
      domainIssues = domainIssuesFromDiagnostics(analysis.diagnostics);
    } catch {
      /* 分析器通道失败不得拖垮 check（诊断面降级，不造门禁） */
    }
    // Bug 366：`--from` 采集的跨文件调用点证据进入 core 的 drift 判定
    // （此前今日域证据只来自被检查文件自身的求值 ⇒ 靠 --from 写出的生成段
    // 永远判不出陈旧）。归因口径见 externalAbsCallRecords（只收指向本文件
    // 的记录 ⇒ 别的模块里的同名函数不污染本文件的判定）。
    const externalAbsRecords = externalAbsCallRecords(filePath, opts.from);
    // 分析输入装配**单源**（checkSourceOptions）——`--fix` 面走同一构造
    // （Bug 640：两条命令喂给分析器的输入集必须一致）。
    report = checkSource(
      filePath,
      source,
      pTrue,
      checkSourceOptions({
        filePath,
        source,
        autoBind: cache.autoBind,
        projectDir: cache.proj?.projectDir,
        entryThrows: cache.entryThrows,
        ignoreThrows: cache.ignoreThrows,
        inject,
        from: externalAbsRecords,
      }),
    );
    // D1: 指令文法诊断（nudo:directive-syntax）并入 check 报告
    if (dirDiags.length > 0) {
      report = mergeCheckIssues(report, directiveDiagIssues(dirDiags));
    }
  }
  // 1145：求值阶段结束 ⇒ 卸掉本文件的回落 collector（下一文件重新装 ⇒
  // 回落**按文件**归因，不串台）。
  setEvalFallbackCollector(null);

  // 1145：**模块级求值失败 ⇒ 闸门 fail-closed**（不得静默放绿）。
  //
  // `internal` 回落 = 引擎内部缺陷（生成模块编译失败 / 求值抛内部错误）⇒
  // 该模块**全部导出丢失** ⇒ 闸门看不到任何入口 ⇒ 零诊断 + exit 0
  // （**假绿**：合法代码与违约代码都判绿）。现在产出一条 **error 级**诊断
  // ⇒ 报告 ok:false ⇒ exit 1（人类面 / --json 面同源，退出码由 ok 单一决定）。
  //
  // 诊断码 = `nudo:internal`（**已注册**码，语义正合："Internal analysis/check
  // failure surfaced as a diagnostic (check gate could not run to completion)"）
  // ⇒ 不新增第二套码表。机器面判据：`issues[].code === "nudo:internal"`
  // 且 `severity === "error"`。
  // 两条通道分开发诊断（**标签 ≠ 可见性**，BUG-073 + BUG-072）：
  // - `internal`（引擎/宿主边界违约）⇒ `nudo:internal` + 「报引擎 bug」文案；
  // - **装载期逃逸的用户代码异常**（标签 `module-throw`、`gateFatal === true`）⇒
  //   `nudo:module-throw` + 指向**用户代码**的文案（BUG-073：不得让用户去报
  //   引擎 bug），但同样 fail-closed（BUG-072：模块装载失败不得判绿）。
  const engineFailures = evalFailures.filter((f) => f.reason === "internal");
  const loadThrows = evalFailures.filter((f) => f.reason !== "internal");
  if (engineFailures.length > 0) {
    // 同一原因会被多个求值通道各记一条（模块图 / 分析器 / checkSource）⇒
    // 文案去重（条数仍如实报回落**总**数）。
    const detail = [...new Set(engineFailures.map((f) => f.message))].join("; ");
    const issue: CheckIssue = {
      severity: "error",
      code: DIAG.internal,
      message: `${ANALYSIS_FAILED_PREFIX} (engine internal fallback ×${engineFailures.length}): ${filePath} — ${detail}`,
      suggestion:
        "the module could not be evaluated (engine internal failure) — the gate could not decide this file; fix the reported cause, or report it as an engine bug together with the checked source file",
    };
    report = mergeCheckIssues(report, [issue]);
    // 人类面：明确的失败行（哪个文件 + 什么原因）——走 stderr（--json 面的
    // stdout 是机器契约，不得混入自由文本；与「注入装配失败」同一通道）。
    console.error(
      `error: analysis failed for ${filePath}: module evaluation failed (engine internal fallback ×${engineFailures.length}) — ${detail}`,
    );
    // #1 指纹：分析失败是非 L2 error（不得触发 onboarding 块）
    if (opts.batchProbe) opts.batchProbe.nonL2Error = true;
  }
  if (loadThrows.length > 0) {
    const detail = [...new Set(loadThrows.map((f) => f.message))].join("; ");
    const issue: CheckIssue = {
      severity: "error",
      code: DIAG.moduleThrow,
      message: `${filePath} — module evaluation failed: ${detail} (the module throws while loading)`,
      suggestion:
        "the module could not be evaluated — its top-level code throws (the gate could not decide this file); fix the reported cause",
    };
    report = mergeCheckIssues(report, [issue]);
    console.error(
      `error: analysis failed for ${filePath}: module evaluation failed ×${loadThrows.length} — ${detail}`,
    );
    if (opts.batchProbe) opts.batchProbe.nonL2Error = true;
  }

  // @nudo:mock name from "path" 解析失败 → check 明确报错（缺文件/缺绑定/求值失败）
  if (mockFromErrors.length > 0) {
    report = mergeCheckIssues(report, mockFromErrorIssues(mockFromErrors));
  }

  // path env 加载失败必须可见（issue #88）：warning，不让 silent 降级为 env-关。
  // live 瞬态：每轮现场注入（report + 命中轮的 cachedJson——--json 面缓存
  // 命中走 cachedJson 而非 report 序列化，不同口径注入会首跑/命中不一致）。
  // 按**各自**的 preload 目录过滤：文件级按文件目录、项目级按项目根
  // （Bug 647：旧实现只按文件目录取 ⇒ 项目级 env 的失败被静默丢弃）；
  // 批量 check 时其它项目（如 R1）的 env 加载失败不得泄进本项目（R2）文件报告。
  const expectedEnvPathsSet = expectedEnvPaths(cache.envs);
  const envLoadErrors = dedupeByKey(
    [
      ...getPathEnvLoadErrors(cache.envs.fileEnvBaseDir),
      ...getPathEnvLoadErrors(cache.envs.projectEnvBaseDir),
    ],
    (e) => `${e.path}\u0000${e.error}`,
  ).filter((e) => !isAbsolute(e.path) || expectedEnvPathsSet.has(e.path));
  if (envLoadErrors.length > 0) {
    const envIssues = envLoadErrors.map((e) => ({
      severity: "warning" as const,
      code: ENV_UNRESOLVED_CODE,
      message: `path env failed to load: ${e.path} — ${e.error}`,
    }));
    report = mergeCheckIssues(report, envIssues);
    if (cache.cachedJson) {
      cache.cachedJson = mergeJsonIssues(cache.cachedJson, envIssues);
    }
  }

  // package.json#nudo 键形状问题（468/936）必须**在报告面**可见：service
  // 侧只给 stderr 一行 ⇒ check 的 issues 段 / --json 契约看不到，用户不知道
  // 自己写错了（"nudo": true / 假值键）。这里补一条 warning 级 issue：
  // - 诊断码用 `config-shape`（**不是** `nudo:` 前缀）——新 `nudo:*` 码必须
  //   在 packages/website/docs/reference/diagnostics.md 有显式锚点（docs-coverage
  //   门禁），CLI 侧无权改文档 ⇒ 用非 `nudo:` 码避开「打不出的文档深链」，
  //   也不进诊断深链面（printDocsLinks 只认 `nudo:` 前缀码）。
  // - 严重级 warning：形状写坏**不**该把门禁打红（该跑的分析照跑，
  //   只是配置没生效）——但必须看得见，不能静默。
  if (cache.configShape) {
    const shapeIssues = [
      {
        severity: "warning" as const,
        code: CONFIG_SHAPE_CODE,
        message: cache.configShape.message,
      },
    ];
    report = mergeCheckIssues(report, shapeIssues);
    if (cache.cachedJson) {
      cache.cachedJson = mergeJsonIssues(cache.cachedJson, shapeIssues);
    }
    // onboarding 的「本项目还没有 nudo 配置」在形状写坏时不成立（#468）：
    // 项目**有** nudo 键，只是形状非法 ⇒ 不打 onboarding 块（它的
    // 「nudo init」建议在这里是错 advice）。
    if (opts.batchProbe) opts.batchProbe.configShape = true;
  }

  // interface 家族诊断（entry-only / domain-exceeds）——分析器通道产物。
  // 缓存命中轮不重跑分析器：entry-only 事实只取决于「本文件源码 + 侧车 +
  // 项目配置」（三者都在磁盘缓存键里）⇒ 命中轮从缓存读回同一结论，
  // 既不重复求值也不会陈旧。
  if (domainIssues.length > 0) {
    // 白名单扩容后，分析器通道与 check 面的 mock 通道可能报**同一事实**
    // （`@nudo:mock fs from "..."` 的文件缺失 ⇒ mock 通道一条 +
    // 模块图通道一条，同码同文）⇒ 追加前先按（code, message）去重。
    const fresh = dedupeAgainstIssues(report.issues, domainIssues);
    if (fresh.length > 0) {
      report = mergeCheckIssues(report, fresh);
    }
  }

  // Bug 643：`--from` 的调用点义务按**同判据**复核（静态全树扫描）。
  //
  // 旧通道只有**执行态** `externalCallRecords`（真正跑过的调用才有记录）
  // ⇒ 被包在函数 / 箭头 / 方法体里的调用点整条失明 ⇒ 同一处静态可见的
  // 违例，`nudo check <调用方>` 报红、`nudo check <被调方> --from <调用方>`
  // 报绿（谁被检查谁决定颜色）。这里复用 core 同文件通道的静态扫描
  // （`scanLiteralCalls`）对 `--from` 现场文件复核一遍 ⇒ 两通道同码同判据。
  //
  // 不进缓存键：`--from` 的事实随现场文件内容变化，缓存键只含被检查文件 ⇒
  // 命中轮仍会跑本段（现场文件在磁盘上，按本轮内容复核）。
  const fromStaticIssues = dedupeFromStaticIssues(
    staticFromDomainIssues({
      targetPath: filePath,
      callsites: fromCallsiteFiles(opts),
      resolveModule: resolveModulePath,
      loadModule: defaultLoadModule,
      ...(cache.autoBind === false ? { autoBind: false } : {}),
      ...(cache.proj?.projectDir ? { projectDir: cache.proj.projectDir } : {}),
    }),
    domainIssues,
  );
  if (fromStaticIssues.length > 0) {
    report = mergeCheckIssues(report, fromStaticIssues);
  }

  // 段3 report+exit：打印面 + 缓存回写 + exit
  // #1 指纹静态面：目标文件 @nudo:* 指令 / 项目 nudo 配置在场计数
  if (opts.batchProbe) {
    if (sourceHasNudoDirectives(source)) opts.batchProbe.filesWithDirectives++;
    if (cache.proj) opts.batchProbe.filesWithConfig++;
  }
  await emitCheckReport(filePath, report, cache, injectionSetupFailed, opts);
}

// ---------------------------------------------------------------------------
// #69：`nudo check --fix` — 复用物化层；默认 dry-run 打 unified diff
// ---------------------------------------------------------------------------

/**
 * BUG-067：与 `file` **共用同一侧车路径**的兄弟模块（存在时才返回）。
 *
 * 侧车约定把同 stem 的 `.js` 与 `.mjs`（`.ts` 与 `.mts`）映射到**同一个**
 * `<stem>.nudo.js`（`<stem>.nudo.ts`）⇒ 目录里两者并存时，`--fix --write`
 * 写出的侧车会同时成为**两个模块**的契约面：给未被修复的兄弟模块**新增**
 * `nudo:interface-load` error，且自己的修复随后被复检降级 ⇒ 静默丢弃。
 */
function sharedSidecarSiblingOf(file: string): string | undefined {
  const families: Array<[RegExp, string]> = [
    [/\.mjs$/, ".js"],
    [/\.js$/, ".mjs"],
    [/\.mts$/, ".ts"],
    [/\.ts$/, ".mts"],
  ];
  for (const [re, ext] of families) {
    const m = re.exec(file);
    if (!m) continue;
    const sibling = file.slice(0, m.index) + ext;
    return existsSync(sibling) ? sibling : undefined;
  }
  return undefined;
}

export async function runCheckFix(opts: {
  targets: string[];
  only?: string[];
  write: boolean;
  ignoreThrows?: string[];
  entryThrows?: EntryThrowsMode;
  profile?: GateProfile;
}): Promise<{ planned: number; written: number; residualErrors: number }> {
  const only = opts.only && opts.only.length > 0 ? new Set(opts.only) : undefined;
  // BUG-022/S5-004：profile 是 L2 预设（adoption→warning /
  // strict→error），显式 --entry-throws 优先——门禁解析走
  // resolveGateForFile 单源（与 plain check 同链，G4 不分叉；
  // config 按文件解析，targets 可跨项目）。
  let planned = 0;
  let written = 0;
  // BUG-022/S5-004：门禁语义——error 级诊断在物化循环后复检：
  // --write 对应用后的源码复检（剩余真实残余）；dry-run 磁盘未变，
  // 复检跑的就是磁盘现状的真实门禁状态（所以 dry-run 门禁仍红）。
  // --fix 不再绕过门禁。
  let residualErrors = 0;
  // Bug 556：修复前的 error 码集 / 复检后的 error 码集——两者**不同**意味着
  // 「旧错误被消掉、换了个新错误」（例如 nullish quickfix 若吞掉 throws 义务，
  // 门禁会从 constraint-violated 变成 entry-may-throw）。只说「还剩 N 个残余
  // error」会让用户误以为修复已生效，故末尾显式点出码集迁移。
  const beforeErrorCodes = new Set<string>();
  const afterErrorCodes = new Set<string>();
  // BUG-048：`--only` 命中的码（末尾报「未匹配到任何诊断」用）——旧实现里
  // 拼错码与「这些诊断没有可自动应用的修复」输出完全一样（静默 no-op）。
  const onlyMatched = new Set<string>();
  // BUG-067：拒绝落盘的侧车写（同侧车路径被兄弟模块共享）
  let refusedSidecarWrites = 0;

  for (const file of opts.targets) {
    let source: string;
    try {
      source = readFileSync(file, "utf-8");
    } catch (err) {
      // 读文件失败不得静默跳过（否则不可读目标在 --fix 面静默绿）：
      // 上屏 + 计入残余 error → 末尾按 check 同契约 exit 1
      console.error(
        `error: check --fix cannot read ${file}: ${(err as Error).message}`,
      );
      residualErrors++;
      continue;
    }
    // 与 plain check（runCheck）同链：resolveGateForFile（CLI 显式 >
    // CLI profile > pkg entryThrows > pkg profile > 默认 error）+
    // mergeIgnoreThrows（加法合并）
    const { entryThrows, ignoreThrows } = resolveGateForFile(file, opts);
    // BUG-047：`source` = **计划文本**（逐条 fix 推进；dry-run 也推进 ⇒
    // 后续 issue 的计划/diff 以已计划文本为基准，与 --write 的结果一致）；
    // `diskSource` = 磁盘原文（dry-run 的门禁复检基准：磁盘确实没变）。
    const diskSource = source;
    // —— 分析输入装配：与 plain check **同源**（Bug 640）——
    // 旧实现只传 loadModule / fromFile / ignoreThrows / entryThrows / skips，
    // 少传 autoBind / projectDir / inject·modules ⇒ 同一文件两条命令结论相反。
    const proj = findProjectConfig(dirname(file));
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const envs = await assembleEnvs(file, source, proj);
    const dirDiags: DirectiveDiag[] = [];
    let inject: RunTranspiledOptions | undefined;
    let mockIssues: CheckIssue[] = [];
    try {
      const built = buildCheckInjection(file, source, envs.allEnvNames, dirDiags);
      inject = built.inject;
      mockIssues = built.mockFromErrors.length > 0 ? mockFromErrorIssues(built.mockFromErrors) : [];
    } catch (err) {
      // 装配失败（语法错 / 注入装配错）——不得静默跳过（否则 --fix 面把
      // 不可分析的文件当绿）：上屏 + 计入残余 error ⇒ 末尾 exit 1。
      const syntax = syntaxErrorInfo(err);
      if (syntax) {
        console.error(paint(formatSyntaxErrorBlock(file, source, syntax)));
      } else {
        console.error(`error: analysis setup failed for ${file}: ${(err as Error).message}`);
      }
      residualErrors++;
      continue;
    }
    // 1145：模块级求值失败（引擎内部回落）——与 plain check **同口径**
    // fail-closed（否则「check 红 / --fix 绿」的方向又回来了：模块求值失败
    // ⇒ 零诊断 ⇒ --fix 面判绿，而 plain check 判红）。
    const evalFailures: EvalFallback[] = [];
    setEvalFallbackCollector((f: EvalFallback) => {
      if (f.reason === "internal" || f.gateFatal === true) evalFailures.push(f);
    });
    let report: CheckReport;
    try {
      report = mergeCheckIssues(
        checkSource(
          file,
          source,
          pTrue,
          checkSourceOptions({
            filePath: file,
            source,
            autoBind,
            projectDir: proj?.projectDir,
            entryThrows,
            ignoreThrows,
            inject,
          }),
        ),
        // mock 装配失败（`@nudo:mock name from "path"` 解析失败）——plain check
        // 把它们并进报告（nudo:module-missing / nudo:mock-load-failed）⇒
        // --fix 面必须同样计入，否则「check 红 / --fix 绿」的方向又回来了。
        mockIssues,
      );
    } finally {
      setEvalFallbackCollector(null);
    }
    if (evalFailures.length > 0) {
      const detail = [...new Set(evalFailures.map((f) => f.message))].join("; ");
      console.error(
        `error: analysis failed for ${file}: module evaluation failed ×${evalFailures.length} — ${detail}`,
      );
      residualErrors++;
    }
    for (const i of report.issues) {
      if (i.severity === "error") beforeErrorCodes.add(i.code);
    }
    const sidecar = sidecarPathOf(file);
    let sidecarText: string | undefined;
    // 与 plain check 同口径：ENOENT = miss；其余读失败上屏（不静默丢契约面）。
    // 措辞同 plain check：区分「不存在」与「读不到」（Bug 499）。
    try {
      sidecarText = readFileSync(sidecar, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          `warning: cannot read sidecar contract ${sidecar}: ${(err as Error).message} — the contract is unreadable (not absent); its constraints are not applied`,
        );
      }
      sidecarText = undefined;
    }
    // BUG-067：侧车路径冲突——`.js` 与 `.mjs`（`.ts` 与 `.mts`）映射到
    // **同一个** `<stem>.nudo.js`（`<stem>.nudo.ts`）⇒ 落盘会同时改写兄弟
    // 模块的契约面：给未被修复的兄弟**新增** error（interface-load），且
    // 自己的修复随后被复检降级 ⇒ 静默丢弃。有冲突 ⇒ 拒绝写侧车并点名共享者。
    const sharedSidecarSibling = sharedSidecarSiblingOf(file);

    for (const issue of report.issues) {
      if (only && !only.has(issue.code)) continue;
      // BUG-048：命中记账（在 warning 过滤之前——降级成 warning 的码也算
      // 「匹配到了诊断」，只是不物化）
      if (only) onlyMatched.add(issue.code);
      // 门禁档（profile / entryThrows）把 L2 **降级成 warning** 时，用户已
      // 明确说「不拦」⇒ --fix 不得替用户写契约（Bug 640 第三方向：
      // `--profile adoption --fix --write` 曾为一条 warning 级诊断落盘侧车）。
      // ⇒ 只物化**门禁拦得住**（error 级）的诊断。
      if (issue.severity === "warning") continue;
      const acts: CheckAction[] = issue.actions ?? actionsForIssue(issue);
      const throwsKind =
        issue.suggestion?.match(/@nudo:throws\s+(\w+)/)?.[1] ??
        issue.actual?.match(/throws\s+([A-Za-z]+)/)?.[1];

      // 每个 issue 只落一条修复（fix 优先，其次 adjust）。
      // silence / review / scaffold 不是修复——默认不进 --fix 落盘，
      // 避免 entry-may-throw 同时写侧车收窄和 @nudo:throws（语义相反）。
      type Plan = NonNullable<Awaited<ReturnType<typeof materializeAction>>>;
      const rank = (k: Plan["titleKind"]): number =>
        k === "fix" ? 0 : k === "adjust" ? 1 : 2;
      const plans: Plan[] = [];
      for (const action of acts) {
        if (action.kind === "info") continue;
        const plan = materializeAction({
          code: issue.code,
          fn: issue.fn,
          file,
          source,
          sidecarText,
          sidecarPath: sidecar,
          action,
          throwsKind,
          expected: issue.expected,
          suggestion: issue.suggestion,
          reason: issue.reason,
          // 侧车契约验证重分析用同一宿主 loader（依赖解析与门禁复检同源）
          loadModule: defaultLoadModule,
        });
        if (plan) plans.push(plan);
      }
      plans.sort((a, b) => rank(a.titleKind) - rank(b.titleKind));
      const plan = plans.find((p) => rank(p.titleKind) <= 1);
      if (!plan) continue;

      // 源码编辑
      if (plan.edits.length > 0) {
        const next = applyTextEdits(source, plan.edits);
        if (next !== source) {
          planned++;
          // 648：diff 头**只**由 unifiedDiff 产出（旧实现自印一份 `---`/`+++`
          // 又追加自带头的 unifiedDiff ⇒ 双份头，且 `+++` 行的路径字段被
          // `([fix] …)` 说明文字污染 ⇒ 解析出的文件名不是合法路径）。
          // 说明文字移到 diff **之外**的一行；路径取**相对 cwd**（与兄弟命令
          // `test --freeze --dry-run` 同口径）⇒ 头是 `--- a/<rel>` /
          // `+++ b/<rel>`，`git apply -p1` 可直接消费（绝对路径会拼出
          // `a//abs` 的双斜杠，剥掉 `a/` 后仍是绝对路径 ⇒ git 拒绝）。
          const relPath = displayPathOf(file);
          console.log(`\nfix: ${relPath}  (${plan.title})`);
          console.log(unifiedDiff(source, next, relPath) || "(no line diff)");
          // BUG-047：推进到**计划文本**必须在 `--write` 分支**之外**——
          // 放在写盘分支内 ⇒ dry-run 的后续 issue 仍按修改前的文本算
          // （同一文件两份互相冲突的「新建文件」diff ⇒ `git apply` 打不上，
          // 且 dry-run 打印的计划 ≠ `--write` 真正写入的结果）。
          source = next;
          if (opts.write) {
            // BUG-049：写盘失败不得抛裸 Node 异常中断整次运行——与读路径
            // 同口径（`cannot read` 的对称面）：上屏 + 计入残余 error，
            // 其余目标继续处理。
            try {
              writeFileSync(file, next, "utf-8");
              written++;
            } catch (err) {
              console.error(
                `error: check --fix cannot write ${file}: ${(err as Error).message}`,
              );
              residualErrors++;
            }
          }
        }
      }
      // 侧车编辑
      if (plan.sidecar) {
        const cur = sidecarText ?? "";
        const next = plan.sidecar.newText;
        if (next !== cur) {
          // BUG-067：同侧车路径被兄弟模块共享 ⇒ 拒绝落盘（dry-run 也不打印
          // 会被拒绝的 diff：那份计划永远不可执行）。可见提示 + 点名共享者。
          if (sharedSidecarSibling !== undefined) {
            console.error(
              `error: check --fix refuses to write sidecar ${displayPathOf(plan.sidecar.path)}: it is shared with ${displayPathOf(sharedSidecarSibling)} (both modules map to the same sidecar path) — writing it would add errors to that module and drop this fix; give one module a distinct sidecar, then re-run`,
            );
            refusedSidecarWrites++;
            continue;
          }
          planned++;
          // 648：同源码编辑分支——单份头 + 相对路径 + 说明文字在 diff 之外
          const relPath = displayPathOf(plan.sidecar.path);
          console.log(`\nfix: ${relPath}  (${plan.title})`);
          console.log(unifiedDiff(cur, next, relPath) || "(new file)");
          // BUG-047：同源码编辑——计划文本推进在写盘分支之外
          sidecarText = next;
          if (opts.write) {
            // BUG-049：写失败不中断整次运行（同源码编辑分支）
            try {
              writeFileSync(plan.sidecar.path, next, "utf-8");
              written++;
            } catch (err) {
              console.error(
                `error: check --fix cannot write ${plan.sidecar.path}: ${(err as Error).message}`,
              );
              residualErrors++;
            }
          }
        }
      }
    }

    // BUG-022/S5-004：门禁语义——本文件有 error 级诊断时重跑
    // checkSource 计残余 error：--write 时 source/侧车已更新为
    // 应用后状态（剩余 = 真实残余）；dry-run 磁盘未变，source
    // 仍是读入原文（复检 = 磁盘现状的真实门禁状态，dry-run 保持
    // 红）。门禁解析与首次 checkSource 同一 per-file 值。
    // 残余 > 0 → --fix 末尾 exit 1，与 check 同契约。
    if (report.issues.some((i) => i.severity === "error")) {
      // 复检基准：`--write` ⇒ 计划文本（= 落盘内容）；dry-run ⇒ **磁盘原文**
      // （磁盘确实没变 ⇒ 复检 = 磁盘现状的真实门禁状态 ⇒ dry-run 保持红）。
      const gateSource = opts.write ? source : diskSource;
      // 复检：**同一套**分析输入（Bug 640）——复检必须与首次分析同口径，
      // 否则「残余 error」是另一套输入下的结论（--fix 面比 check 面更松/更紧）。
      const post = mergeCheckIssues(
        checkSource(
          file,
          gateSource,
          pTrue,
          checkSourceOptions({
            filePath: file,
            source: gateSource,
            autoBind,
            projectDir: proj?.projectDir,
            entryThrows,
            ignoreThrows,
            inject,
          }),
        ),
        mockIssues,
      );
      residualErrors += post.issues.filter((i) => i.severity === "error").length;
      for (const i of post.issues) {
        if (i.severity === "error") afterErrorCodes.add(i.code);
      }
    }
  }

  const mode = opts.write ? "written" : "planned (dry-run)";
  console.log(
    `\ncheck --fix: ${planned} edit(s) ${mode}${opts.write ? `, ${written} applied` : " — pass --write to apply"}`,
  );
  // BUG-067：被拒绝的侧车写必须可见（旧实现里兄弟模块的 fix 连 diff 都没有）
  if (refusedSidecarWrites > 0) {
    console.log(
      `check --fix: ${refusedSidecarWrites} sidecar write(s) refused — the sidecar path is shared with a sibling module (see the errors above)`,
    );
  }
  // BUG-048：`--only` 的码一条诊断都没命中 ⇒ 显式报出（旧实现与「没有可
  // 自动应用的修复」完全同形 ⇒ 拼错码时用户无从得知）
  if (only) {
    const unmatched = [...only].filter((c) => !onlyMatched.has(c));
    if (unmatched.length > 0) {
      console.log(
        `check --fix: --only ${unmatched.join(", ")} matched no diagnostic in the checked target(s) — check the code spelling (\`nudo check\` prints the codes this file reports)`,
      );
    }
  }
  if (!opts.write && planned > 0) {
    console.log(
      "hint: only [fix]/[adjust] are auto-applied; [silence]/[review] need a human (or LSP quickfix)",
    );
  }
  if (residualErrors > 0) {
    console.log(`check --fix: ${residualErrors} residual error(s) remain — gate stays red`);
    // Bug 556：码集迁移（旧的 error 码没了、换了个新码）⇒ 修复没有让门禁转绿，
    // 只是换了一种失败方式。必须显式点出，否则用户会误以为修复已生效。
    const resolved = [...beforeErrorCodes].filter((c) => !afterErrorCodes.has(c));
    const appeared = [...afterErrorCodes].filter((c) => !beforeErrorCodes.has(c));
    if (appeared.length > 0 || resolved.length > 0) {
      console.log(
        `check --fix: diagnostic codes changed${
          resolved.length > 0 ? ` (resolved: ${resolved.join(", ")})` : ""
        }${appeared.length > 0 ? ` (new: ${appeared.join(", ")})` : ""} — the fix did not turn the gate green`,
      );
    }
  }
  return { planned, written, residualErrors };
}

