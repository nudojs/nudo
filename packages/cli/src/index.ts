#!/usr/bin/env node
/**
 * nudo CLI — 命令面按 design-cli-semantics.md §1。
 *
 * 正门：check / test / contract / export / health / env harvest
 * 观察是 check signatures + test case 报告 + IDE，不是一级动词。
 */
import { readFileSync, existsSync, watch, readdirSync, statSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, join, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { formatShape } from "@nudojs/core";
import {
  effectiveInterface,
  constraintToEntryAbs,
  joinAbs,
  type Abs,
} from "@nudojs/core";
import {
  projectAbsToSchema,
  absToStandardSchemaModule,
  defaultLoadModule,
  type SchemaDialect,
  generateGuardFunctionFromAbs,
  generateFunctionDtsLines,
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
  collectCallRecords,
  collectSkipReturns,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
  isNudoTargetPath,
  isWatchRelevantPath,
  isSidecarPath,
  isProjectConfigPath,
  ambientSourcesOfSidecar,
  envPathDependents,
  isEnvTemplatePath,
  collectDtsFromEntry,
  getAnalysisSession,
  formatEmitSummary,
  formatInterfaceSurfaceLine,
  checkCacheKey,
  checkConfig,
  evalAbsModuleGraph,
  mockSeedsForSource,
  collectBPathReplacements,
  collectEnvGlobals,
  type CallRecord,
  type CaseResult,
  type AnalysisResult,
  type EmitResult,
} from "@nudojs/service";
import { harvestDts, emitEnvModule } from "@nudojs/harvester";
import { buildTestReport, formatTestReport } from "./run-test.ts";
// extractDirectives retained for export-path parity comments; unused runtime import removed

const program = new Command();

function readPackageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

program
  .name("nudo")
  .description("JavaScript types, computed — check / test / contract / export / health")
  .version(readPackageVersion())
  .addHelpText(
    "after",
    `
Day 0   nudo check <path>   (signatures + L1/L2 gate)
        nudo test <path>    (every inferred case)
Day 1   nudo contract + check
Ecosystem  nudo export (dts / guard / schema / standard)
Ops     nudo health [paths] · nudo env harvest <pkg>

No observation verb: signatures come from check, cases from test, hover from IDE.
`,
  );

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

type EmitCasesOptions = { mode: "add" | "update"; dryRun: boolean; exitOnDiff: boolean };

async function reemitUpdate(
  filePath: string,
  source: string,
  from?: CallRecord[],
): Promise<{ result: AnalysisResult; emitOut: EmitResult; removed: string[] }> {
  const stripped = stripGeneratedCaseDirectives(source);
  const result = await analyzeFileAsync(filePath, stripped.source, undefined, from);
  const emitOut = insertGeneratedCaseDirectives(stripped.source, result);
  return { result, emitOut, removed: stripped.removed };
}

/** --from 公共采集 */
function collectExternalRecords(sites: string[]): CallRecord[] | undefined {
  const records: CallRecord[] = [];
  for (const site of sites) {
    const sitePath = resolve(site);
    if (!existsSync(sitePath)) {
      console.error(`Callsite file not found: ${sitePath}`);
      process.exitCode = 1;
      continue;
    }
    const siteFiles = statSync(sitePath).isDirectory() ? collectNudoFiles(sitePath) : [sitePath];
    for (const sf of siteFiles) {
      records.push(...collectCallRecords(sf, readFileSync(sf, "utf-8")));
    }
  }
  return records.length > 0 ? records : undefined;
}

function collectNudoFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectNudoFiles(fullPath));
    } else if (entry.isFile() && isNudoTargetPath(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveTargets(path: string): string[] {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(`Not found: ${resolved}`);
    process.exitCode = 1;
    return [];
  }
  if (statSync(resolved).isDirectory()) {
    const files = collectNudoFiles(resolved);
    if (files.length === 0) {
      console.error(`No nudo files found in directory: ${resolved}`);
      process.exitCode = 1;
    }
    return files;
  }
  if (!isNudoTargetPath(resolved)) {
    console.error(`Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${resolved}`);
    process.exitCode = 1;
    return [];
  }
  return [resolved];
}

function parseIgnoreThrows(raw?: string | string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = parts
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// watch mode (flag, not verb)
// ---------------------------------------------------------------------------

type WatchRunner = (file: string) => Promise<void>;

function startWatch(paths: string[], runOne: WatchRunner, label: string): void {
  const resolvedList = paths.map((p) => resolve(p));
  const isDir = resolvedList.some((p) => existsSync(p) && statSync(p).isDirectory());
  const primary = resolvedList[0]!;

  const getFiles = (): string[] => {
    const out: string[] = [];
    for (const p of resolvedList) {
      if (!existsSync(p)) continue;
      if (statSync(p).isDirectory()) out.push(...collectNudoFiles(p));
      else out.push(p);
    }
    return out;
  };

  let graph = buildModuleGraph(getFiles());

  const runAll = async () => {
    console.clear();
    console.log(`[${new Date().toLocaleTimeString()}] nudo ${label}...\n`);
    for (const f of getFiles()) {
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relative(process.cwd(), f)}:`, (err as Error).message);
      }
    }
    graph = buildModuleGraph(getFiles());
    console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
  };

  const runIncremental = async (changedFiles: string[]) => {
    const files = getFiles();
    const tracked = new Set(files);
    const dirtyUnion = new Set<string>();
    let forceFull = false;
    for (const cf of changedFiles) {
      if (isNudoTargetPath(cf)) {
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(d);
        continue;
      }
      getAnalysisSession().clear();
      if (isProjectConfigPath(cf)) {
        forceFull = true;
        continue;
      }
      if (isEnvTemplatePath(cf) || !isSidecarPath(cf)) {
        const envDeps = envPathDependents(cf);
        if (envDeps.length > 0) {
          for (const src of envDeps) {
            if (tracked.has(src)) dirtyUnion.add(src);
            for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(d);
          }
        } else if (isEnvTemplatePath(cf)) {
          forceFull = true;
          continue;
        }
      }
      if (isSidecarPath(cf)) {
        for (const src of ambientSourcesOfSidecar(cf)) {
          if (tracked.has(src)) dirtyUnion.add(src);
          for (const d of computeDirtySet(graph.dependents, src)) dirtyUnion.add(d);
        }
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(d);
        if (![...dirtyUnion].some((f) => tracked.has(f))) forceFull = true;
      }
    }
    const dirty = forceFull ? files : [...dirtyUnion].filter((f) => tracked.has(f));
    if (dirty.length === 0) return;
    const ordered = topoSortDirty(graph.imports, dirty);
    console.clear();
    console.log(`[${new Date().toLocaleTimeString()}] nudo ${label} (incremental)...\n`);
    getAnalysisSession().evictForDependents(ordered);
    for (const f of ordered) {
      try {
        await runOne(f);
      } catch (err) {
        console.error(`Error ${relative(process.cwd(), f)}:`, (err as Error).message);
      }
    }
    console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    graph = buildModuleGraph(getFiles());
  };

  runAll().catch(() => {});

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watchTarget = isDir ? primary : dirname(primary);
  const pendingChanged = new Set<string>();

  watch(watchTarget, { recursive: isDir }, (_event, filename) => {
    if (!filename) return;
    const fullPath = isDir ? join(watchTarget, filename) : primary;
    if (!isWatchRelevantPath(fullPath)) return;
    pendingChanged.add(fullPath);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changedFiles = [...pendingChanged];
      pendingChanged.clear();
      if (changedFiles.some((f) => !existsSync(f))) getAnalysisSession().clear();
      runIncremental(changedFiles).catch(() => {});
    }, 200);
  });
}

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

async function runCheck(
  file: string,
  opts: {
    json?: boolean;
    from?: CallRecord[];
    verbose?: boolean;
    abs?: boolean;
    absView?: { fn?: string; assume?: string[]; generalize?: boolean };
    ignoreThrows?: string[];
    entryThrows?: "error" | "warning" | "off";
  } = {},
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");

  const { checkSource, formatCheckReport, serializeCheckJson, pTrue } = await import("@nudojs/core");
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
  const entryThrows = opts.entryThrows ?? cCfg.entryThrows;
  // CLI 列表与 package.json 合并（加法）；避免 CLI 覆盖导致无法在项目配置上收紧/扩展
  const ignoreThrows =
    opts.ignoreThrows && opts.ignoreThrows.length > 0
      ? [...new Set([...(cCfg.ignoreThrows ?? []), ...opts.ignoreThrows])]
      : cCfg.ignoreThrows;
  const projectEnvNames = proj?.config.env ?? [];
  const cacheRoot = diskCacheRoot(proj?.config, proj?.projectDir);
  const disk = new DiskCache({ root: cacheRoot, namespace: "check" });
  const dep = await collectCheckDepContents(filePath, source, loadModule);
  const hasBareMiss = (dep.depContents ?? []).some((d) => d.content == null);
  const useDisk = disk.enabled && !opts.from && !dep.truncated && !hasBareMiss;
  let sidecarContent: string | null = null;
  if (autoBind !== false) {
    try {
      const scPath = sidecarPathOf(filePath);
      if (existsSync(scPath)) sidecarContent = readFileSync(scPath, "utf-8");
    } catch {
      sidecarContent = null;
    }
  }
  const cacheKey =
    useDisk && !opts.verbose && !opts.abs
      ? checkCacheKey(filePath, source, {
          autoBind,
          projectDir: proj?.projectDir,
          sidecarContent,
          depContents: dep.depContents,
          projectEnvNames,
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
  if (cached) {
    cachedJson = cached;
    algebraReport = {
      file: cached.file,
      issues: cached.issues.map((i) => ({
        severity: i.severity as "error" | "warning" | "info",
        code: i.code,
        message: i.message,
        ...(i.fn !== undefined ? { fn: i.fn } : {}),
        ...(i.line !== undefined ? { line: i.line } : {}),
        ...(i.column !== undefined ? { column: i.column } : {}),
        ...(i.actual !== undefined ? { actual: i.actual } : {}),
        ...(i.expected !== undefined ? { expected: i.expected } : {}),
        ...(i.suggestion !== undefined ? { suggestion: i.suggestion } : {}),
      })),
      ok: cached.ok,
      signatures: cached.signatures.map((s) => ({
        name: s.name,
        params: s.params,
        ...(s.paramTypes ? { paramTypes: s.paramTypes } : {}),
        // CheckJson abs 是 formatAbs 字符串；重建时不要伪造成 unknown（§2）
        abs: { shape: { k: "any" as const }, conf: s.conf as never },
        display: s.display,
        detail: s.detail,
        conf: s.conf as never,
        ...(s.throws ? { throws: s.throws } : {}),
        ...(s.entry ? { entry: true } : {}),
      })),
      summary: { ...cached.summary },
    } as Awaited<ReturnType<typeof checkSource>>;
  } else {
    // B 注入包（模块图 + mocks + env 全局 + replace/as）——同文件内复用同一
    // 对象（checkSource/generalize memo 键按对象身份）
    let inject: import("@nudojs/core").RunTranspiledOptions | undefined;
    try {
      const graph = evalAbsModuleGraph(source, filePath);
      const reps = collectBPathReplacements(source);
      const mocks = mockSeedsForSource(source);
      const envGlobals = collectEnvGlobals(projectEnvNames);
      const hasCycle = graph.issues.some((i) => i.kind === "cycle");
      inject = {
        ...(hasCycle ? {} : { modules: graph.modules }),
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

  if (opts.from && opts.from.length > 0) {
    const analysis = await analyzeFileAsync(filePath, source, undefined, opts.from);
    const domainIssues = analysis.diagnostics
      .filter((d) => d.code === "nudo:interface-domain-exceeds")
      .map((d) => {
        const data = (d.data ?? {}) as { actual?: unknown; expected?: unknown };
        return {
          severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
          code: "nudo:interface-domain-exceeds" as const,
          message: d.message,
          line: d.range.start.line,
          column: d.range.start.column,
          actual: typeof data.actual === "string" ? data.actual : undefined,
          expected: typeof data.expected === "string" ? data.expected : undefined,
          suggestion: d.suggestions?.[0],
        };
      });
    if (domainIssues.length > 0) {
      const errors = domainIssues.filter((i) => i.severity === "error").length;
      const warnings = domainIssues.filter((i) => i.severity === "warning").length;
      algebraReport = {
        ...algebraReport,
        issues: [...algebraReport.issues, ...domainIssues],
        ok: algebraReport.ok && errors === 0,
        summary: {
          ...algebraReport.summary,
          errors: algebraReport.summary.errors + errors,
          warnings: algebraReport.summary.warnings + warnings,
        },
      };
    }
  }

  if (opts.json) {
    if (opts.abs) {
      console.error("error: --json cannot be combined with --abs");
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(cachedJson ?? serializeCheckJson(algebraReport), null, 2));
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
  } else {
    console.log(formatCheckReport(algebraReport, { verbose: opts.verbose === true }));
  }

  if (useDisk && cacheKey && !cached && !opts.abs) {
    try {
      disk.set(cacheKey, serializeCheckJson(algebraReport));
    } catch {
      /* ignore */
    }
  }

  if (!algebraReport.ok) {
    process.exitCode = 1;
  }
}

/** check --abs：代数 term/pred/conf 观察 */
async function runAbsView(
  filePath: string,
  opts: { fn?: string; assume?: string[]; generalize?: boolean },
): Promise<void> {
  const algebra = await import("@nudojs/core");
  const source = readFileSync(filePath, "utf8");
  let phi = algebra.pTrue;
  const assumeIds = new Set<string>();
  const assumeLines: string[] = [];
  for (const a of opts.assume ?? []) {
    const m = /^([A-Za-z_$][\w$]*)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)$/.exec(a.trim());
    if (!m) {
      console.error(`Cannot parse --assume: ${a} (supported forms: x>0 / x>=1)`);
      continue;
    }
    const id = m[1]!;
    const n = Number(m[3]);
    phi = algebra.gtNum(algebra.v(id), n);
    assumeIds.add(id);
    assumeLines.push(`${id} ${m[2]} ${m[3]}`);
  }
  const list = opts.fn ? [opts.fn] : algebra.listFunctionNames(source);
  if (list.length === 0) {
    console.error(`Function not found: ${basename(filePath)}`);
    process.exitCode = 1;
    return;
  }
  const { defaultLoadModule: loadModule, tryBPathCall } = await import("@nudojs/service");
  console.log(`nudo check --abs  ${basename(filePath)}`);
  if (assumeLines.length > 0) {
    console.log(`assume: ${assumeLines.join(", ")}`);
  }
  if (opts.generalize) console.log("mode: generalize (symbolic α)\n");
  else console.log("");
  for (const name of list) {
    if (opts.generalize) {
      const g = algebra.generalizeFromAst(name, source, {
        refine: { loadModule, fromFile: filePath },
      });
      if (!g) continue;
      console.log(g.display);
      console.log("");
      continue;
    }
    const args = algebra.buildArgsFromAssume(source, name, assumeIds);
    // fail-closed：B-only（Φ 种子经 tryBPathCall）；B 失败（类方法等）
    // → unknown（显式无信息，ast-eval 兜底已删）
    const bResult = tryBPathCall(source, filePath, name, args, { phi });
    const result = bResult ?? algebra.unknown;
    const label = `${name}(${args.map((a) => algebra.formatShape(a)).join(", ")})`;
    console.log(algebra.formatAbsMultiline(result, label));
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// test — 逐 case 调用点真值 + 可选断言
// ---------------------------------------------------------------------------

async function runTest(
  file: string,
  opts: {
    from?: CallRecord[];
    freeze?: EmitCasesOptions;
    json?: boolean;
    abs?: boolean;
  } = {},
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  let result = await analyzeFileAsync(filePath, source, undefined, opts.from);

  let emitOut: EmitResult | undefined;
  if (opts.freeze) {
    if (opts.freeze.mode === "update") {
      const re = await reemitUpdate(filePath, source, opts.from);
      result = re.result;
      emitOut = re.emitOut;
    } else {
      emitOut = insertGeneratedCaseDirectives(source, result);
    }
  }

  if (opts.json) {
    if (opts.abs) {
      console.error("error: --json cannot be combined with --abs");
      process.exitCode = 1;
      return;
    }
    const report = buildTestReport(filePath, result);
    const { serializeCaseJson } = await import("@nudojs/service");
    const json = serializeCaseJson(result, filePath) as Record<string, unknown>;
    json.assertions = {
      passed: report.passed,
      failed: report.failed,
      unchecked: report.unchecked,
    };
    console.log(JSON.stringify(json, null, 2));
    if (report.failed > 0) process.exitCode = 1;
  } else if (opts.abs) {
    // 观察面仍走 abs，但声明断言失败必须可见 + 挡 exit（design §1.3 / §0）
    const report = buildTestReport(filePath, result);
    await runAbsView(filePath, {});
    console.log("");
    console.log(formatTestReport(report));
    if (report.failed > 0) process.exitCode = 1;
  } else {
    const report = buildTestReport(filePath, result);
    console.log(formatTestReport(report));
    if (report.failed > 0) process.exitCode = 1;
  }

  // diagnostics：分析错误上屏（不挡 test exit，除非无结果）
  if (!opts.json && result.diagnostics.length > 0 && !opts.abs) {
    console.log("\ndiagnostics");
    for (const d of result.diagnostics) {
      const loc = `${relative(process.cwd(), filePath)}:${d.range.start.line}:${d.range.start.column}`;
      console.log(`  [${d.severity}] ${loc} ${d.message}${d.code ? ` (${d.code})` : ""}`);
    }
  }

  if (opts.freeze && emitOut) {
    const relPath = relative(process.cwd(), filePath) || filePath;
    const skippedLines = emitOut.skipped.map((s) => `  ${s.fn}: ${s.reason}${s.detail ? ` (${s.detail})` : ""}`);
    if (emitOut.source === source) {
      console.log("\nfreeze: no changes.");
      for (const line of skippedLines) console.log(line);
      return;
    }
    if (opts.freeze.dryRun) {
      console.log(`\nfreeze: would write cases → ${relPath} (dry run)`);
      for (const w of emitOut.written) console.log(`  ${w.fn}: ${w.cases.join(", ")}`);
      for (const line of skippedLines) console.log(line);
      process.stdout.write(unifiedDiff(source, emitOut.source, relPath));
      if (opts.freeze.exitOnDiff) process.exitCode = 1;
      return;
    }
    writeFileSync(filePath, emitOut.source, "utf-8");
    const directiveCount = emitOut.written.reduce((n, w) => n + w.cases.length, 0);
    console.log(
      `\nfreeze → ${relPath} (${directiveCount} directive(s) across ${emitOut.written.length} function(s))`,
    );
    for (const w of emitOut.written) console.log(`  ${w.fn}: ${w.cases.join(", ")}`);
    for (const line of skippedLines) console.log(line);
  }
}

// ---------------------------------------------------------------------------
// contract — 契约：打印 / draft / emit
// ---------------------------------------------------------------------------

async function runContractPrint(file: string, records?: CallRecord[]): Promise<void> {
  const { interfaceSurface } = await import("@nudojs/service");
  const filePath = resolve(file);
  const entries = await interfaceSurface(filePath, { records });
  const rel = relative(process.cwd(), filePath) || filePath;
  console.log(`${rel}`);
  if (entries.length === 0) {
    console.log("  (no top-level functions found)");
    console.log();
    return;
  }
  for (const e of entries) {
    console.log(formatInterfaceSurfaceLine(e));
  }
  console.log();
}

async function runContractDraft(
  file: string,
  opts: { fnNames: string[]; write: boolean; dryRun: boolean; records?: CallRecord[] },
): Promise<void> {
  const { draftInterface, formatDraftSummary, writeInterfaceDraft, sidecarDraftPath } =
    await import("@nudojs/service");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  const result = await draftInterface(filePath, {
    ...(opts.fnNames.length > 0 ? { fnNames: opts.fnNames } : {}),
    ...(opts.records ? { records: opts.records } : {}),
  });
  const draftRel = relative(process.cwd(), sidecarDraftPath(filePath)) || sidecarDraftPath(filePath);
  if (opts.write) {
    const draftPath = sidecarDraftPath(filePath);
    if (/node_modules/.test(filePath) || /node_modules/.test(draftPath)) {
      console.error(`Error: '${filePath}' is inside node_modules; draft write refused`);
      process.exitCode = 1;
      return;
    }
    const { findProjectConfig } = await import("@nudojs/service");
    let projectRoot: string | undefined;
    const proj = findProjectConfig(dirname(filePath));
    if (proj?.projectDir) {
      projectRoot = proj.projectDir;
    } else {
      let dir = dirname(filePath);
      const fsRoot = resolve("/");
      while (dir !== fsRoot) {
        if (existsSync(join(dir, "package.json"))) {
          projectRoot = dir;
          break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    if (projectRoot) {
      const projectRootReal = (() => {
        try {
          return realpathSync(projectRoot);
        } catch {
          return projectRoot;
        }
      })();
      const fileReal = (() => {
        try {
          return realpathSync(filePath);
        } catch {
          return filePath;
        }
      })();
      const relToRoot = relative(projectRootReal, fileReal);
      if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
        console.error(`Error: '${filePath}' is outside project root '${projectRoot}'; draft write refused`);
        process.exitCode = 1;
        return;
      }
    } else if (!process.env.NUDO_DRAFT_FORCE) {
      console.error(
        `Error: no project root found for '${filePath}'; draft --write refused (set NUDO_DRAFT_FORCE=1 to override)`,
      );
      process.exitCode = 1;
      return;
    }
    const write = writeInterfaceDraft(filePath, result.draftSource, {
      dryRun: opts.dryRun,
      entries: result.entries,
      ...(projectRoot ? { projectDir: projectRoot } : {}),
    });
    for (const line of formatDraftSummary(rel, draftRel, result, write)) console.log(line);
  } else {
    for (const line of formatDraftSummary(rel, draftRel, result)) console.log(line);
  }
}

async function runContractEmit(
  file: string,
  opts: { fnNames: string[]; all: boolean; dryRun: boolean; exitOnDiff: boolean; records?: CallRecord[] },
): Promise<void> {
  const { emitInterface, emitDerivedFromRoot } = await import("@nudojs/service");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  const fnNames = opts.fnNames.length > 0 ? opts.fnNames : undefined;

  let derivedChanged = false;
  const derived = emitDerivedFromRoot(filePath, {
    ...(fnNames ? { fnNames } : {}),
    mode: "update",
    dryRun: opts.dryRun,
    ...(!(fnNames || opts.all) ? { refreshExistingOnly: true } : {}),
  });
  if (derived.hasRoot) {
    for (const sc of derived.sidecars) {
      const scRel = relative(process.cwd(), sc.sidecarPath) || sc.sidecarPath;
      if (sc.changed && opts.dryRun) {
        console.log(`[dry-run] would update ${scRel} (derived-from ${derived.roots.join(", ")}):`);
        console.log(sc.diff ?? "");
      } else if (sc.changed) {
        console.log(`Updated ${rel} → ${scRel} (derived-from ${derived.roots.join(", ")})`);
        console.log(`  written: ${sc.fn}`);
        derivedChanged = true;
      } else {
        console.log(`${scRel}: no derived contract changes (${sc.skipped ?? "no-change"})`);
      }
      for (const i of sc.issues) {
        console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
        // design §1.3：contract 只读/emit 不因分析诊断挡 CI；
        // 仅 usage/IO 与 --exit-on-diff（且须 --dry-run）影响 exit
      }
      if (sc.written) derivedChanged = true;
    }
  }

  let localFnNames = fnNames;
  if (fnNames) {
    try {
      const { localNamedExports } = await import("@nudojs/core");
      const local = localNamedExports(readFileSync(filePath, "utf-8"));
      const filtered = fnNames.filter((n) => local.has(n));
      localFnNames = filtered.length > 0 ? filtered : undefined;
    } catch {
      localFnNames = fnNames;
    }
  }
  const result = await emitInterface(filePath, {
    ...(localFnNames ? { fnNames: localFnNames } : {}),
    mode: "update",
    all: opts.all,
    dryRun: opts.dryRun,
    records: opts.records,
  });
  if (result.changed && opts.dryRun) {
    console.log(`[dry-run] would update ${rel}:`);
    console.log(result.diff ?? "");
    for (const i of result.issues) {
      console.log(`[${i.severity}] ${i.code}: ${i.message}`);
    }
    for (const s of result.skipped) {
      console.log(`  skipped ${s.fn}: ${s.reason}`);
    }
  } else {
    const sc = relative(process.cwd(), result.sidecarPath) || result.sidecarPath;
    for (const line of formatEmitSummary(rel, sc, result)) console.log(line);
  }
  for (const i of result.issues) {
    if (i.severity === "error") {
      // 仅打印；contract --emit 的 exit 由 usage/IO 与 --exit-on-diff 决定
      console.log(`[${i.severity}] ${i.code}: ${i.message}`);
    }
  }
  const anyChanged = result.changed || derivedChanged;
  if (opts.exitOnDiff && anyChanged) process.exitCode = 1;
  if (anyChanged && !opts.dryRun) {
    console.log(`  re-run \`nudo check ${rel}\` to see the persisted contracts in action`);
  }
}

// ---------------------------------------------------------------------------
// export — 投影：dts | guard | schema (dialect) | standard
// ---------------------------------------------------------------------------

type ExportFormat = "schema" | "standard" | "guard" | "dts" | "all";
const EXPORT_FORMATS: ExportFormat[] = ["schema", "standard", "guard", "dts", "all"];
const SCHEMA_DIALECTS: SchemaDialect[] = ["zod"];

function normalizeExportFormat(raw: string): ExportFormat | undefined {
  return EXPORT_FORMATS.includes(raw as ExportFormat) ? (raw as ExportFormat) : undefined;
}

function normalizeDialect(raw: string | undefined): SchemaDialect | undefined {
  if (raw === undefined) return undefined;
  return SCHEMA_DIALECTS.includes(raw as SchemaDialect) ? (raw as SchemaDialect) : undefined;
}

function wantsSchema(format: ExportFormat): boolean {
  return format === "schema" || format === "all";
}

function wantsStandard(format: ExportFormat): boolean {
  return format === "standard" || format === "all";
}

function schemaDialectOf(_format: ExportFormat, dialect: SchemaDialect | undefined): SchemaDialect {
  return dialect ?? "zod";
}

function schemaFileName(stem: string, dialect: SchemaDialect): string {
  return `${stem}.nudo.schema.${dialect}.ts`;
}

async function runExport(
  file: string,
  format: ExportFormat,
  output?: string,
  dialect?: SchemaDialect,
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const result = await analyzeFileAsync(filePath, source);
  const functions = result.functions.filter((f) => f.cases.length > 0);

  if (functions.length === 0) {
    console.log("No analyzed functions found.");
    return;
  }

  const effectiveDialect = schemaDialectOf(format, dialect);
  const schemaChunks: string[] = [];
  const standardChunks: string[] = [];
  const guardChunks: string[] = [];
  const dtsChunks: string[] = [];
  const droppedNotes: string[] = [];

  for (const fn of functions) {
    const caseResults: CaseResult[] = fn.cases;
    const baseName = fn.name;

    if (wantsSchema(format)) {
      const lines: string[] = [
        `\n// === ${baseName} Schema (${effectiveDialect}) ===`,
      ];
      for (const c of caseResults) {
        const inputParts: string[] = [];
        const outputProj = projectAbsToSchema(c.abs, { dialect: effectiveDialect });
        for (const [i, a] of c.argAbs.entries()) {
          const p = projectAbsToSchema(a, { dialect: effectiveDialect });
          inputParts.push(`arg${i}: ${p.source}`);
          for (const note of p.dropped) {
            droppedNotes.push(`${baseName} arg${i}: ${note}`);
          }
        }
        for (const note of outputProj.dropped) {
          droppedNotes.push(`${baseName} output: ${note}`);
        }
        const label = c.name.startsWith("call@") || c.name.startsWith("entry@")
          ? c.name
          : `debug "${c.name}"`;
        lines.push(`// ${label}:`);
        lines.push(`// Input: { ${inputParts.join(", ")} }`);
        lines.push(`// Output: ${outputProj.source}`);
      }
      schemaChunks.push(lines.join("\n"));
    }

    if (wantsStandard(format)) {
      // 运行时校验器应尽量反映**契约域**，而不是单次调用点字面量。
      const eff = effectiveInterface(source, baseName, {
        loadModule: defaultLoadModule,
        fromFile: filePath,
      });
      const exports: Record<string, Abs> = {};
      if (eff) {
        for (const p of eff.params) {
          exports[`${baseName}_${p.param}`] = constraintToEntryAbs(p.constraint, p.param);
        }
        if (eff.returns) {
          exports[`${baseName}Return`] = constraintToEntryAbs(eff.returns.constraint, "return");
        }
      }
      if (Object.keys(exports).length === 0) {
        // 无显式契约：输出用 combinedAbs；参数位对各 case 同槽 argAbs 做 join
        const outAbs = fn.combinedAbs ?? caseResults[0]?.abs;
        if (outAbs) exports[`${baseName}Output`] = outAbs;
        const arity = Math.max(0, ...caseResults.map((c) => c.argAbs.length));
        for (let i = 0; i < arity; i++) {
          const parts = caseResults.map((c) => c.argAbs[i]).filter((a): a is Abs => !!a);
          if (parts.length === 0) continue;
          const joined = parts.reduce((a, b) => joinAbs(a, b));
          const name = fn.paramNames[i] ?? `arg${i}`;
          exports[`${baseName}_${name}`] = joined;
        }
      } else if (!exports[`${baseName}Return`]) {
        // 仅有参数契约、无返回契约时，用观察 combined 作 Output
        const outAbs = fn.combinedAbs ?? caseResults[0]?.abs;
        if (outAbs) exports[`${baseName}Output`] = outAbs;
      }
      if (Object.keys(exports).length > 0) {
        const mod = absToStandardSchemaModule(exports);
        standardChunks.push(`\n// === ${baseName} Standard Schema ===\n${mod.source}`);
        for (const note of mod.dropped) {
          droppedNotes.push(`${baseName} ${note}`);
        }
      }
    }

    if (format === "guard" || format === "all") {
      const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
      const absForGuard = fn.combinedAbs ?? caseResults[0]?.abs;
      if (absForGuard) {
        lines.push(generateGuardFunctionFromAbs(`is${baseName}Output`, absForGuard));
      }
      guardChunks.push(lines.join("\n"));
    }

    if (format === "dts" || format === "all") {
      dtsChunks.push(generateFunctionDtsLines(fn).join("\n"));
    }
  }

  const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
  if (output) {
    const outDir = resolve(output);
    mkdirSync(outDir, { recursive: true });
    const written: string[] = [];
    if (schemaChunks.length > 0) {
      const p = join(outDir, schemaFileName(stem, effectiveDialect));
      let body = schemaChunks.join("\n") + "\n";
      if (droppedNotes.length > 0 && !wantsStandard(format)) {
        body += `\n// dropped preds (not projected into ${effectiveDialect}):\n`;
        body += droppedNotes.map((n) => `//   ${n}`).join("\n") + "\n";
      }
      writeFileSync(p, body, "utf-8");
      written.push(p);
    }
    if (standardChunks.length > 0) {
      // 每函数一份模块（各自内联 __nudoCheck，避免合并文件时 helper 重复定义）
      for (const chunk of standardChunks) {
        const m = chunk.match(/\/\/ === (\S+) Standard Schema ===/);
        const fnStem = m?.[1] ?? stem;
        const p = join(outDir, `${fnStem}.nudo.standard.ts`);
        const header = `// @generated by nudo export --format standard — Standard Schema v1 (vendor: nudo)\n`;
        const body = chunk.startsWith("\n") ? chunk.slice(1) : chunk;
        writeFileSync(p, body.includes("@generated") ? body + "\n" : header + body + "\n", "utf-8");
        written.push(p);
      }
    }
    if (guardChunks.length > 0) {
      const p = join(outDir, `${stem}.nudo.guard.ts`);
      writeFileSync(p, guardChunks.join("\n") + "\n", "utf-8");
      written.push(p);
    }
    if (dtsChunks.length > 0) {
      const p = join(outDir, `${stem}.d.ts`);
      writeFileSync(p, dtsChunks.join("\n") + "\n", "utf-8");
      written.push(p);
    }
    for (const p of written) {
      console.log(`wrote ${relative(process.cwd(), p)}`);
    }
    return;
  }

  for (const chunk of [...schemaChunks, ...standardChunks, ...guardChunks, ...dtsChunks]) {
    console.log(chunk);
  }
  if (droppedNotes.length > 0) {
    console.log(`\n// dropped preds (not projected into ${effectiveDialect}):`);
    for (const n of droppedNotes) console.log(`//   ${n}`);
  }
}

// ---------------------------------------------------------------------------
// health — 体检
// ---------------------------------------------------------------------------

type HealthReport = {
  file: string;
  functions: number;
  entryOnly: number;
  uncovered: string[];
  drift?: { added: number; removed: number };
  interfaceDrift?: number;
  error?: string;
};

const displayPath = (p: string): string => {
  const rel = relative(process.cwd(), p);
  return rel === "" || rel.startsWith("..") ? p : rel;
};

async function healthFile(filePath: string, records?: CallRecord[]): Promise<HealthReport> {
  const report: HealthReport = { file: displayPath(filePath), functions: 0, entryOnly: 0, uncovered: [] };
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    report.error = (err as Error).message;
    return report;
  }
  try {
    const result = await analyzeFileAsync(filePath, source, undefined, records);
    report.functions = result.functions.length;
    report.entryOnly = result.functions.filter((fn) => fn.entryOnly).length;
    report.uncovered = result.functions
      .filter((fn) => fn.cases.length === 0 && !fn.skipped && !fn.entryOnly)
      .map((fn) => fn.name);
    if (records) {
      const { emitOut, removed } = await reemitUpdate(filePath, source, records);
      if (emitOut.source !== source) {
        report.drift = {
          added: emitOut.written.reduce((n, w) => n + w.cases.length, 0),
          removed: removed.length,
        };
      }
    }
    const drift = await countInterfaceDrift(filePath);
    report.interfaceDrift = drift.count;
    if (drift.error) report.error = drift.error;
  } catch (err) {
    report.error = (err as Error).message;
  }
  return report;
}

