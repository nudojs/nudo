#!/usr/bin/env node
import { readFileSync, existsSync, watch, readdirSync, statSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, join, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { formatShape } from "@nudojs/core";
import { extractDirectives } from "@nudojs/parser";
import {
  absToZodSchema,
  generateGuardFunction,
  generateGuardFunctionFromAbs,
  generateFunctionDtsLines,
  analyzeFileAsync,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
  collectCallRecords,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
  isNudoTargetPath,
  collectDtsFromEntry,
  evictAnalysisCachesForFiles,
  getAnalysisSession,
  formatEmitSummary,
  formatInterfaceSurfaceLine,
  checkCacheKey,
  extractNudoImportSpecs,
  type CallRecord,
  type CaseResult,
  type FunctionAnalysis,
  type AnalysisResult,
  type EmitResult,
} from "@nudojs/service";
import { harvestDts, emitEnvModule } from "@nudojs/harvester";
import { buildTestReport, formatTestReport } from "./run-test.ts";

const program = new Command();

/** 与 package.json 同步：src 用 tsx 跑、dist 作为 bin 时路径都是 ../package.json */
function readPackageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

program
  .name("nudo")
  .description("Nudo type inference engine")
  .version(readPackageVersion());

/** `--emit-cases` 的编排选项：mode 决定 add/update 两条固化路径 */
type EmitCasesOptions = { mode: "add" | "update"; dryRun: boolean; exitOnDiff: boolean };

/**
 * update 固化路径的编排：剥离旧生成指令（call@ 前缀）→ 以剥离后的源码
 * 重新分析（合成 case 反映当前真实调用形状）→ 重新插入生成指令。
 * infer --emit-cases=update 与 doctor 的 drift 判定共用此链路。
 * 注意是否有变化必须比较 emitOut.source 与原始 source（EmitResult.changed
 * 以 stripped 基准恒真）；removed 供指令数统计。
 */
async function reemitUpdate(
  filePath: string,
  source: string,
  callsites?: CallRecord[],
): Promise<{ result: AnalysisResult; emitOut: EmitResult; removed: string[] }> {
  const stripped = stripGeneratedCaseDirectives(source);
  const result = await analyzeFileAsync(filePath, stripped.source, undefined, callsites);
  const emitOut = insertGeneratedCaseDirectives(stripped.source, result);
  return { result, emitOut, removed: stripped.removed };
}

/**
 * --callsites 公共采集：路径可为文件或目录（目录递归收 .js），逐文件
 * collectCallRecords 汇总为外部调用记录。找不到的路径报错并置退出码 1
 * （不中断其余路径）；一条都收不到时返回 undefined（与未传等价）。
 */
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

async function runInfer(
  file: string,
  options: { dts?: boolean; showLoc?: boolean; callsites?: CallRecord[]; emit?: EmitCasesOptions } = {},
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  let result = await analyzeFileAsync(filePath, source, undefined, options.callsites);

  // 调用点固化：add 直接把已算好的合成 case 插回源码；update 先剥离旧生成指令，
  // 在剥离后的源码上重算分析再插入，后续打印/摘要都基于重算结果（反映刚固化的形状）
  let emitOut: EmitResult | undefined;
  if (options.emit) {
    if (options.emit.mode === "update") {
      const re = await reemitUpdate(filePath, source, options.callsites);
      result = re.result;
      emitOut = re.emitOut;
    } else {
      emitOut = insertGeneratedCaseDirectives(source, result);
    }
  }

  if (result.functions.length === 0 && !(result.externalFunctions?.length)) {
    console.log("No functions with @nudo:case directives found.");
    return;
  }

  const dtsLines: string[] = [];

  for (const fn of result.functions) {
    const loc = fn.loc;
    const locStr = `${relative(process.cwd(), filePath)}:${loc.start.line}:${loc.start.column}`;
    const header = options.showLoc ? `=== ${fn.name} (${locStr}) ===` : `=== ${fn.name} ===`;
    console.log(`${header}\n`);

    // .d.ts 与 service 级 generateDts 共用同一实现（单一 widen 主签名 +
    // JSDoc case 说明；真实参数名；noDeclaration 函数排除），两条路径行为一致
    if (options.dts) {
      dtsLines.push(...generateFunctionDtsLines(fn));
    }

    if (fn.skipped) {
      if (fn.combinedAbs) {
        console.log(`Skipped (declared): ${formatShape(fn.combinedAbs)}`);
      } else {
        console.log("Skipped (no return type declared)");
      }
      console.log();
      continue;
    }

    for (const c of fn.cases) {
      const argsStr = c.argAbs.map(formatShape).join(", ");
      let line = `Case "${c.name}": (${argsStr}) => ${formatShape(c.abs)}`;
      if (c.throwsAbs.shape.k !== "never") line += ` throws ${formatShape(c.throwsAbs)}`;
      console.log(line);
      // M3：内涵摘要（term/pred/conf）+ 无损 Abs
      if (c.intension?.display) {
        console.log(`    intension: ${c.intension.display}`);
      } else if (c.intension?.term || c.intension?.pred) {
        const parts: string[] = [];
        if (c.intension.term) parts.push(`term=${c.intension.term}`);
        if (c.intension.pred) parts.push(`pred: ${c.intension.pred}`);
        if (c.intension.conf) parts.push(`#${c.intension.conf}`);
        console.log(`    ${parts.join("  ")}`);
      }
      if (c.intension?.abs) {
        console.log(`    abs: ${c.intension.abs}`);
      }
    }

    if (fn.entryOnly) {
      console.log("# no call sites found; parameters default to unknown");
    }

    if (fn.cases.length > 1 && fn.combinedAbs) {
      console.log(`\nCombined: ${formatShape(fn.combinedAbs)}`);
    }

    console.log();
  }

  // Imported functions inferred from this file's cross-file call sites.
  // d.ts generation skips them on purpose: they belong to another file's
  // declaration boundary, not this one.
  if (result.externalFunctions && result.externalFunctions.length > 0) {
    const byModule = new Map<string, FunctionAnalysis[]>();
    for (const fn of result.externalFunctions) {
      const mod = fn.fromModule ?? "";
      const list = byModule.get(mod);
      if (list) list.push(fn);
      else byModule.set(mod, [fn]);
    }
    for (const [mod, fns] of byModule) {
      const rel = relative(process.cwd(), mod) || mod;
      console.log(`--- ${rel} (imported) ---\n`);
      for (const fn of fns) {
        console.log(`=== ${fn.name} ===\n`);
        for (const c of fn.cases) {
          const argsStr = c.argAbs.map(formatShape).join(", ");
          let line = `Case "${c.name}": (${argsStr}) => ${formatShape(c.abs)}`;
          if (c.throwsAbs.shape.k !== "never") line += ` throws ${formatShape(c.throwsAbs)}`;
          console.log(line);
        }
        if (fn.cases.length > 1 && fn.combinedAbs) {
          console.log(`\nCombined: ${formatShape(fn.combinedAbs)}`);
        }
        console.log();
      }
    }
  }

  if (options.dts && dtsLines.length > 0) {
    const dtsPath = filePath.replace(/\.[cm]?js$|\.ts$/, ".d.ts");
    const dtsContent = dtsLines.join("\n") + "\n";
    writeFileSync(dtsPath, dtsContent, "utf-8");
    console.log(`Generated: ${relative(process.cwd(), dtsPath)}`);
  }

  if (result.diagnostics.length > 0) {
    console.log("Diagnostics:\n");
    for (const d of result.diagnostics) {
      const loc = `${relative(process.cwd(), filePath)}:${d.range.start.line}:${d.range.start.column}`;
      console.log(`  [${d.severity}] ${loc} ${d.message}${d.code ? ` (${d.code})` : ""}`);
      if (d.origin) {
        console.log(`    → value originates at ${d.origin.line}:${d.origin.column}`);
      }
    }
    console.log();
  }

  // 调用点固化收尾：摘要 / diff / 写盘。是否"有变化"以最终源码与原源码比对为准
  // （update 会先剥离再插回，剥离后重写的相同指令不构成变化）
  if (options.emit && emitOut) {
    const relPath = relative(process.cwd(), filePath) || filePath;
    const skippedLines = emitOut.skipped.map((s) => `  ${s.fn}: ${s.reason}${s.detail ? ` (${s.detail})` : ""}`);

    if (emitOut.source === source) {
      console.log("No changes.");
      for (const line of skippedLines) console.log(line);
      return;
    }

    if (options.emit.dryRun) {
      console.log(`Would emit cases → ${relPath} (dry run)`);
      for (const w of emitOut.written) console.log(`  ${w.fn}: ${w.cases.join(", ")}`);
      for (const line of skippedLines) console.log(line);
      console.log();
      process.stdout.write(unifiedDiff(source, emitOut.source, relPath));
      if (options.emit.exitOnDiff) process.exitCode = 1;
      return;
    }

    writeFileSync(filePath, emitOut.source, "utf-8");
    const directiveCount = emitOut.written.reduce((n, w) => n + w.cases.length, 0);
    console.log(
      `Emitted cases → ${relPath} (${directiveCount} directive(s) across ${emitOut.written.length} function(s))`,
    );
    for (const w of emitOut.written) console.log(`  ${w.fn}: ${w.cases.join(", ")}`);
    for (const line of skippedLines) console.log(line);
  }
}

async function runInferJson(file: string, externalRecords?: CallRecord[]): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const result = await analyzeFileAsync(filePath, source, undefined, externalRecords);
  const { serializeInferJson } = await import("@nudojs/service");
  console.log(JSON.stringify(serializeInferJson(result, filePath), null, 2));
}

