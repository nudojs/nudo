/**
 * nudo check — 门禁 + 签名表（Day 0 / CI）。
 * runCheck 拆为 loadCache / buildInjection / report+exit 三段（段3 打印面
 * 在 check-report.ts；commander 装配在 check-command.ts）；
 * 依赖（@nudojs/core / service / parser）均为静态依赖，顶部静态引入。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { paint } from "../ui.ts";
import {
  actionsForIssue,
  checkSource,
  extractFileEnvNames,
  listFnDirectiveScopes,
  pTrue,
  sidecarPathOf,
  type CheckAction,
  type CheckIssue,
  type CheckJson,
  type CheckReport,
  type GitlabCodeQualityIssue,
  type RunTranspiledOptions,
} from "@nudojs/core";
import {
  analysisConfig,
  analyzeFileAsync,
  applyMockModuleDirectivesFromSource,
  checkCacheKey,
  checkConfig,
  collectEnvGlobals,
  collectEnvModules,
  collectEvalReplacements,
  collectLoadDepContents,
  collectSkipReturns,
  defaultLoadModule,
  DiskCache,
  diskCacheRoot,
  evalAbsModuleGraph,
  findProjectConfig,
  interfaceConfig,
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  type CallRecord,
} from "@nudojs/service";
import {
  extractDirectives,
  extractDirectivesQuiet,
  extractFileDirectives,
  parse,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "@nudojs/parser";
import { applyTextEdits, materializeAction, unifiedDiff } from "@nudojs/service/emit";
import {
  preloadPathEnvs,
  getPathEnvLoadErrors,
  getPathEnvDepContents,
} from "@nudojs/service/evaluator";
import { emitCheckReport, formatSyntaxErrorBlock, syntaxErrorInfo } from "./check-report.ts";
import {
  checkGateFromConfig,
  invalidGateConfig,
  mergeIgnoreThrows,
  resolveEntryThrows,
  type EntryThrowsMode,
  type GateProfile,
} from "../check-gate-config.ts";
import {
  directiveDiagIssues,
  domainIssuesFromDiagnostics,
  ENV_UNRESOLVED_CODE,
  mergeCheckIssues,
  mergeJsonIssues,
  mockFromErrorIssues,
  reportFromCachedJson,
  stripCachedSigRets,
  stripConfigShapeIssues,
  stripEnvUnresolvedIssues,
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
 */
const warnedGateConfig = new Set<string>();
function warnInvalidGateConfig(config: Parameters<typeof checkConfig>[0]): void {
  const invalid = invalidGateConfig(config);
  if (invalid.profile === undefined || warnedGateConfig.has(invalid.profile)) return;
  warnedGateConfig.add(invalid.profile);
  console.error(
    `warning: package.json nudo.check.profile: unknown value "${invalid.profile}" (expected: adoption | strict) — using default strict`,
  );
}

/**
 * 门禁解析链（项目配置已知时的下半段）：
 * checkGateFromConfig → checkConfig → resolveEntryThrows（CLI 显式 >
 * CLI profile > pkg entryThrows > pkg profile > 默认 error）→
 * mergeIgnoreThrows（CLI 与 package.json 加法合并）。
 * runCheck 与 runCheckFix 共用此单源（G4：adoption 档项目 plain check
 * 与 --fix 不得一门绿一门红）。
 */