async function countInterfaceDrift(filePath: string): Promise<{ count: number; error?: string }> {
  const { sidecarPathOf, checkSource, pTrue } = await import("@nudojs/core");
  const { defaultLoadModule } = await import("@nudojs/service");
  const { existsSync: ex, readFileSync: rf } = await import("node:fs");
  const abs = resolve(filePath);
  const sc = sidecarPathOf(abs);
  if (!ex(sc)) return { count: 0 };
  let scSrc: string;
  try {
    scSrc = rf(sc, "utf-8");
  } catch (e) {
    return { count: 0, error: `interface drift: cannot read sidecar: ${(e as Error).message}` };
  }
  if (!/@generated/.test(scSrc)) return { count: 0 };
  try {
    const { findProjectConfig, interfaceConfig } = await import("@nudojs/service");
    const proj = findProjectConfig(dirname(abs));
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const r = checkSource(abs, rf(abs, "utf-8"), pTrue, {
      loadModule: defaultLoadModule,
      fromFile: abs,
      ...(autoBind === false ? { autoBind: false } : {}),
    });
    return { count: r.issues.filter((i) => i.code === "nudo:interface-drift").length };
  } catch (e) {
    return { count: 0, error: `checkSource failed: ${(e as Error).message}` };
  }
}

async function runHealth(paths: string[], opts: { from?: string[]; json?: boolean }): Promise<void> {
  const targetPaths = paths.length > 0 ? paths : ["."];
  const externalRecords = opts.from?.length ? collectExternalRecords(opts.from) : undefined;

  const files: string[] = [];
  const reports: HealthReport[] = [];
  for (const p of targetPaths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      reports.push({ file: displayPath(abs), functions: 0, entryOnly: 0, uncovered: [], error: `File not found: ${abs}` });
      continue;
    }
    files.push(...(statSync(abs).isDirectory() ? collectNudoFiles(abs) : [abs]));
  }
  for (const filePath of files) {
    reports.push(await healthFile(filePath, externalRecords));
  }

  const driftCount = reports.filter((r) => r.drift).length;
  const ifaceDriftCount = reports.filter((r) => (r.interfaceDrift ?? 0) > 0).length;
  const errorCount = reports.filter((r) => r.error).length;
  const uncoveredTotal = reports.reduce((n, r) => n + r.uncovered.length, 0);
  const failed = driftCount > 0 || ifaceDriftCount > 0 || errorCount > 0;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: !failed,
          files: reports.map((r) => ({
            file: r.file,
            functions: r.functions,
            entryOnly: r.entryOnly,
            uncovered: r.uncovered,
            ...(r.drift ? { drift: r.drift } : {}),
            ...(r.interfaceDrift ? { interfaceDrift: r.interfaceDrift } : {}),
            ...(r.error ? { error: r.error } : {}),
          })),
          summary: {
            files: reports.length,
            drift: driftCount,
            interfaceDrift: ifaceDriftCount,
            errors: errorCount,
            uncovered: uncoveredTotal,
          },
        },
        null,
        2,
      ),
    );
  } else {
    if (reports.length === 0) {
      console.log("No files to check.");
      return;
    }
    for (const r of reports) {
      console.log(`${r.file}`);
      if (r.error) {
        console.log(`  ✗ error: ${r.error}`);
        continue;
      }
      const entryInfo = r.entryOnly > 0 ? `, ${r.entryOnly} entry-only` : "";
      console.log(`  · ${r.functions} function(s)${entryInfo}`);
      if (r.uncovered.length > 0) {
        console.log(`  ⚠ uncovered (no call-site evidence): ${r.uncovered.join(", ")}`);
      }
      if (r.drift) {
        const refresh = `nudo test ${r.file} --from ${(opts.from ?? []).join(" ")} --freeze=update`;
        console.log(
          `  ✗ drift: ${r.drift.added + r.drift.removed} witness directive(s) changed (+${r.drift.added} new, -${r.drift.removed} removed) — refresh: ${refresh.trim()}`,
        );
      }
      if ((r.interfaceDrift ?? 0) > 0) {
        console.log(
          `  ✗ contract drift: ${r.interfaceDrift} @generated slot(s) ≠ today's recompute — refresh with: nudo contract --emit ${r.file} --fn <name>`,
        );
      }
    }
    console.log(
      `\nSummary: ${reports.length} file(s) · ${driftCount} case drift · ${ifaceDriftCount} contract drift · ${errorCount} error(s) · ${uncoveredTotal} uncovered function(s)`,
    );
    console.log(failed ? "Result: FAIL (drift or errors found)" : "Result: OK (uncovered function(s) are informational only)");
  }

  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// env harvest