program
  .command("infer")
  .description("Infer types from a JS/TS file (or a directory of them) — functions with @nudo:case directives use them; all other functions are inferred from call sites (whole-program analysis)")
  .argument("<file>", "Path to the JS/TS file (or directory)")
  .option("--dts", "Generate .d.ts file")
  .option("--loc", "Show source locations in output")
  .option("--json", "Output as JSON")
  .option("--callsites <paths...>", "Usage-site files (tests/apps) to harvest real call shapes from; their calls to this file's exports become synthesized cases")
  .option("--emit-cases [mode]", "Write synthesized call-site cases back into the source as @nudo:case directives (call@ prefix); mode: update (default: add)")
  .option("--dry-run", "With --emit-cases: print a unified diff instead of writing to disk")
  .option("--exit-on-diff", "With --dry-run: exit with code 1 when the diff is non-empty")
  .action(
    async (
      file: string,
      opts: {
        dts?: boolean;
        loc?: boolean;
        json?: boolean;
        callsites?: string[];
        emitCases?: boolean | string;
        dryRun?: boolean;
        exitOnDiff?: boolean;
      },
    ) => {
      // --emit-cases 只允许省略（=add）或 =update 两种形态
      let emit: EmitCasesOptions | undefined;
      if (opts.emitCases !== undefined) {
        let mode: "add" | "update";
        if (opts.emitCases === true) mode = "add";
        else if (opts.emitCases === "update") mode = "update";
        else {
          console.error(`Invalid --emit-cases value: ${opts.emitCases} (expected: =update, or omit the value for add)`);
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.error("--emit-cases cannot be combined with --json");
          process.exitCode = 1;
          return;
        }
        emit = { mode, dryRun: opts.dryRun === true, exitOnDiff: opts.exitOnDiff === true };
      }
      if (opts.exitOnDiff && !opts.dryRun) {
        console.error("--exit-on-diff requires --dry-run");
        process.exitCode = 1;
        return;
      }
    let externalRecords: CallRecord[] | undefined;
    if (opts.callsites?.length) {
      externalRecords = collectExternalRecords(opts.callsites);
    }
      // 目录模式：与 watch/doctor 的 collectNudoFiles 同一收集规则
      // （.js/.mjs/.ts，排除 .d.ts/.tsx）
      const target = resolve(file);
      if (existsSync(target) && statSync(target).isDirectory()) {
        const files = collectNudoFiles(target);
        if (files.length === 0) {
          console.log("No nudo files found in directory.");
          return;
        }
        if (opts.json) {
          console.error("--json requires a single file, not a directory");
          process.exitCode = 1;
          return;
        }
        for (const f of files) {
          try {
            await runInfer(f, { dts: opts.dts, showLoc: opts.loc, callsites: externalRecords, emit });
          } catch (err) {
            console.error(`Error analyzing ${relative(process.cwd(), f)}:`, (err as Error).message);
          }
        }
        return;
      }
    if (opts.json) {
      await runInferJson(file, externalRecords);
    } else {
      await runInfer(file, { dts: opts.dts, showLoc: opts.loc, callsites: externalRecords, emit });
    }
  });

