/**
 * nudo check — 门禁 + 签名表（Day 0 / CI）。
 * runCheck 拆为 loadCache / buildInjection / report+exit 三段；
 * 依赖（@nudojs/core / service / parser）均为静态依赖，顶部静态引入。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { Command } from "commander";
import {
  actionsForIssue,
  checkSource,
  extractFileEnvNames,
  formatAbs,
  formatCheckReport,
  formatGithubAnnotations,
  formatGitlabCodeQuality,
  pTrue,
  serializeCheckJson,
  serializeCheckJsonMulti,
  sidecarPathOf,
  type CheckAction,
  type CheckJson,
  type CheckReport,
  type GitlabCodeQualityIssue,
  type RunTranspiledOptions,
} from "@nudojs/core";
import {
  analysisConfig,
  analyzeFile,
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
  entryVariantIssueForFile,
  evalAbsModuleGraph,
  findProjectConfig,
  injectBindings,
  interfaceConfig,
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  type CallRecord,
} from "@nudojs/service";
import {
  extractDirectives,
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
import {
  collectExternalRecords,
  reportPathErrors,
  resolveTargets,
  resolveTargetsCollect,
  startWatch,
  runAbsView,
  variadicSwallowError,
  type PathError,
} from "./shared.ts";
import {
  checkGateFromConfig,
  isEntryThrowsMode,
  isGateProfile,
  mergeIgnoreThrows,
  parseIgnoreThrows,
  parseWhatIfBindings,
  resolveEntryThrows,
  validateGateFlags,
  type EntryThrowsMode,
  type GateProfile,
} from "../check-gate-config.ts";
import {
  directiveDiagIssues,
  docsDiagnosticCodes,
  domainIssuesFromDiagnostics,
  dualEntryIssue,
  attachPathErrors,
  ENV_UNRESOLVED_CODE,
  mergeCheckIssues,
  mergeJsonIssues,
  mockFromErrorIssues,
  reportFromCachedJson,
  stripEnvUnresolvedIssues,
} from "../check-json-map.ts";
import {
  shouldComputeCacheKey,
  shouldEmitGha,
  shouldPrintDocsLinks,
  shouldUseDiskCache,
} from "../check-ci-flags.ts";

// ---------------------------------------------------------------------------
// check — 门禁 + 签名表（Day 0 / CI）
// ---------------------------------------------------------------------------

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

/**
 * 文件级 `@nudo:env` 命名 env 抽取（D5=F1：文法在 core directive-scan 单源）。
 * `//` 与 `///` 等价；字符串/块注释里的同形文本不是指令；
 * env 名 token 只收 `\w+` 或 path-like。
 */
export function fileEnvNamesFromText(source: string): string[] {
  return extractFileEnvNames(source);
}

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

/** runCheck 选项（action 层装配；jsonCollect / gitlabRowsCollect / gateFlags 为多文件聚合通道） */
type RunCheckOptions = {
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
  gateFlags?: { injectionSetupFailed?: boolean };
};