// ---------------------------------------------------------------------------

const HARVEST_MAX_FILES = 200;

function runHarvest(pkg: string, outOpt?: string): void {
  const typesDir = resolve(process.cwd(), "node_modules", "@types", pkg);
  if (!existsSync(typesDir)) {
    console.error(`Error: ${relative(process.cwd(), typesDir)} not found.`);
    console.error(`Install the package first, e.g. pnpm add -D @types/${pkg}`);
    process.exitCode = 1;
    return;
  }

  let entry = join(typesDir, "index.d.ts");
  const pkgJsonPath = join(typesDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { types?: string; typings?: string };
      const declared = pkgJson.types ?? pkgJson.typings;
      if (typeof declared === "string") {
        const candidate = resolve(typesDir, declared);
        if (existsSync(candidate)) entry = candidate;
      }
    } catch {
      /* fallback */
    }
  }
  if (!existsSync(entry)) {
    console.error(`Error: no .d.ts entry found in ${relative(process.cwd(), typesDir)} (tried ${basename(entry)}).`);
    process.exitCode = 1;
    return;
  }

  const files = collectDtsFromEntry(entry, HARVEST_MAX_FILES);
  if (files.length === 0) {
    console.error(`Error: no .d.ts files collected from ${relative(process.cwd(), entry)}.`);
    process.exitCode = 1;
    return;
  }

  const env = harvestDts(files);
  const code = emitEnvModule(env, `@types/${pkg}`);
  const out = resolve(outOpt ?? `nudo-harvest-${pkg}.ts`);
  writeFileSync(out, code, "utf-8");

  console.log(`Harvested @types/${pkg} → ${relative(process.cwd(), out) || out}`);
  console.log(`  files:    ${env.stats.files}`);
  console.log(`  symbols:  ${env.stats.symbols}`);
  console.log(`  skipped:  ${env.stats.skipped}`);
  console.log(`\nUsage — add this directive at the top of your JS file:`);
  const outDir = dirname(out);
  const hintPath = resolve(process.cwd()) === outDir ? basename(out) : out;
  console.log(`  /// @nudo:env ${hintPath}`);
}