/**
 * 严格 Abs-only：只跑 checkSource 代数门禁（+ 可选 --callsites 的
 * domain-exceeds）。不再叠加 analyzeFileAsync 全量外延诊断——语言表面
 * 问题由 Abs/B-path 诊断吸收，避免双路径语义分叉。
 *
 * `--callsites` 注入跨文件调用记录后，额外跑 analyzeFile 并只合并
 * `nudo:interface-domain-exceeds`（设计 §6：check 门禁的跨文件用穿证据；
 * checkSource 单文件面无注入通道）。
 */
/** `@nudo:import` / ESM / 侧车闭包依赖内容：进 disk cache 键。
 *  truncated（闭包截断）时必须禁用磁盘复用——未入键的 dep 变更不会 miss。 */
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
  opts: { json?: boolean; callsites?: CallRecord[]; verbose?: boolean } = {},
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
    checkCacheKey,
  } = await import("@nudojs/service");
  const { sidecarPathOf } = await import("@nudojs/core");
  // package.json#nudo.interface.autoBind 覆盖 check 执法路径（§2.2「整体
  // 关闭」承诺：不只打印路径——false 时侧车 ambient 绑定整体停用）
  const proj = findProjectConfig(dirname(filePath));
  const autoBind = interfaceConfig(proj?.config).autoBind;
  const cacheRoot = diskCacheRoot(proj?.config, proj?.projectDir);
  const disk = new DiskCache({ root: cacheRoot, namespace: "check" });
  // --callsites 注入路径不做磁盘复用（证据面含调用记录）
  // 依赖闭包截断 → paths 不全，键可能陈旧：禁用磁盘复用（对齐 core memo fail-open）
  const dep = await collectCheckDepContents(filePath, source, loadModule);
  const useDisk = disk.enabled && !opts.callsites && !dep.truncated;
  // 侧车内容进键：autoBind 下契约变更必须 miss，否则 CI 读到过期结论
  let sidecarContent: string | null = null;
  if (autoBind !== false) {
    try {
      const scPath = sidecarPathOf(filePath);
      if (existsSync(scPath)) sidecarContent = readFileSync(scPath, "utf-8");
    } catch {
      sidecarContent = null;
    }
  }
  const cacheKey = useDisk
    ? checkCacheKey(filePath, source, {
        autoBind,
        projectDir: proj?.projectDir,
        sidecarContent,
        depContents: dep.depContents,
      })
    : undefined;
  const cached = cacheKey ? disk.get<ReturnType<typeof serializeCheckJson>>(cacheKey) : undefined;
  /** 缓存命中时的 CheckJson 原样（signatures[].abs 已是 formatAbs 字符串） */
  let cachedJson: ReturnType<typeof serializeCheckJson> | undefined;
  let algebraReport;
  if (cached) {
    cachedJson = cached;
    // CheckJson → CheckReport 最小回放（issues/ok/summary/signatures display）
    // abs 本体不在 JSON 里：display/detail 供人类输出；JSON 直接透传 cachedJson
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
        // 占位 Abs：JSON 路径不走这里；人类路径用 display
        abs: { shape: { k: "unknown" as const }, conf: s.conf as never },
        display: s.display,
        detail: s.detail,
        conf: s.conf as never,
      })),
      summary: { ...cached.summary },
    } as Awaited<ReturnType<typeof checkSource>>;
  } else {
    algebraReport = checkSource(filePath, source, pTrue, {
      loadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
    });
  }

  // domain-exceeds：注入调用记录 → analyzeFile 的跨文件证据执法（analyzer
  // 内已解析 autoBind）。只合并该码，避免与 checkSource 诊断双报。
  if (opts.callsites && opts.callsites.length > 0) {
    const analysis = await analyzeFileAsync(filePath, source, undefined, opts.callsites);
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
    // 稳定契约：缓存命中直接透传 CheckJson（signatures[].abs 保真）
    console.log(JSON.stringify(cachedJson ?? serializeCheckJson(algebraReport), null, 2));
  } else {
    // D2：默认人类短报告；--verbose 展开 term/pred/conf
    console.log(formatCheckReport(algebraReport, { verbose: opts.verbose === true }));
  }

  // B3：无调用点注入时写盘（失败 fail-open）
  if (useDisk && cacheKey && !cached) {
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

/** 单文件或目录 → 推断目标列表（目录递归，跳过 node_modules） */
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
  // 显式单文件与目录展开同口径：*.nudo.js/*.nudo.ts/.d.ts/.tsx 不是推断目标
  if (!isNudoTargetPath(resolved)) {
    console.error(`Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${resolved}`);
    process.exitCode = 1;
    return [];
  }
  return [resolved];
}