/** 段1产物：缓存命中态 + 缓存键输入（段3 决定是否回写） */
type CheckCacheState = {
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
    try {
      const scPath = sidecarPathOf(filePath);
      if (existsSync(scPath)) sidecarContent = readFileSync(scPath, "utf-8");
    } catch {
      /* optional: sidecar unreadable — treat as absent */
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
  const seedPkg = runWithDirectiveDiags(dirDiags, () =>
    mockDirectivesToAbsSeeds(extractDirectives(parse(source)), {
      fromFile: filePath,
    }),
  );
  let mockFromErrors: MockFromError[] = seedPkg.fromErrors ?? [];
  const mocks = mockSeedsToAbsMocks(seedPkg);
  const envGlobals = collectEnvGlobals(allEnvNames);
  const envMods = collectEnvModules(allEnvNames);
  const hasCycle = graph.issues.some((i) => i.kind === "cycle");
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
    ...(hasCycle
      ? (Object.keys(envMods).length > 0 ? { modules: envMods } : {})
      : { modules: mergedMods }),
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

// ---------------------------------------------------------------------------
// runCheck 段 3/3 — report+exit：打印面（终端/JSON/GHA/GitLab）+ 缓存回写 + exit
// ---------------------------------------------------------------------------

async function emitCheckReport(
  filePath: string,
  reportIn: CheckReport,
  cache: Pick<
    CheckCacheState,
    "disk" | "cacheKey" | "cached" | "useDisk" | "cachedJson"
  >,
  injectionSetupFailed: boolean,
  opts: RunCheckOptions,
): Promise<void> {
  let report = reportIn;
  let cachedJson = cache.cachedJson;

  // nudo:dual-entry（T4）：browser/node 双入口变体之一被 check → 观察面只覆盖
  // 本入口（info，单入口零误报）。在缓存之后注入，保证缓存命中也上屏。
  {
    const dual = entryVariantIssueForFile(filePath);
    if (dual) {
      const dualIssue = dualEntryIssue(dual);
      report = mergeCheckIssues(report, [dualIssue]);
      if (cachedJson) {
        cachedJson = mergeJsonIssues(cachedJson, [dualIssue]);
      }
    }
  }

  const checkJson = cachedJson ?? serializeCheckJson(report);
  const wantGha = shouldEmitGha(opts.gha, process.env.GITHUB_ACTIONS);
  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const emitCiAnnotations = (): void => {
    if (opts.gitlab) {
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
      return;
    }
    if (!wantGha) return;
    const ann = formatGithubAnnotations(report, { workspaceRoot });
    if (ann.length === 0) return;
    // --json 时注解走 stderr，stdout 保持机器契约
    if (opts.json) console.error(ann);
    else console.log(ann);
  };

  if (opts.json && opts.jsonCollect) {
    opts.jsonCollect.push(checkJson);
    if (wantGha) {
      const ann = formatGithubAnnotations(report, { workspaceRoot });
      if (ann) console.error(ann);
    }
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
      console.error(formatCheckReport(report, { verbose: false }));
    }
  } else if (opts.abs) {
    // 代数观察面（term/pred/conf）；门禁不因 --abs 关闭：L1/L2 error 仍 exit 1
    await runAbsView(filePath, opts.absView ?? {});
    if (!report.ok) {
      // abs 仍计算 report：错误上屏，避免 exit 1 却无可见诊断
      console.log("");
      console.log(formatCheckReport(report, { verbose: false }));
    } else {
      console.log("");
      console.log(`nudo check  ${basename(filePath)}`);
      console.log("OK");
      console.log(
        `  ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.infos} info · ${report.summary.functions} fn`,
      );
    }
    emitCiAnnotations();
  } else {
    console.log(formatCheckReport(report, { verbose: opts.verbose === true }));
    emitCiAnnotations();
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
  if (cache.useDisk && cache.cacheKey && !cache.cached && !opts.abs && !injectionSetupFailed) {
    try {
      // env-unresolved 是 live 瞬态（每轮现场收集），不持久化——
      // 否则命中轮 live merge 再追加会重复告警
      cache.disk.set(cache.cacheKey, serializeCheckJson(stripEnvUnresolvedIssues(report)));
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

async function runCheck(file: string, opts: RunCheckOptions = {}): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");

  // 段1 loadCache：项目/门禁/环境装配 + 磁盘缓存读取
  const cache = await loadCheckCache(filePath, source, opts);

  let report: CheckReport;
  let mockFromErrors: MockFromError[] = [];
  // 注入装配失败（BUG-023）：降级分析仍跑，但门禁必须红且缓存不回写
  let injectionSetupFailed = false;
  if (cache.cachedJson) {
    // env-unresolved 是 live 瞬态：旧缓存可能已持久化该条目（命中轮 live
    // merge 会再追加 → 重复告警），读回时剔除，由下方 live merge 单一来源注入
    cache.cachedJson = stripEnvUnresolvedIssues(cache.cachedJson);
    report = reportFromCachedJson(cache.cachedJson);
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
      // BUG-023：注入装配失败不得静默跳过——无注入的分析
      // 会把未 mock 的模块图当作事实（假绿：签名看似通过
      // 实则基于错误依赖）。上屏 + 失败态标记，分析仍跑
      // （观察面完整）；exit 由段3统一判定（不在此中途赋值：
      // --json 信封 / 缓存判定在其后，中途赋值会被
      // `ok ? 0 : 1` 覆盖回假绿），降级产物也不得写磁盘缓存
      // （否则下次 check 命中缓存整体跳过注入装配 → 静默转绿）。
      console.error(
        `error: eval injection setup failed: ${(err as Error).message}`,
      );
      injectionSetupFailed = true;
      if (opts.gateFlags) opts.gateFlags.injectionSetupFailed = true;
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

  if (opts.from && opts.from.length > 0) {
    const analysis = await analyzeFileAsync(
      filePath,
      source,
      undefined,
      opts.from,
      undefined,
      "none",
    );
    const domainIssues = domainIssuesFromDiagnostics(analysis.diagnostics);
    if (domainIssues.length > 0) {
      report = mergeCheckIssues(report, domainIssues);
    }
  }

  // 段3 report+exit：打印面 + 缓存回写 + exit
  await emitCheckReport(filePath, report, cache, injectionSetupFailed, opts);
}

// ---------------------------------------------------------------------------
// #69：`nudo check --fix` — 复用物化层；默认 dry-run 打 unified diff
// ---------------------------------------------------------------------------

async function runCheckFix(opts: {
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
    const sidecar = sidecarPathOf(file);
    let sidecarText: string | undefined;
    try {
      sidecarText = existsSync(sidecar) ? readFileSync(sidecar, "utf-8") : undefined;
    } catch {
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
  }
  return { planned, written, residualErrors };
}

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Gate contracts + entry throws; print signatures (CI). Day 0 observation lives here.")
    .argument("[paths...]", "File(s) or directory(s) to check")
    .option("--watch, -w", "Watch files and re-run check on change")
    .option("--json", "Emit stable CheckJson (1 file) or CheckJsonMulti envelope (N files) for CI / Agent")
    .option("--gha", "GitHub Actions inline annotations (::error/::warning). Auto when GITHUB_ACTIONS=true")
    .option("--gitlab", "GitLab Code Quality JSON array (write as gl-code-quality-report.json)")
    .option("--verbose", "Expand Abs signatures (term/pred/conf detail)")
    .option("--abs", "Algebra face: term/pred/conf per function")
    .option("--fn <name>", "With --abs: only this function")
    .option("--assume <pred...>", "With --abs: assume constraints, e.g. x>0 y>=1")
    .option("--generalize", "With --abs: polymorphic signatures via symbolic execution")
    .option(
      "--from <paths...>",
      "Usage-site files: inject call records for cross-file domain evidence",
    )
    .option(
      "--ignore-throws <names>",
      "L2: ignore these entry may-throw type names (e.g. TypeError,RangeError)",
    )
    .option(
      "--entry-throws <mode>",
      "L2: error | warning | off (default error; explicit value overrides --profile)",
    )
    .option(
      "--profile <profile>",
      "Gate profile: adoption | strict (default strict). adoption = L2 entry may-throw → warning; L1 stays error. --entry-throws overrides",
    )
    .option(
      "--what-if <binding...>",
      "AI3: assume `name:type` bindings (e.g. raw:string) and report --target",
    )
    .option("--target <name>", "With --what-if: binding name whose inferred type to print")
    .option("--fix", "Materialize one fix/adjust edit per issue (default --dry-run: print unified diff)")
    .option("--only <codes...>", "With --fix: only these diagnostic codes (e.g. nudo:entry-may-throw)")
    .option("--write", "With --fix: apply edits to disk (default dry-run)")
    .option("--dry-run", "With --fix: print diffs only (default; kept for explicitness)")
    .action(
      async (
        paths: string[],
        opts: {
          watch?: boolean;
          json?: boolean;
          gha?: boolean;
          gitlab?: boolean;
          verbose?: boolean;
          abs?: boolean;
          fn?: string;
          assume?: string[];
          generalize?: boolean;
          from?: string[];
          ignoreThrows?: string;
          entryThrows?: string;
          profile?: string;
          whatIf?: string[];
          target?: string;
          fix?: boolean;
          only?: string[];
          write?: boolean;
          dryRun?: boolean;
        },
      ) => {
        // BUG-024：variadic 旗标（--from/--assume/--what-if/--only）
        // 吞噬其后的位置参数——paths 空且任一 variadic 非空时
        // 定向 usage error（直指旗标 + `--` 终止符解法；
        // commander 原生 "missing required argument" 不指向原因）
        if (paths.length === 0) {
          const swallowed = [
            ...(opts.from?.length ? ["--from"] : []),
            ...(opts.assume?.length ? ["--assume"] : []),
            ...(opts.whatIf?.length ? ["--what-if"] : []),
            ...(opts.only?.length ? ["--only"] : []),
          ];
          if (swallowed.length > 0) {
            variadicSwallowError("check", swallowed);
            return;
          }
          console.error("Usage error: `nudo check` needs at least one path.");
          process.exitCode = 1;
          return;
        }
        // BUG-022/S5-004：--fix 是物化工具面（#69），不得与观察/机器面
        // 旗标静默组合——旧实现早退在门禁 exit 逻辑前，--json/--abs/
        // --watch 等被静默忽略（机器面 stdout 不是 CheckJson）。
        // 方案 A：--fix 保持门禁语义（残余 error 仍 exit 1），
        // 组合旗标显式 usage error。
        if (
          opts.fix &&
          (opts.json ||
            opts.abs ||
            opts.gha ||
            opts.gitlab ||
            opts.watch ||
            opts.verbose ||
            (opts.from && opts.from.length > 0) ||
            (opts.whatIf && opts.whatIf.length > 0))
        ) {
          // G5：--from 也进拒绝表——旧实现静默丢使用处证据并以
          // 弱分析（无调用记录注入）落盘契约
          console.error(
            "error: --fix cannot be combined with --json/--abs/--gha/--gitlab/--watch/--verbose/--from/--what-if (materialization face; the CI gate is plain `nudo check`)",
          );
          process.exitCode = 1;
          return;
        }
        // AI3：what-if 与门禁分离——只回答「假设下 target 是什么」
        if (opts.whatIf && opts.whatIf.length > 0) {
          const targets: string[] = [];
          for (const p of paths) targets.push(...resolveTargets(p));
          const file = targets[0];
          if (!file || !opts.target) {
            console.error("error: --what-if needs one file and --target <name>");
            process.exitCode = 1;
            return;
          }
          const bindings = parseWhatIfBindings(opts.whatIf);
          const original = readFileSync(file, "utf-8");
          const { source, applied, unapplied } = injectBindings(original, bindings);
          const result = analyzeFile(file, source, undefined, undefined, defaultLoadModule);
          const binding = result.bindings.get(opts.target);
          const typeStr = binding ? formatAbs(binding.abs) : "unknown";
          const notes: string[] = [];
          if (applied.length > 0) notes.push(`Bindings applied: ${applied.join(", ")}`);
          if (unapplied.length > 0) {
            notes.push(
              `Bindings not applied (no top-level declaration found): ${unapplied.join(", ")}`,
            );
          }
          console.log(`Type of "${opts.target}": ${typeStr}`);
          for (const n of notes) console.log(n);
          return;
        }
        const targets: string[] = [];
        const pathErrors: PathError[] = [];
        for (const p of paths) {
          const r = resolveTargetsCollect(p);
          targets.push(...r.targets);
          pathErrors.push(...r.errors);
        }
        if (opts.json && opts.abs) {
          console.error("error: --json cannot be combined with --abs");
          process.exitCode = 1;
          return;
        }
        // 非 --json：路径错误走 usageError+exit（历史行为）
        if (!opts.json) {
          reportPathErrors(pathErrors);
          if (targets.length === 0) return;
        }
        const fromErrors: PathError[] = [];
        const externalRecords = opts.from?.length
          ? collectExternalRecords(opts.from, opts.json ? fromErrors : undefined)
          : undefined;
        const allPathErrors = [...pathErrors, ...fromErrors];
        const ignoreThrows = parseIgnoreThrows(opts.ignoreThrows);
        const gateErr = validateGateFlags(opts);
        if (gateErr) {
          console.error(gateErr);
          process.exitCode = 1;
          return;
        }
        const entryThrows = isEntryThrowsMode(opts.entryThrows)
          ? opts.entryThrows
          : undefined;
        const profile = isGateProfile(opts.profile) ? opts.profile : undefined;

        // #69：`check --fix` 批量物化（默认 dry-run 打 diff；--write 落盘）
        if (opts.fix) {
          // BUG-022/S5-004：门禁语义——--fix 不再是旁路：
          // 残余 error 诊断按 check 同契约 exit 1
          const fix = await runCheckFix({
            targets,
            only: opts.only,
            write: opts.write === true,
            ignoreThrows,
            entryThrows,
            profile,
          });
          if (fix.residualErrors > 0) {
            process.exitCode = 1;
          }
          return;
        }

        const shared: {
          from?: CallRecord[];
          verbose?: boolean;
          abs?: boolean;
          absView?: { fn?: string; assume?: string[]; generalize?: boolean };
          ignoreThrows?: string[];
          entryThrows?: "error" | "warning" | "off";
          profile?: GateProfile;
          gha?: boolean;
          gitlab?: boolean;
        } = {
          from: externalRecords,
          verbose: opts.verbose,
          gha: opts.gha,
          gitlab: opts.gitlab,
          ...(opts.abs
            ? {
                abs: true,
                absView: {
                  ...(opts.fn ? { fn: opts.fn } : {}),
                  assume: opts.assume ?? [],
                  generalize: opts.generalize === true,
                },
              }
            : {}),
          ...(ignoreThrows ? { ignoreThrows } : {}),
          ...(entryThrows ? { entryThrows } : {}),
          ...(profile ? { profile } : {}),
        };

        if (opts.json) {
          // --json：路径错误纳入信封；exit 与 ok 单一来源（绝不 ok:true + exit≠0）
          const wantMulti = targets.length > 1 || allPathErrors.length > 0;
          if (wantMulti) {
            const collected: CheckJson[] = [];
            // 注入装配失败跨文件聚合（单文件 ok:true 的降级分析 + 失败态
            // 必须让信封 exit 红，不能被 envelope.ok 覆盖成假绿）
            const gateFlags: { injectionSetupFailed?: boolean } = {};
            for (const t of targets) {
              await runCheck(t, { ...shared, json: true, jsonCollect: collected, gateFlags });
            }
            const envelope = attachPathErrors(serializeCheckJsonMulti(collected), allPathErrors);
            console.log(JSON.stringify(envelope, null, 2));
            process.exitCode = envelope.ok && !gateFlags.injectionSetupFailed ? 0 : 1;
            return;
          }
          if (targets.length === 1) {
            await runCheck(targets[0]!, { ...shared, json: true });
            return;
          }
          // 0 targets 且无路径错误：paths 必有值，每个路径要么出目标要么出错误
          process.exitCode = allPathErrors.length > 0 ? 1 : 0;
          return;
        }

        const runOne = async (t: string): Promise<void> => {
          // --abs 仍走 runCheck：代数观察 + L1/L2 门禁（design §1.3）
          await runCheck(t, { ...shared, json: opts.json });
        };

        if (opts.watch) {
          startWatch(paths, runOne, "check");
          return;
        }
        // GitLab Code Quality 只接受一份 JSON 数组报告：多 target 仿
        // --json 的 jsonCollect 聚合 rows（runCheck 不打印），循环后
        // 一次打印；exit 语义不变（runCheck 逐文件按门禁置 1，
        // 任一文件红即红）。
        if (opts.gitlab && targets.length > 1) {
          const rowsCollect: GitlabCodeQualityIssue[] = [];
          for (const t of targets) {
            await runCheck(t, { ...shared, gitlabRowsCollect: rowsCollect });
          }
          console.log(JSON.stringify(rowsCollect, null, 2));
          return;
        }
        for (const t of targets) await runOne(t);
      },
    );
}