// ===========================================================================
// PRIMARY COMMANDS
// ===========================================================================

program
  .command("check")
  .description("Gate contracts + entry throws; print signatures (CI). Day 0 observation lives here.")
  .argument("<paths...>", "File(s) or directory(s) to check")
  .option("--watch, -w", "Watch files and re-run check on change")
  .option("--json", "Emit stable CheckJson (CI / Agent; single file only)")
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
  .option("--entry-throws <mode>", "L2: error | warning | off (default error)")
  .action(
    async (
      paths: string[],
      opts: {
        watch?: boolean;
        json?: boolean;
        verbose?: boolean;
        abs?: boolean;
        fn?: string;
        assume?: string[];
        generalize?: boolean;
        from?: string[];
        ignoreThrows?: string;
        entryThrows?: string;
      },
    ) => {
      const targets: string[] = [];
      for (const p of paths) targets.push(...resolveTargets(p));
      if (targets.length === 0) return;
      if (opts.json && targets.length > 1) {
        console.error("--json requires a single file, not multiple targets");
        process.exitCode = 1;
        return;
      }
      const externalRecords = opts.from?.length ? collectExternalRecords(opts.from) : undefined;
      const ignoreThrows = parseIgnoreThrows(opts.ignoreThrows);
      if (
        opts.entryThrows !== undefined &&
        opts.entryThrows !== "off" &&
        opts.entryThrows !== "warning" &&
        opts.entryThrows !== "error"
      ) {
        console.error(
          `Invalid --entry-throws value: ${opts.entryThrows} (expected: error | warning | off)`,
        );
        process.exitCode = 1;
        return;
      }
      const entryThrows =
        opts.entryThrows === "off" || opts.entryThrows === "warning" || opts.entryThrows === "error"
          ? opts.entryThrows
          : undefined;

      const runOne = async (t: string): Promise<void> => {
        // --abs 仍走 runCheck：代数观察 + L1/L2 门禁（design §1.3）
        await runCheck(t, {
          json: opts.json,
          from: externalRecords,
          verbose: opts.verbose,
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
        });
      };

      if (opts.watch) {
        startWatch(paths, runOne, "check");
        return;
      }
      for (const t of targets) await runOne(t);
    },
  );