program
  .command("types")
  .description("Type-as-computation view: show term + constraints from the algebra (not just extensional shape)")
  .argument("<file>", "Path to the JS/TS file or a directory of them")
  .option("--fn <name>", "Only analyze this function")
  .option("--assume <pred...>", "Assume constraints, e.g. x>0 y>=1")
  .option("--generalize", "Show polymorphic signatures via symbolic execution")
  .action(
    async (
      file: string,
      opts: { fn?: string; assume?: string[]; generalize?: boolean },
    ) => {
      const targets = resolveTargets(file);
      if (targets.length === 0) return;
      for (const t of targets) {
        await runTypes(t, opts);
        if (targets.length > 1) console.log("");
      }
    },
  );

async function runTypes(
  filePath: string,
  opts: { fn?: string; assume?: string[]; generalize?: boolean },
): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const algebra = await import("@nudojs/core");

  const source = readFileSync(filePath, "utf8");
  let phi = algebra.pTrue;
  const assumeIds = new Set<string>();
  for (const a of opts.assume ?? []) {
    const m = /^([A-Za-z_$][\w$]*)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)$/.exec(a.trim());
    if (!m) {
      console.error(`无法解析 --assume: ${a}（支持 x>0 / x>=1）`);
      continue;
    }
    const id = m[1]!;
    const n = Number(m[3]);
    phi = algebra.gtNum(algebra.v(id), n);
    assumeIds.add(id);
  }

  // 列出函数
  const list = opts.fn ? [opts.fn] : algebra.listFunctionNames(source);
  if (list.length === 0) {
    console.error(`未找到函数: ${basename(filePath)}`);
    process.exitCode = 1;
    return;
  }

  const { defaultLoadModule: loadModule } = await import("@nudojs/service");

  console.log(`nudo types  ${basename(filePath)}`);
  if (assumeIds.size > 0) {
    console.log(`assume: ${[...assumeIds].map((id) => `${id} > 0`).join(", ")}`);
  }
  if (opts.generalize) {
    console.log("mode: generalize (symbolic α)\n");
  } else {
    console.log("");
  }

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
    const result = algebra.analyzeFn(source, name, args, phi);
    const label = `${name}(${args.map((a) => algebra.formatShape(a)).join(", ")})`;
    console.log(algebra.formatAbsMultiline(result, label));
    console.log("");
  }
}

program
  .command("check")
  .description("Check JS/TS file(s) or directory(s) for type errors — exits with code 1 when errors are found")
  .argument("<paths...>", "File(s) or directory(s) to check")
  .option("--json", "Emit stable CheckJson (CI / Agent contract; single file only)")
  .option("--verbose", "Expand Abs signatures (term/pred/conf detail)")
  .option(
    "--callsites <paths...>",
    "Usage-site files (tests/apps): inject their call records so cross-file domain evidence can produce nudo:interface-domain-exceeds",
  )
  .action(async (paths: string[], opts: { json?: boolean; callsites?: string[]; verbose?: boolean }) => {
    const targets: string[] = [];
    for (const p of paths) {
      targets.push(...resolveTargets(p));
    }
    if (targets.length === 0) return;
    if (opts.json && targets.length > 1) {
      console.error("--json requires a single file, not multiple targets");
      process.exitCode = 1;
      return;
    }
    const externalRecords = opts.callsites?.length ? collectExternalRecords(opts.callsites) : undefined;
    for (const t of targets) {
      await runCheck(t, { json: opts.json, callsites: externalRecords, verbose: opts.verbose });
    }
  });

/**
 * `nudo interface --draft`：从已有逻辑生成可审阅的 interface 草稿。
 * 默认 stdout；`--write` 落盘 `*.nudo.draft.js`（不 ambient 绑定）。
 */
async function runInterfaceDraft(
  file: string,
  opts: {
    fnNames: string[];
    write: boolean;
    dryRun: boolean;
    records?: CallRecord[];
  },
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
    // CLI 写盘边界：与 LSP assertEmitTargetAllowed 同口径的基础防护
    if (/node_modules/.test(filePath) || /node_modules/.test(draftPath)) {
      console.error(`Error: '${filePath}' is inside node_modules; draft write refused`);
      process.exitCode = 1;
      return;
    }
    const { findProjectConfig } = await import("@nudojs/service");
    // 项目根：优先 nudo 配置；否则回退最近 package.json 祖先
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
      const rootReal = (() => {
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
      const relToRoot = relative(rootReal, fileReal);
      if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
        console.error(`Error: '${filePath}' is outside project root '${projectRoot}'; draft write refused`);
        process.exitCode = 1;
        return;
      }
    }
    const write = writeInterfaceDraft(filePath, result.draftSource, {
      dryRun: opts.dryRun,
      ...(projectRoot ? { projectDir: projectRoot } : {}),
    });
    for (const line of formatDraftSummary(rel, draftRel, result, write)) console.log(line);
  } else {
    for (const line of formatDraftSummary(rel, draftRel, result)) console.log(line);
  }
}