function resolveGateForConfig(
  config: Parameters<typeof checkConfig>[0],
  cli: GateCliOptions,
): { entryThrows: EntryThrowsMode; ignoreThrows: string[] } {
  warnInvalidGateConfig(config);
  const cCfg = checkConfig(config);
  const gate = checkGateFromConfig(config);
  return {
    entryThrows: resolveEntryThrows(cli, gate, cCfg.entryThrows),
    ignoreThrows: mergeIgnoreThrows(cli.ignoreThrows, cCfg.ignoreThrows),
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
 * --json 多文件聚合通道：注入装配失败标记 + 语法错文件的 pathError 行
 * （后者与路径错误同信封字段——attachPathErrors 挂 ok:false；code 用
 * 非 `nudo:*` 的 file 级事实码，不进源文件诊断术语表）。
 */
export type GateFlagsChannel = {
  injectionSetupFailed?: boolean;
  syntaxPathErrors?: Array<{
    path: string;
    code: "syntax-error";
    message: string;
    suggestion: string;
  }>;
};

export type RunCheckOptions = {
  json?: boolean;
  /** 多文件 --json：收集 CheckJson，不在本函数内打印 / 设 exit */
  jsonCollect?: CheckJson[];
  from?: CallRecord[];
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
  entryThrows: EntryThrowsMode;
  ignoreThrows: string[];
  disk: DiskCache;
  cacheKey: string | undefined;
  /** 本轮是否命中磁盘缓存（命中则不回写） */
  cached: boolean;
  useDisk: boolean;
  cachedJson: CheckJson | undefined;
  /** package.json#nudo 键形状问题（468/936）——报告面可见（不要静默） */
  configShape: ConfigShapeIssue | null;
};

async function loadCheckCache(
  filePath: string,
  source: string,
  opts: GateCliOptions & { from?: CallRecord[]; verbose?: boolean; abs?: boolean },
): Promise<CheckCacheState> {
  const proj = findProjectConfig(dirname(filePath));
  const { entryThrows, ignoreThrows } = resolveGateForConfig(proj?.config, opts);
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const aCfg = analysisConfig(proj?.config);
  const projectEnvNames = proj?.config.env ?? [];
  // 文件级 @nudo:env 命名 env（es/node/web）与项目配置合并——check 的
  // 符号面必须与 test 同口径注入，否则 @nudo:env 文件整体退化 unknown。
  // path 型 @nudo:env（./custom.env.ts）由 preloadPathEnvs 在 test 路径
  // 预载；check 同步路径只收命名 env（collectEnvGlobals 对未知名安全跳过）。
  const fileEnvNames = fileEnvNamesFromText(source);
  const allEnvNames = [...new Set([...projectEnvNames, ...fileEnvNames])];
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
  // 与 test/LSP 同口径 preload——否则自定义 env 静默退化 env-关（issue #89）
  const envBaseDir = dirname(filePath);
  await preloadPathEnvs(allEnvNames, envBaseDir);
  // path env 文件内容纳入磁盘缓存指纹（mtime→content sha 变更即 cache miss）；
  // 按本文件 preload 目录过滤——批量 check 时其它项目的 env 内容折进
  // 缓存键会造成误 miss（进程级注册表无归属，见 getPathEnvDepContents）
  const envDepContents = getPathEnvDepContents(envBaseDir);
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
          projectEnvNames: allEnvNames,
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
  const cachedJson = cacheKey ? disk.get<CheckJson>(cacheKey) : undefined;
  return {
    proj,
    autoBind,
    aCfg,
    allEnvNames,
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
    configShape: projectConfigShapeIssue(dirname(filePath)),
  };
}

// ---------------------------------------------------------------------------
// runCheck 段 2/3 — buildInjection：eval 注入包装配
//（模块图 + mocks + env 全局 + replace/as）
// ---------------------------------------------------------------------------

/** `@nudo:mock name from "path"` 解析失败（缺文件/缺绑定/求值失败） */
type MockFromError = { name: string; fromPath: string; message: string; code?: string };
/**
 * eval 注入包装配。装配失败 throw——由调用方降级处理（BUG-023：
 * 分析仍跑，但门禁红且缓存不回写）。同文件内复用同一注入对象
 * （checkSource/generalize memo 键按对象身份）。
 *
 * `dirDiags`：D1 指令文法诊断显式落袋。三个发射源同袋——
 *  - collectEvalReplacements：行内 @nudo:as/@nudo:replace（语句级独立去重）
 *  - extractDirectives：函数级 case/mock/skip/sample
 *  - mockDirectivesToAbsSeeds 对 @nudo:mock 类型值表达式的 parseCaseArgExpr
 *    复解析（与 extract 共域去重：同文案在 extract 已报则不再双报）
 */
function buildCheckInjection(
  filePath: string,
  source: string,
  allEnvNames: string[],
  dirDiags: DirectiveDiag[],
): { inject: RunTranspiledOptions; mockFromErrors: MockFromError[] } {
  const graph = evalAbsModuleGraph(source, filePath);
  const reps = collectEvalReplacements(source, { diags: dirDiags });
  const seedPkg = runWithDirectiveDiags(dirDiags, () => {
    const ast = parse(source);
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast), {
      fromFile: filePath,
    });
    // D1 同族：JSDoc 块内错位的文件级指令族标签（@nudo:env / @nudo:mock-module）
    // 不再静默——纯查询 extract 落本域（提取面不变，仍只认行注释）
    extractFileDirectives(ast);
    return seeds;
  });
  let mockFromErrors: MockFromError[] = seedPkg.fromErrors ?? [];
  const mocks = mockSeedsToAbsMocks(seedPkg);
  const envGlobals = collectEnvGlobals(allEnvNames);
  const envMods = collectEnvModules(allEnvNames);
  // env modules（fs/path/node:*…）并入模块图：与 test 路径
  // mergeHarvestUnderEnv 同口径，check 的 import/require 才能解析 env 模块
  let mergedMods = {
    ...graph.modules,
    ...(Object.keys(envMods).length > 0 ? envMods : {}),
  };
  // @nudo:mock-module：覆盖 import 说明符导出（全量/局部）
  const mm = applyMockModuleDirectivesFromSource(source, mergedMods, {
    fromFile: filePath,
  });
  mergedMods = mm.modules;
  mockFromErrors = [
    ...mockFromErrors,
    ...mm.errors.map((e) => ({
      name: e.name,
      fromPath: e.fromPath,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
    })),
  ];
  const inject: RunTranspiledOptions = {
    // Bug 456：**不再**因为「检出环」就丢弃整张依赖图。旧实现在检出 cycle
    // 时把 modules 降级成「只有 env 模块」⇒ 环内文件的 import 全部落空 ⇒
    // 环内函数在 check 面恒为 unknown（原生是确定值）。
    // 引擎侧已能正确处理环（core exec/run.ts 调用入口刷新 live import
    // 绑定 + live-imports.ts 弱引用注册表），环内求值**有界**：
    // - 装载层：模块图检出环即返回「环内已部分求值的导出 / 空导出」
    //   （abs-modules-graph.ts evalDep 的 cycle 分支），不递归装载；
    // - 求值层：调用/分支预算是硬闸（call-budget.ts），递归必被截断成
    //   `nudo:recursion-truncated`（info），不会无限求值。
    // ⇒ 无需「整图丢弃」这种有损降级；环本身仍由诊断面（`nudo:module-cycle`
    // warning）报告，不靠丢图来「避免」环。
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
  return { inject, mockFromErrors };
}

export async function runCheck(file: string, opts: RunCheckOptions = {}): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");

  // 段1 loadCache：项目/门禁/环境装配 + 磁盘缓存读取
  const cache = await loadCheckCache(filePath, source, opts);

  let report: CheckReport;
  let mockFromErrors: MockFromError[] = [];
  // 注入装配失败（BUG-023）：降级分析仍跑，但门禁必须红且缓存不回写
  let injectionSetupFailed = false;
  // interface 家族诊断（entry-only / domain-exceeds）——分析器通道产物
  let domainIssues: CheckIssue[] = [];
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
        if (opts.json) {
          // json ⇒ gateFlags 必在（action 层 1273/1290 两侧都装配）；自愈式
          // 兜底防未来调用面漏传导致静默丢 ok:false
          const flags = (opts.gateFlags ??= {});
          (flags.syntaxPathErrors ??= []).push({
            path: filePath,
            code: "syntax-error",
            message: `${syntax.line}:${syntax.column + 1} — syntax error: ${syntax.essence}`,
            suggestion:
              "fix the syntax error; run `nudo check` without --json for a source excerpt with a caret",
          });
        } else {
          console.error(paint(formatSyntaxErrorBlock(filePath, source, syntax)));
        }
        injectionSetupFailed = true;
        if (opts.gateFlags) opts.gateFlags.injectionSetupFailed = true;
        // #1 指纹：语法错是非 L2 error（不得触发 onboarding 块）
        if (opts.batchProbe) opts.batchProbe.nonL2Error = true;
        process.exitCode = 1;
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
    report = checkSource(filePath, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: filePath,
      ...(cache.autoBind === false ? { autoBind: false } : {}),
      ...(cache.proj?.projectDir ? { projectDir: cache.proj.projectDir } : {}),
      entryThrows: cache.entryThrows,
      ...(cache.ignoreThrows.length > 0 ? { ignoreThrows: cache.ignoreThrows } : {}),
      ...(inject && Object.keys(inject).length > 0
        ? { modules: inject.modules as never, inject }
        : {}),
      skips: collectSkipReturns(source),
    });
    // D1: 指令文法诊断（nudo:directive-syntax）并入 check 报告
    if (dirDiags.length > 0) {
      report = mergeCheckIssues(report, directiveDiagIssues(dirDiags));
    }
  }

  // @nudo:mock name from "path" 解析失败 → check 明确报错（缺文件/缺绑定/求值失败）
  if (mockFromErrors.length > 0) {
    report = mergeCheckIssues(report, mockFromErrorIssues(mockFromErrors));
  }

  // path env 加载失败必须可见（issue #88）：warning，不让 silent 降级为 env-关。
  // live 瞬态：每轮现场注入（report + 命中轮的 cachedJson——--json 面缓存
  // 命中走 cachedJson 而非 report 序列化，不同口径注入会首跑/命中不一致）。
  // 按本文件 preload 目录过滤：批量 check 时其它项目（如 R1）的 env 加载
  // 失败不得泄进本项目（R2）文件报告
  const envLoadErrors = getPathEnvLoadErrors(dirname(filePath));
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
    report = mergeCheckIssues(report, domainIssues);
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
    const report = checkSource(file, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: file,
      ...(ignoreThrows.length > 0 ? { ignoreThrows } : {}),
      entryThrows,
      skips: collectSkipReturns(source),
    });
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

    for (const issue of report.issues) {
      if (only && !only.has(issue.code)) continue;
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
          console.log(`\n--- ${file}`);
          console.log(`+++ ${file}  (${plan.title})`);
          console.log(unifiedDiff(source, next, file) || "(no line diff)");
          if (opts.write) {
            writeFileSync(file, next, "utf-8");
            source = next;
            written++;
          }
        }
      }
      // 侧车编辑
      if (plan.sidecar) {
        const cur = sidecarText ?? "";
        const next = plan.sidecar.newText;
        if (next !== cur) {
          planned++;
          console.log(`\n--- ${plan.sidecar.path}`);
          console.log(`+++ ${plan.sidecar.path}  (${plan.title})`);
          console.log(unifiedDiff(cur, next, plan.sidecar.path) || "(new file)");
          if (opts.write) {
            writeFileSync(plan.sidecar.path, next, "utf-8");
            sidecarText = next;
            written++;
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
      const post = checkSource(file, source, pTrue, {
        loadModule: defaultLoadModule,
        fromFile: file,
        ...(ignoreThrows.length > 0 ? { ignoreThrows } : {}),
        entryThrows,
        skips: collectSkipReturns(source),
      });
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