program
  .command("test")
  .description("Report every inferred case (call@/entry@ + debug witnesses); assert declared expectations")
  .argument("<paths...>", "File(s) or directory(s)")
  .option("--watch, -w", "Watch files and re-run test on change")
  .option("--from <paths...>", "Usage-site files whose calls become synthesized cases")
  .option("--freeze [mode]", "Solidify call-site witnesses as @nudo:case (mode: update | add; add is the default when the value is omitted)")
  .option("--dry-run", "With --freeze: print a unified diff instead of writing")
  .option("--exit-on-diff", "With --freeze --dry-run: exit 1 when the diff is non-empty")
  .option("--json", "Output case facts as JSON (single file)")
  .option("--abs", "Algebra face via check --abs")
  .action(
    async (
      paths: string[],
      opts: {
        watch?: boolean;
        from?: string[];
        freeze?: boolean | string;
        dryRun?: boolean;
        exitOnDiff?: boolean;
        json?: boolean;
        abs?: boolean;
      },
    ) => {
      const targets: string[] = [];
      for (const p of paths) targets.push(...resolveTargets(p));
      if (targets.length === 0) return;
      if (opts.json && targets.length > 1) {
        console.error("--json requires a single file");
        process.exitCode = 1;
        return;
      }
      const externalRecords = opts.from?.length ? collectExternalRecords(opts.from) : undefined;

      let freeze: EmitCasesOptions | undefined;
      if (opts.freeze !== undefined) {
        let mode: "add" | "update";
        if (opts.freeze === true) mode = "add";
        else if (opts.freeze === "update") mode = "update";
        else {
          console.error(`Invalid --freeze value: ${opts.freeze} (expected: =update, or --freeze without a value for add)`);
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.error("--freeze cannot be combined with --json");
          process.exitCode = 1;
          return;
        }
        if (opts.exitOnDiff && !opts.dryRun) {
          console.error("--exit-on-diff requires --dry-run");
          process.exitCode = 1;
          return;
        }
        freeze = { mode, dryRun: opts.dryRun === true, exitOnDiff: opts.exitOnDiff === true };
      }

      const runOne = async (t: string): Promise<void> => {
        await runTest(t, {
          ...(externalRecords ? { from: externalRecords } : {}),
          ...(freeze ? { freeze } : {}),
          json: opts.json,
          abs: opts.abs,
        });
      };

      if (opts.watch) {
        startWatch(paths, runOne, "test");
        return;
      }
      for (const t of targets) await runOne(t);
    },
  );