/**
 * `nudo interface`（别名 `nudo refine`）：默认只打印每函数有效契约与来源分层
 * （handwritten / generated / implicit）——设计稿 §11 第 0 步。
 * `--emit` 走写盘器（interface-emitter.ts，§7.3/§9）。
 * `--draft` 生成待审契约草稿（interface-draft.ts，代码优先 / 迁移）。
 */
async function runInterface(file: string, records?: CallRecord[]): Promise<void> {
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

/**
 * `nudo interface --emit <file>`：
 * - 含手写契约根时走 root 驱动下行（§7.3 Phase 2）：`--fn` 可点名**下游**
 *   导出（如 lib.js 根上的 add2 → 写 add.nudo.js）；无 --fn/--all 时只
 *   刷新已有下游 @generated 段，不发明新契约；
 * - 同时对目标文件自身的导出走原有 callsite-domain emit（本文件侧车）。
 * 固定 mode=update；--exit-on-diff 配 --dry-run 作 CI 门禁。
 */
async function runInterfaceEmit(
  file: string,
  opts: { fnNames: string[]; all: boolean; dryRun: boolean; exitOnDiff: boolean; records?: CallRecord[] },
): Promise<void> {
  const { emitInterface, emitDerivedFromRoot } = await import("@nudojs/service");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  const fnNames = opts.fnNames.length > 0 ? opts.fnNames : undefined;

  // ---- Phase 2: root 驱动下行 ----
  // --fn/--all：点名或全量闭包；否则只刷新已有生成段（与本地 emit 同口径）
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
        console.log(`${scRel}: no derived interface changes (${sc.skipped ?? "no-change"})`);
      }
      for (const i of sc.issues) {
        console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
        if (i.severity === "error") process.exitCode = 1;
      }
      if (sc.written) derivedChanged = true;
    }
    if (derived.entryOnly) {
      console.log(`${rel}: no handwritten contract root (root lives elsewhere); only refreshing existing @generated segments`);
    }
  }

  // ---- 本文件自身导出：原有 callsite-domain emit ----
  // --fn 只点名下游导出时（如 --emit lib.js --fn add2），本地 emit 不再
  // 报 not-an-export；改为刷新已有 @generated 段（与无 --fn 同口径）
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
    if (i.severity === "error") process.exitCode = 1;
  }
  const anyChanged = result.changed || derivedChanged;
  if (opts.exitOnDiff && anyChanged) process.exitCode = 1;
  if (anyChanged && !opts.dryRun) {
    console.log(`  re-run \`nudo check ${rel}\` to see the persisted interfaces in action`);
  }
}

