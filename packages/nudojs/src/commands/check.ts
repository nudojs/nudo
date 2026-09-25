/**
 * nudo check — 门禁 + 签名表（Day 0 / CI）。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import type { Command } from "commander";
import {
  analyzeFileAsync,
  collectSkipReturns,
  checkCacheKey,
  checkConfig,
  evalAbsModuleGraph,
  collectBPathReplacements,
  collectEnvGlobals,
  collectEnvModules,
  type CallRecord,
} from "@nudojs/service";
import {
  collectExternalRecords,
  resolveTargets,
  startWatch,
  runAbsView,
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
  docsDiagnosticCodes,
  domainIssuesFromDiagnostics,
  dualEntryIssue,
  mergeCheckIssues,
  mergeJsonIssues,
  mockFromErrorIssues,
  reportFromCachedJson,
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

async function collectCheckDepContents(
  filePath: string,
  source: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
): Promise<{ depContents: Array<{ path: string; content: string | null }>; truncated: boolean }> {
  const { collectLoadDepContents } = await import("@nudojs/service");
  return collectLoadDepContents(filePath, source, loadModule);
}

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

async function runCheck(
  file: string,
  opts: {
    json?: boolean;
    /** 多文件 --json：收集 CheckJson，不在本函数内打印 / 设 exit */
    jsonCollect?: Array<import("@nudojs/core").CheckJson>;
    from?: CallRecord[];
    verbose?: boolean;
    abs?: boolean;
    absView?: { fn?: string; assume?: string[]; generalize?: boolean };
    ignoreThrows?: string[];
    entryThrows?: "error" | "warning" | "off";
    /** 门禁命名档（CLI --profile）；与 entryThrows 在 runCheck 内组合 */
    profile?: GateProfile;
    /** GitHub Actions 行内注解（或 GITHUB_ACTIONS=true 自动） */
    gha?: boolean;
    /** GitLab Code Quality JSON（数组） */
    gitlab?: boolean;
  } = {},
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");

  const { checkSource, formatCheckReport, serializeCheckJson, formatGithubAnnotations, formatGitlabCodeQuality, pTrue } =
    await import("@nudojs/core");
  const {
    defaultLoadModule: loadModule,
    findProjectConfig,
    interfaceConfig,
    analysisConfig,
    diskCacheRoot,
    DiskCache,
  } = await import("@nudojs/service");
  const { sidecarPathOf } = await import("@nudojs/core");
  const proj = findProjectConfig(dirname(filePath));
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const aCfg = analysisConfig(proj?.config);
  const cCfg = checkConfig(proj?.config);
  const gate = checkGateFromConfig(proj?.config);
  const entryThrows = resolveEntryThrows(opts, gate, cCfg.entryThrows);
  const ignoreThrows = mergeIgnoreThrows(opts.ignoreThrows, cCfg.ignoreThrows);
  const projectEnvNames = proj?.config.env ?? [];
  // 文件级 @nudo:env 命名 env（es/node/web）与项目配置合并——check 的
  // 符号面必须与 test 同口径注入，否则 @nudo:env 文件整体退化 unknown。
  // path 型 @nudo:env（./custom.env.ts）由 preloadPathEnvs 在 test 路径
  // 预载；check 同步路径只收命名 env（collectEnvGlobals 对未知名安全跳过）。
  const fileEnvNames = [...source.matchAll(/@nudo:env\s+([^\n*]+)/g)].flatMap(
    (m) => m[1]!.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean),
  );
  const allEnvNames = [...new Set([...projectEnvNames, ...fileEnvNames])];
  const cacheRoot = diskCacheRoot(proj?.config, proj?.projectDir);
  const disk = new DiskCache({ root: cacheRoot, namespace: "check" });
  const dep = await collectCheckDepContents(filePath, source, loadModule);
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
      sidecarContent = null;
    }
  }
  const cacheKey = shouldComputeCacheKey({
    useDisk,
    verbose: opts.verbose,
    abs: opts.abs,
  })
    ? checkCacheKey(filePath, source, {
          autoBind,
          projectDir: proj?.projectDir,
          sidecarContent,
          depContents: dep.depContents,
          projectEnvNames: allEnvNames,
          analysisCfg: {
            mode: aCfg.mode,
            evalMissingSlot: aCfg.evalMissingSlot,
            callSiteBudget: aCfg.callSiteBudget,
            entryThrows,
            ignoreThrows: ignoreThrows.join(","),
          },
        })
    : undefined;
  const cached = cacheKey ? disk.get<ReturnType<typeof serializeCheckJson>>(cacheKey) : undefined;
  let cachedJson: ReturnType<typeof serializeCheckJson> | undefined;
  let algebraReport;
  let mockFromErrors: Array<{ name: string; fromPath: string; message: string }> = [];
  if (cached) {
    cachedJson = cached;
    algebraReport = reportFromCachedJson(cached) as Awaited<ReturnType<typeof checkSource>>;
  } else {
    // B 注入包（模块图 + mocks + env 全局 + replace/as）——同文件内复用同一
    // 对象（checkSource/generalize memo 键按对象身份）
    let inject: import("@nudojs/core").RunTranspiledOptions | undefined;
    try {
      const graph = evalAbsModuleGraph(source, filePath);
      const reps = collectBPathReplacements(source);
      const { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } = await import("@nudojs/service");
      const { extractDirectives } = await import("@nudojs/parser");
      const { parse } = await import("@nudojs/parser");
      const seedPkg = mockDirectivesToAbsSeeds(extractDirectives(parse(source)), {
        fromFile: filePath,
      });
      mockFromErrors = seedPkg.fromErrors ?? [];
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
      const { applyMockModuleDirectivesFromSource } = await import("@nudojs/service");
      const mm = applyMockModuleDirectivesFromSource(source, mergedMods, {
        fromFile: filePath,
      });
      mergedMods = mm.modules;
      mockFromErrors = [
        ...mockFromErrors,
        ...mm.errors.map((e) => ({ name: e.name, fromPath: e.fromPath, message: e.message })),
      ];
      inject = {
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
    } catch {
      /* 注入计算失败：不注入（fail-closed，无解释兜底） */
    }
    algebraReport = checkSource(filePath, source, pTrue, {
      loadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      entryThrows,
      ...(ignoreThrows.length > 0 ? { ignoreThrows } : {}),
      ...(inject && Object.keys(inject).length > 0
        ? { modules: inject.modules as never, inject }
        : {}),
      skips: collectSkipReturns(source),
    });
  }

  // @nudo:mock name from "path" 解析失败 → check 明确报错（缺文件/缺绑定/求值失败）
  if (mockFromErrors.length > 0) {
    algebraReport = mergeCheckIssues(
      algebraReport,
      mockFromErrorIssues(mockFromErrors),
    ) as typeof algebraReport;
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
      algebraReport = mergeCheckIssues(
        algebraReport,
        domainIssues,
      ) as typeof algebraReport;
    }
  }

  // nudo:dual-entry（T4）：browser/node 双入口变体之一被 check → 观察面只覆盖
  // 本入口（info，单入口零误报）。在缓存之后注入，保证缓存命中也上屏。
  {
    const { dualEntryIssueForFile } = await import("@nudojs/service");
    const dual = dualEntryIssueForFile(filePath);
    if (dual) {
      const dualIssue = dualEntryIssue(dual);
      algebraReport = mergeCheckIssues(algebraReport, [dualIssue]) as typeof algebraReport;
      if (cachedJson) {
        cachedJson = mergeJsonIssues(cachedJson, [dualIssue]);
      }
    }
  }

  const checkJson = cachedJson ?? serializeCheckJson(algebraReport);
  const wantGha = shouldEmitGha(opts.gha, process.env.GITHUB_ACTIONS);
  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const emitCiAnnotations = (): void => {
    if (opts.gitlab) {
      const rows = formatGitlabCodeQuality(algebraReport, { workspaceRoot });
      // GitLab 需要一份数组报告；单文件时直接打印
      if (!opts.json) console.log(JSON.stringify(rows, null, 2));
      else console.error(JSON.stringify(rows));
      return;
    }
    if (!wantGha) return;
    const ann = formatGithubAnnotations(algebraReport, { workspaceRoot });
    if (ann.length === 0) return;
    // --json 时注解走 stderr，stdout 保持机器契约
    if (opts.json) console.error(ann);
    else console.log(ann);
  };

  if (opts.json && opts.jsonCollect) {
    opts.jsonCollect.push(checkJson);
    if (wantGha) {
      const ann = formatGithubAnnotations(algebraReport, { workspaceRoot });
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
    if (!algebraReport.ok) {
      // 仍打印简报，便于日志
      console.error(formatCheckReport(algebraReport, { verbose: false }));
    }
  } else if (opts.abs) {
    // 代数观察面（term/pred/conf）；门禁不因 --abs 关闭：L1/L2 error 仍 exit 1
    await runAbsView(filePath, opts.absView ?? {});
    if (!algebraReport.ok) {
      // abs 仍计算 report：错误上屏，避免 exit 1 却无可见诊断
      console.log("");
      console.log(formatCheckReport(algebraReport, { verbose: false }));
    } else {
      console.log("");
      console.log(`nudo check  ${basename(filePath)}`);
      console.log("OK");
      console.log(
        `  ${algebraReport.summary.errors} error · ${algebraReport.summary.warnings} warning · ${algebraReport.summary.infos} info · ${algebraReport.summary.functions} fn`,
      );
    }
    emitCiAnnotations();
  } else {
    console.log(formatCheckReport(algebraReport, { verbose: opts.verbose === true }));
    emitCiAnnotations();
  }

  // 诊断 → 文档深链（仅终端面；CheckJson 契约不变）
  if (
    shouldPrintDocsLinks({
      json: opts.json,
      abs: opts.abs,
      issueCount: algebraReport.issues.length,
      reportOk: algebraReport.ok,
    })
  ) {
    printDocsLinks(algebraReport.issues);
  }

  if (useDisk && cacheKey && !cached && !opts.abs) {
    try {
      disk.set(cacheKey, serializeCheckJson(algebraReport));
    } catch {
      /* ignore */
    }
  }

  if (!opts.jsonCollect && !algebraReport.ok) {
    process.exitCode = 1;
  }
}

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Gate contracts + entry throws; print signatures (CI). Day 0 observation lives here.")
    .argument("<paths...>", "File(s) or directory(s) to check")
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
        },
      ) => {
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
          const { injectBindings, analyzeFile, defaultLoadModule } = await import("@nudojs/service");
          const { formatAbs } = await import("@nudojs/core");
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
        for (const p of paths) targets.push(...resolveTargets(p));
        if (targets.length === 0) return;
        if (opts.json && opts.abs) {
          console.error("error: --json cannot be combined with --abs");
          process.exitCode = 1;
          return;
        }
        const externalRecords = opts.from?.length ? collectExternalRecords(opts.from) : undefined;
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

        if (opts.json && targets.length > 1) {
          const collected: Array<import("@nudojs/core").CheckJson> = [];
          for (const t of targets) {
            await runCheck(t, { ...shared, json: true, jsonCollect: collected });
          }
          const { serializeCheckJsonMulti: multi } = await import("@nudojs/core");
          const envelope = multi(collected);
          console.log(JSON.stringify(envelope, null, 2));
          if (!envelope.ok) process.exitCode = 1;
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
        for (const t of targets) await runOne(t);
      },
    );
}