program
  .command("contract")
  .description("Draft / emit / print contracts (sidecar interfaces)")
  .argument("[paths...]", "File(s) or directory(s)")
  .option("--emit", "Write/update @generated sidecar segments (mode: update)")
  .option("--draft", "Generate a reviewable contract draft from existing code")
  .option("--write", "With --draft: write <file>.nudo.draft.js|ts on disk")
  .option(
    "--fn <name>",
    "With --emit/--draft: only these export names (repeatable)",
    (v: string, acc: string[]) => {
      acc.push(v);
      return acc;
    },
    [] as string[],
  )
  .option("--all", "With --emit: target every top-level export (prefer --fn)")
  .option("--dry-run", "With --emit or --draft --write: print instead of writing")
  .option("--exit-on-diff", "With --emit + --dry-run: exit 1 when the sidecar would change")
  .option("--from <paths...>", "Usage-site files feeding domain evidence")
  .action(
    async (
      paths: string[],
      opts: {
        emit?: boolean;
        draft?: boolean;
        write?: boolean;
        fn?: string[];
        all?: boolean;
        dryRun?: boolean;
        exitOnDiff?: boolean;
        from?: string[];
      },
    ) => {
      if (paths.length === 0) {
        console.error(
          "Usage error: `nudo contract` needs at least one path. " +
            (opts.emit
              ? "Writing filters: --fn <names> / --all (default: only refresh existing @generated segments)."
              : opts.draft
                ? "Draft mode: pass a file or directory."
                : "Print-only: pass a file or directory."),
        );
        process.exitCode = 1;
        return;
      }
      if (opts.emit && opts.draft) {
        console.error("Usage error: --emit and --draft are mutually exclusive");
        process.exitCode = 1;
        return;
      }
      if (opts.write && !opts.draft) {
        console.error("Usage error: --write requires --draft");
        process.exitCode = 1;
        return;
      }
      if (opts.exitOnDiff && (!opts.dryRun || !opts.emit)) {
        console.error("--exit-on-diff requires --emit --dry-run");
        process.exitCode = 1;
        return;
      }
      const externalRecords = opts.from?.length ? collectExternalRecords(opts.from) : undefined;
      const targets: string[] = [];
      for (const p of paths) targets.push(...resolveTargets(p));
      const roots = targets.filter((t) => isNudoTargetPath(t));
      if (roots.length === 0) {
        if (targets.length > 0) {
          console.error(`Usage error: no nudo analysis targets in the given paths: ${paths.join(", ")}`);
          process.exitCode = 1;
        }
        return;
      }
      for (const t of roots) {
        try {
          if (opts.draft) {
            await runContractDraft(t, {
              fnNames: opts.fn ?? [],
              write: opts.write === true,
              dryRun: opts.dryRun === true,
              records: externalRecords,
            });
          } else if (opts.emit) {
            await runContractEmit(t, {
              fnNames: opts.fn ?? [],
              all: opts.all === true,
              dryRun: opts.dryRun === true,
              exitOnDiff: opts.exitOnDiff === true,
              records: externalRecords,
            });
          } else {
            await runContractPrint(t, externalRecords);
          }
        } catch (err) {
          console.error(`Error analyzing ${relative(process.cwd(), t)}: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    },
  );

program
  .command("export")
  .description("Project inferred types: dts | guard | schema | standard")
  .argument("<file>", "JavaScript/TypeScript file to analyze")
  .option(
    "--format <format>",
    "Output format: dts, guard, schema, standard, all",
    "dts",
  )
  .option("--dialect <dialect>", "Schema dialect (currently: zod). Applies to --format schema|all")
  .option("--out <dir>", "Write projection files to this directory (omit for stdout)")
  .action(
    async (
      file: string,
      options: { format: string; dialect?: string; out?: string },
    ) => {
      const format = normalizeExportFormat(options.format);
      if (!format) {
        console.error(
          `Unknown --format ${options.format}; expected dts | guard | schema | standard | all`,
        );
        process.exitCode = 1;
        return;
      }
      const dialect = normalizeDialect(options.dialect);
      if (options.dialect !== undefined && dialect === undefined) {
        console.error(`Unknown --dialect ${options.dialect}; expected ${SCHEMA_DIALECTS.join(" | ")}`);
        process.exitCode = 1;
        return;
      }
      if (dialect !== undefined && !wantsSchema(format)) {
        console.error(`--dialect is only valid with --format schema|all (got ${format})`);
        process.exitCode = 1;
        return;
      }
      await runExport(file, format, options.out, dialect);
    },
  );

program
  .command("health")
  .description("Project health & drift: uncovered functions, witness drift, contract drift, analysis errors")
  .argument("[paths...]", "File(s) or directory(s) (default: current directory)")
  .option("--watch, -w", "Watch and re-run health on change")
  .option("--from <paths...>", "Usage-site files for freeze-drift detection")
  .option("--json", "Output as JSON")
  .action(async (paths: string[], opts: { watch?: boolean; from?: string[]; json?: boolean }) => {
    const fromPaths = opts.from;
    const runOneDir = async (): Promise<void> => {
      await runHealth(paths, { ...(fromPaths ? { from: fromPaths } : {}), json: opts.json });
    };
    if (opts.watch) {
      const watchPaths = paths.length > 0 ? paths : ["."];
      startWatch(watchPaths, async () => {
        await runHealth(paths, { ...(fromPaths ? { from: fromPaths } : {}), json: opts.json });
      }, "health");
      return;
    }
    await runOneDir();
  });

const env = program.command("env").description("Environment: harvest @types into env modules");
env
  .command("harvest")
  .description("Convert @types/<pkg> .d.ts into a Nudo env file (constraint builders)")
  .argument("[pkg]", "Package name under @types (e.g. node)")
  .option("--out <file>", "Output .ts env file (default: ./nudo-harvest-<pkg>.ts)")
  .option("--auto [dir]", "Scan directory for bare imports and report auto-harvestable @types packages")
  .action(async (pkg: string | undefined, opts: { out?: string; auto?: boolean | string }) => {
    if (opts.auto !== undefined) {
      const dir = resolve(typeof opts.auto === "string" ? opts.auto : ".");
      const files = existsSync(dir) && statSync(dir).isDirectory()
        ? collectNudoFiles(dir)
        : existsSync(dir)
          ? [dir]
          : [];
      if (files.length === 0) {
        console.error(`No analysis targets under ${dir}`);
        process.exitCode = 1;
        return;
      }
      const { collectBarePackages, harvestPackageCached, formatHarvestSummary } = await import("@nudojs/service");
      const seen = new Set<string>();
      const report: string[] = [];
      for (const f of files) {
        let src: string;
        try {
          src = readFileSync(f, "utf-8");
        } catch {
          continue;
        }
        for (const p of collectBarePackages(src)) {
          if (seen.has(p)) continue;
          seen.add(p);
          const h = harvestPackageCached(p, dirname(f));
          if (h) report.push(formatHarvestSummary(h));
          else report.push(`${p}: no .d.ts / @types (skipped)`);
        }
      }
      if (report.length === 0) {
        console.log("No bare imports found (or nothing to harvest).");
        return;
      }
      console.log(`auto harvest candidates under ${relative(process.cwd(), dir) || "."}:\n`);
      for (const line of report) console.log(line);
      console.log(`\nAnalysis injects these automatically; use \`nudo env harvest <pkg>\` to write a persistent env file.`);
      return;
    }
    if (!pkg) {
      console.error("Error: <pkg> is required (or use --auto).");
      process.exitCode = 1;
      return;
    }
    runHarvest(pkg, opts.out);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? (process.env.NUDO_DEBUG ? err.stack : err.message) : err);
  process.exitCode = 1;
});