program
  .command("interface")
  .alias("refine")
  .description(
    "Print each function's effective interface with its source layer (handwritten / generated / implicit); --emit persists call-site domains; --draft generates a reviewable contract draft from existing code",
  )
  .argument("[paths...]", "File(s) or directory(s); at least one required (with --emit these are the emit targets)")
  .option("--emit", "Write/update @generated sidecar segments instead of printing (mode: update — strips and rewrites generated segments, idempotent)")
  .option(
    "--draft",
    "Generate a reviewable interface draft from existing code (code-first / migration); prints a *.nudo.draft.js module — not auto-bound until you copy it into *.nudo.js",
  )
  .option(
    "--write",
    "With --draft: write/update <file>.nudo.draft.js on disk (never touches handwritten *.nudo.js)",
  )
  .option(
    "--fn <name>",
    "With --emit/--draft: only these export names (repeatable). With --emit may name a downstream export in the root derivation closure",
    (v: string, acc: string[]) => {
      acc.push(v);
      return acc;
    },
    [] as string[],
  )
  .option("--all", "With --emit: target every top-level export of the file (explicit opt-in — prefer --fn to keep diffs reviewable)")
  .option("--dry-run", "With --emit or --draft --write: print instead of writing to disk")
  .option("--exit-on-diff", "With --emit + --dry-run: exit 1 when the sidecar would change (CI gate; same as infer --emit-cases)")
  .option("--callsites <paths...>", "Usage-site files (tests/apps): their calls to this file's exports feed the domain evidence for print/emit/draft (domain roots with no in-file call sites)")
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
        callsites?: string[];
      },
    ) => {
      if (paths.length === 0) {
        console.error(
          "Usage error: `nudo interface` needs at least one path. " +
            (opts.emit
              ? "Writing additionally respects filters: --fn <names> / --all (default: only refresh existing @generated segments)."
              : opts.draft
                ? "Draft mode: pass a file or directory to generate reviewable contracts from existing code."
                : "Print-only this phase; pass a file or directory."),
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
      if (!opts.emit && !opts.draft && ((opts.fn?.length ?? 0) > 0 || opts.all)) {
        console.error("warning: --fn/--all only apply with --emit or --draft (ignored for print-only)");
      }
      if (opts.emit && opts.all) {
        console.error(
          "warning: --all emits every export of the target file(s); review noise grows fast — prefer --fn.",
        );
      }
      const targets: string[] = [];
      for (const p of paths) targets.push(...resolveTargets(p));
      const externalRecords = opts.callsites?.length ? collectExternalRecords(opts.callsites) : undefined;
      // 侧车（*.nudo.js / *.nudo.ts）是契约模块不是接口根——显式传入或目录
      // 扫描命中都跳过，避免对契约文件本身打印 "(no top-level functions found)" 噪声
      const roots = targets.filter((t) => !/\.nudo\.(js|ts)$/.test(t) && !/\.nudo\.draft\.(js|ts)$/.test(t));
      if (roots.length === 0) return;
      for (const t of roots) {
        try {
          if (opts.draft) {
            await runInterfaceDraft(t, {
              fnNames: opts.fn ?? [],
              write: opts.write === true,
              dryRun: opts.dryRun === true,
              records: externalRecords,
            });
          } else if (opts.emit) {
            await runInterfaceEmit(t, {
              fnNames: opts.fn ?? [],
              all: opts.all === true,
              dryRun: opts.dryRun === true,
              exitOnDiff: opts.exitOnDiff === true,
              records: externalRecords,
            });
          } else {
            await runInterface(t, externalRecords);
          }
        } catch (err) {
          console.error(`Error analyzing ${relative(process.cwd(), t)}: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    },
  );

program
  .command("test")
  .description("Run @nudo:case directives as assertions (case-as-test); exit 1 on failure")
  .argument("<file>", "Path to the JS/TS file or a directory of them")
  .action(async (file: string) => {
    const targets = resolveTargets(file);
    if (targets.length === 0) return;
    for (const filePath of targets) {
      const source = readFileSync(filePath, "utf-8");
      try {
        const result = await analyzeFileAsync(filePath, source);
        const report = buildTestReport(filePath, result);
        console.log(formatTestReport(report));
        if (report.failed > 0) process.exitCode = 1;
      } catch (err) {
        console.error(`nudo test failed to analyze ${filePath}: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  });

// ---------------------------------------------------------------------------
// doctor — 项目健康检查：uncovered 函数 / 调用点固化漂移 / 分析报错
// ---------------------------------------------------------------------------

/** doctor 单文件体检结果：uncovered 为信息级，drift/error 决定退出码 */
type DoctorReport = {
  file: string;
  functions: number;
  entryOnly: number;
  uncovered: string[];
  drift?: { added: number; removed: number };
  /** 已落盘 @generated 契约 ≠ 今日重算（Phase 3 §9 doctor interface drift） */
  interfaceDrift?: number;
  error?: string;
};

/** 展示路径：cwd 内取相对路径，cwd 外（如 /tmp fixture）直接用绝对路径，避免 ../ 链 */
const displayPath = (p: string): string => {
  const rel = relative(process.cwd(), p);
  return rel === "" || rel.startsWith("..") ? p : rel;
};

/**
 * 单文件体检。四项检查：
 *  a) uncovered —— 零 case 且非 skipped/entryOnly 的函数（信息级，不影响退出码）；
 *  b) drift —— 给了调用记录时按 infer --emit-cases=update 的 dry-run 编排
 *     （剥离 → 重析 → 重插）重算固化结果，最终源码与原源码不一致即漂移；
 *  c) interface drift —— 侧车存在 @generated 段时，checkSource 的
 *     nudo:interface-drift warning 计数（Phase 3：只针对已落盘契约）；
 *  d) 报错 —— 读取/分析抛异常即记。
 */
async function doctorFile(filePath: string, records?: CallRecord[]): Promise<DoctorReport> {
  const report: DoctorReport = { file: displayPath(filePath), functions: 0, entryOnly: 0, uncovered: [] };
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
    // Phase 3：已落盘契约的 interface drift（只在侧车含 @generated 时跑）
    const drift = await countInterfaceDrift(filePath);
    report.interfaceDrift = drift.count;
    if (drift.error) report.error = drift.error;
  } catch (err) {
    report.error = (err as Error).message;
  }
  return report;
}

/**
 * 已落盘 @generated 契约的 drift 计数（Phase 3）：
 * 侧车无生成段 → 0（不跑 check，避免噪声）；有则 checkSource 收
 * nudo:interface-drift warning。check 失败上抛为 error，不静默吞成 0。
 */
async function countInterfaceDrift(
  filePath: string,
): Promise<{ count: number; error?: string }> {
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
    const r = checkSource(abs, rf(abs, "utf-8"), pTrue, {
      loadModule: defaultLoadModule,
      fromFile: abs,
    });
    return { count: r.issues.filter((i) => i.code === "nudo:interface-drift").length };
  } catch (e) {
    return {
      count: 0,
      error: `interface drift: checkSource failed: ${(e as Error).message}`,
    };
  }
}

async function runDoctor(paths: string[], opts: { callsites?: string[]; json?: boolean }): Promise<void> {
  const targetPaths = paths.length > 0 ? paths : ["."];
  const externalRecords = opts.callsites?.length ? collectExternalRecords(opts.callsites) : undefined;

  // 目标展开：文件直接体检，目录递归收 .js（与 --callsites 同一规则）；
  // 不存在的路径直接记为报错
  const files: string[] = [];
  const reports: DoctorReport[] = [];
  for (const p of targetPaths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      reports.push({ file: displayPath(abs), functions: 0, entryOnly: 0, uncovered: [], error: `File not found: ${abs}` });
      continue;
    }
    files.push(...(statSync(abs).isDirectory() ? collectNudoFiles(abs) : [abs]));
  }
  for (const filePath of files) {
    reports.push(await doctorFile(filePath, externalRecords));
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
          // ok 与退出码一致：drift/报错 → false；uncovered 仅为信息级不影响
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
        console.log(`  ⚠ uncovered (no cases): ${r.uncovered.join(", ")}`);
      }
      if (r.drift) {
        const refresh = `nudo infer ${r.file} --callsites ${(opts.callsites ?? []).join(" ")} --emit-cases=update`;
        console.log(
          `  ✗ drift: ${r.drift.added + r.drift.removed} directive(s) changed (+${r.drift.added} new, -${r.drift.removed} removed) — refresh with: ${refresh.trim()}`,
        );
      }
      if ((r.interfaceDrift ?? 0) > 0) {
        console.log(
          `  ✗ interface drift: ${r.interfaceDrift} @generated slot(s) ≠ today's recompute — refresh with: nudo interface --emit ${r.file} --fn <name>`,
        );
      }
    }
    console.log(
      `\nSummary: ${reports.length} file(s) · ${driftCount} case drift · ${ifaceDriftCount} interface drift · ${errorCount} error(s) · ${uncoveredTotal} uncovered function(s)`,
    );
    console.log(failed ? "Result: FAIL (drift or errors found)" : "Result: OK (uncovered function(s) are informational only)");
  }

  if (failed) process.exitCode = 1;
}

program
  .command("doctor")
  .description(
    "Health-check JS files: functions without cases, call-site solidification drift (--callsites), persisted interface drift, analysis errors — exits 1 on drift/errors",
  )
  .argument("[paths...]", "File(s) or directory(s) to check (default: current directory)")
  .option("--callsites <paths...>", "Usage-site files (tests/apps): re-solidify per current call shapes and report drift when directives would change")
  .option("--json", "Output as JSON")
  .action(async (paths: string[], opts: { callsites?: string[]; json?: boolean }) => {
    await runDoctor(paths, opts);
  });

program
  .command("watch")
  .description("Watch file(s) for changes and re-run inference")
  .argument("<path>", "File or directory to watch")
  .option("--dts", "Generate .d.ts files on each change")
  .action((watchPath: string, opts: { dts?: boolean }) => {
    const resolved = resolve(watchPath);
    const isDir = existsSync(resolved) && statSync(resolved).isDirectory();

    const getFiles = (): string[] => {
      if (!isDir) return [resolved];
      return collectNudoFiles(resolved);
    };

    let graph = buildModuleGraph(getFiles());

    const runAll = async () => {
      console.clear();
      console.log(`[${new Date().toLocaleTimeString()}] Analyzing...\n`);
      for (const f of getFiles()) {
        try {
          await runInfer(f, { dts: opts.dts, showLoc: true });
        } catch (err) {
          console.error(`Error analyzing ${relative(process.cwd(), f)}:`, (err as Error).message);
        }
      }
      graph = buildModuleGraph(getFiles());
      console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    };

    const runIncremental = async (changedFiles: string[]) => {
      const files = getFiles();
      const tracked = new Set(files);

      // 合并多文件变更的脏集（union）：每个变更文件的脏集 = 自身 + 传递依赖方
      const dirtyUnion = new Set<string>();
      for (const cf of changedFiles) {
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(d);
      }
      const dirty = [...dirtyUnion].filter((f) => tracked.has(f));
      if (dirty.length === 0) return;

      // 依赖先析：moduleCache 中未重析依赖的类型可被复用
      const ordered = topoSortDirty(graph.imports, dirty);

      console.clear();
      console.log(`[${new Date().toLocaleTimeString()}] Analyzing (incremental)...\n`);
      const t0 = performance.now();
      // 缓存失效：B-path / AnalysisResult / fn-cache 键不含 dep 指纹——
      // 必须按脏集入口文件定向逐出，否则命中陈旧结果。
      // B5：与 LSP 同进程时共用 AnalysisSession 失效面
      getAnalysisSession().evictForDependents(ordered);
      for (const f of ordered) {
        try {
          await runInfer(f, { dts: opts.dts, showLoc: true });
        } catch (err) {
          console.error(`Error analyzing ${relative(process.cwd(), f)}:`, (err as Error).message);
        }
      }
      const elapsed = Math.round(performance.now() - t0);
      console.log(`Incremental: re-analyzed ${ordered.length}, skipped ${files.length - ordered.length} (${elapsed}ms)`);
      console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);

      // 重建全图：文件数少时开销可忽略，选简单路线
      graph = buildModuleGraph(getFiles());
    };

    runAll().catch(() => { /* per-file errors already reported */ });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watchTarget = isDir ? resolved : dirname(resolved);

    const pendingChanged = new Set<string>();

    watch(watchTarget, { recursive: isDir }, (_event, filename) => {
      if (!filename) return;
      const fullPath = isDir ? join(watchTarget, filename) : resolved;
      if (!isNudoTargetPath(fullPath)) return; // .js/.mjs/.ts（排除 .d.ts/.tsx）
      if (!existsSync(fullPath)) return; // deleted

      pendingChanged.add(fullPath);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const changedFiles = [...pendingChanged];
        pendingChanged.clear();
        runIncremental(changedFiles).catch(() => { /* per-file errors already reported */ });
      }, 200);
    });
  });

function collectNudoFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectNudoFiles(fullPath));
    } else if (entry.isFile() && isNudoTargetPath(fullPath)) {
      // 全程序推断：无指令的纯 JS/TS 文件也能推导类型；.d.ts（类型声明）与
      // .tsx（JSX）不是推断目标，由 isNudoTargetPath 排除
      results.push(fullPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// generate 命令的 FunctionAnalysis 组装件：dts 分支复用 service 的
// generateFunctionDtsLines（与 infer --dts / service generateDts 同一实现），
// loc 与参数名提取与 analyzer 的 locFromNode/extractParamNames 保持同构，
// 保证两条路径对同一文件输出一致
// ---------------------------------------------------------------------------

type DirectiveFnNode = ReturnType<typeof extractDirectives>[number]["node"];

function nodeLoc(node: DirectiveFnNode): FunctionAnalysis["loc"] {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

function fnParamNames(node: DirectiveFnNode): string[] {
  const fn = node.type === "ExportDefaultDeclaration" ? node.declaration : node;
  const paramListOf = (params: readonly any[]): string[] =>
    params.map((p: any) => {
      if (p.type === "Identifier") return p.name;
      if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
      if (p.type === "RestElement" && p.argument.type === "Identifier") return `...${p.argument.name}`;
      return "_";
    });
  if (fn.type === "FunctionDeclaration" || fn.type === "FunctionExpression" || fn.type === "ArrowFunctionExpression") {
    return paramListOf(fn.params);
  }
  if (fn.type === "VariableDeclaration") {
    const init = fn.declarations[0].init;
    if (init?.type === "FunctionExpression" || init?.type === "ArrowFunctionExpression") {
      return paramListOf(init.params);
    }
  }
  return [];
}

/** generate/emit/guard 共用管道：analyzeFileAsync → zod/guard/dts 片段 */
async function runGenerate(
  file: string,
  format: "zod" | "guard" | "dts" | "all",
  output?: string,
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  // 与 infer/check 同一分析管道（Abs 优先 + refine + env preload）
  const result = await analyzeFileAsync(filePath, source);
  const functions = result.functions.filter(
    (f) => f.cases.some((c) => c.source === "directive"),
  );

  if (functions.length === 0) {
    console.log("No functions with @nudo:case directives found.");
    return;
  }

  const zodChunks: string[] = [];
  const guardChunks: string[] = [];
  const dtsChunks: string[] = [];

  for (const fn of functions) {
    const caseResults: CaseResult[] = fn.cases.filter((c) => c.source === "directive");
    const baseName = fn.name;

    if (format === "zod" || format === "all") {
      const lines: string[] = [`\n// === ${baseName} Zod Schemas ===`];
      for (const c of caseResults) {
        const inputSchemas = c.argAbs.map((a, i) => `arg${i}: ${absToZodSchema(a)}`).join(", ");
        const outputSchema = absToZodSchema(c.abs);
        lines.push(`// Case "${c.name}":`);
        lines.push(`// Input: { ${inputSchemas} }`);
        lines.push(`// Output: ${outputSchema}`);
      }
      zodChunks.push(lines.join("\n"));
    }

    if (format === "guard" || format === "all") {
      const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
      for (const c of caseResults) {
        const guardName = `is${baseName}${c.name.charAt(0).toUpperCase() + c.name.slice(1)}Output`;
        lines.push(generateGuardFunctionFromAbs(guardName, c.abs));
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
    if (zodChunks.length > 0) {
      const p = join(outDir, `${stem}.nudo.zod.ts`);
      writeFileSync(p, zodChunks.join("\n") + "\n", "utf-8");
      written.push(p);
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

  for (const chunk of [...zodChunks, ...guardChunks, ...dtsChunks]) {
    console.log(chunk);
  }
}

program
  .command("generate")
  .description("Generate runtime validators from inferred types")
  .argument("<file>", "JavaScript file to analyze")
  .option("--format <format>", "Output format: zod, guard, dts, all", "all")
  .option("--output <dir>", "Write validator files to this directory (omit for stdout)")
  .action(async (file: string, options: { format: string; output?: string }) => {
    const format = options.format;
    if (!["zod", "guard", "dts", "all"].includes(format)) {
      console.error(`Unknown --format ${format}; expected zod | guard | dts | all`);
      process.exitCode = 1;
      return;
    }
    await runGenerate(file, format as "zod" | "guard" | "dts" | "all", options.output);
  });

/** 设计命令面 `nudo emit`：为 npm 生态导出 .d.ts（= generate --format dts） */
program
  .command("emit")
  .description("Emit TypeScript .d.ts declarations from inferred types (npm compatibility exit)")
  .argument("<file>", "JavaScript file to analyze")
  .option("--output <dir>", "Write <stem>.d.ts to this directory (omit for stdout)")
  .action(async (file: string, options: { output?: string }) => {
    await runGenerate(file, "dts", options.output);
  });

/** 设计命令面 `nudo guard`：边界运行时校验（= generate --format guard） */
program
  .command("guard")
  .description("Generate runtime type-guard functions from inferred result types")
  .argument("<file>", "JavaScript file to analyze")
  .option("--output <dir>", "Write <stem>.nudo.guard.ts to this directory (omit for stdout)")
  .action(async (file: string, options: { output?: string }) => {
    await runGenerate(file, "guard", options.output);
  });

// ---------------------------------------------------------------------------
// harvest — convert @types/<pkg> .d.ts into a Nudo env module
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
      // malformed package.json — fall back to index.d.ts
    }
  }
  if (!existsSync(entry)) {
    console.error(`Error: no .d.ts entry found in ${relative(process.cwd(), typesDir)} (tried ${basename(entry)}).`);
    process.exitCode = 1;
    return;
  }

  // 单一收集实现（service）：入口 BFS + reference/相对 import 图
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
  const hintPath =
    resolve(process.cwd()) === outDir ? basename(out) : out;
  console.log(`  /// @nudo:env ${hintPath}`);
}

program
  .command("harvest")
  .description("Convert @types/<pkg> .d.ts declarations into a Nudo env file (TS source using T.* constructors)")
  .argument("[pkg]", "Package name under @types (e.g. node)")
  .option("--out <file>", "Output .ts env file (default: ./nudo-harvest-<pkg>.ts)")
  .option("--auto [dir]", "Scan directory (default .) for bare imports and report auto-harvestable @types packages")
  .action(async (pkg: string | undefined, opts: { out?: string; auto?: boolean | string }) => {
    if (opts.auto !== undefined) {
      const dir = resolve(typeof opts.auto === "string" ? opts.auto : ".");
      const files = existsSync(dir) && statSync(dir).isDirectory()
        ? collectNudoFiles(dir)
        : existsSync(dir)
          ? [dir]
          : [];
      if (files.length === 0) {
        console.error(`No inference targets under ${dir}`);
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
      console.log(`\nAnalysis injects these automatically; use \`nudo harvest <pkg>\` to write a persistent env file.`);
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
