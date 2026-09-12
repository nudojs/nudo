import { readFileSync, existsSync, watch, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative, join, basename } from "node:path";
import { Command } from "commander";
import {
  T,
  typeValueToString,
  createEnvironment,
  mockHelperToTypeValue,
} from "@nudojs/core";
import type { TypeValue } from "@nudojs/core";
import { parse, extractDirectives, parseTypeValueExpr } from "@nudojs/parser";
import { evaluateFunctionFull, evaluateProgram, setModuleResolver, setCurrentFileDir, resetMemo } from "./evaluator.ts";
import {
  typeValueToZodSchema,
  generateGuardFunction,
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
  type CallRecord,
  type CaseResult,
  type FunctionAnalysis,
  type AnalysisResult,
  type EmitResult,
} from "@nudojs/service";
import { harvestDts, emitEnvModule } from "@nudojs/harvester";
import { resolveNpmNudo } from "./resolve-npm.ts";
import { buildTestReport, formatTestReport } from "./run-test.ts";

const program = new Command();

program
  .name("nudo")
  .description("Nudo type inference engine")
  .version("0.0.1");

function applyMocks(
  directives: ReturnType<typeof extractDirectives>[number]["directives"],
  env: ReturnType<typeof createEnvironment>,
  filePath: string,
): void {
  for (const d of directives) {
    if (d.kind !== "mock") continue;
    if (d.arrowFn) {
      // Create a function TypeValue from the parsed arrow function
      const fnType = T.fn(d.arrowFn.params, d.arrowFn.body, env);
      (fnType as any)._paramPatterns = d.arrowFn.paramPatterns;
      env.bind(d.name, fnType);
    } else if (d.nudoMock) {
      // Handle Nudo mock helpers (stub, spy, mock)
      const typeVal = mockHelperToTypeValue(d.nudoMock, env);
      env.bind(d.name, typeVal);
    } else if (d.sinonExpr) {
      // Handle sinon expressions
      const sinonType = createSinonTypeValue(d.sinonExpr);
      env.bind(d.name, sinonType);
    } else if (d.expression) {
      env.bind(d.name, parseTypeValueExpr(d.expression));
    } else if (d.fromPath) {
      const mockPath = resolve(dirname(filePath), d.fromPath);
      const mockSource = readFileSync(mockPath, "utf-8");
      const mockAst = parse(mockSource);
      const mockEnv = createEnvironment();
      evaluateProgram(mockAst, mockEnv);
      const mockVal = mockEnv.lookup(d.name);
      env.bind(d.name, mockVal);
    }
  }
}

function createSinonTypeValue(sinonExpr: { type: string; returnValue?: TypeValue; resolvedValue?: TypeValue; rejectedValue?: TypeValue }): TypeValue {
  const body = { type: "BlockStatement", body: [] } as any;
  const fn = T.fn(["...args"], body, createEnvironment());

  if (sinonExpr.returnValue) {
    (fn as any)._directReturn = sinonExpr.returnValue;
  } else if (sinonExpr.resolvedValue) {
    (fn as any)._directReturn = T.promise(sinonExpr.resolvedValue);
  } else if (sinonExpr.rejectedValue) {
    (fn as any)._directReturn = T.never;
  } else {
    (fn as any)._directReturn = T.unknown;
  }

  return fn;
}

function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string; json?: unknown } | null {
  const extensions = [".js", ".ts", ".mjs"];

  const nudoPath = resolveNpmNudo(source, fromDir);
  if (nudoPath) {
    const src = readFileSync(nudoPath, "utf-8");
    return { ast: parse(src), filePath: nudoPath };
  }

  const basePath = resolve(fromDir, source);

  for (const ext of ["", ...extensions]) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) {
      // .json 模块：CJS require('../package.json') 等常见模式——按 JSON 求值
      if (candidate.endsWith(".json")) {
        try {
          return { ast: parse("module.exports = undefined;"), filePath: candidate, json: JSON.parse(readFileSync(candidate, "utf-8")) };
        } catch {
          return null;
        }
      }
      const src = readFileSync(candidate, "utf-8");
      return { ast: parse(src), filePath: candidate };
    }
  }
  return null;
}

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
      if (fn.combined) {
        console.log(`Skipped (declared): ${typeValueToString(fn.combined)}`);
      } else {
        console.log("Skipped (no return type declared)");
      }
      console.log();
      continue;
    }

    for (const c of fn.cases) {
      const argsStr = c.args.map(typeValueToString).join(", ");
      let line = `Case "${c.name}": (${argsStr}) => ${typeValueToString(c.result)}`;
      if (c.throws.kind !== "never") line += ` throws ${typeValueToString(c.throws)}`;
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

    if (fn.cases.length > 1 && fn.combined) {
      console.log(`\nCombined: ${typeValueToString(fn.combined)}`);
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
          const argsStr = c.args.map(typeValueToString).join(", ");
          let line = `Case "${c.name}": (${argsStr}) => ${typeValueToString(c.result)}`;
          if (c.throws.kind !== "never") line += ` throws ${typeValueToString(c.throws)}`;
          console.log(line);
        }
        if (fn.cases.length > 1 && fn.combined) {
          console.log(`\nCombined: ${typeValueToString(fn.combined)}`);
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

async function runCheck(file: string, opts: { json?: boolean } = {}): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");

  // 代数门禁：约束蕴含（类型即计算）
  const { checkSource, formatCheckReport, serializeCheckJson, pTrue } = await import("@nudojs/core");
  const loadModule = (spec: string, fromFile: string): string | undefined => {
    if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
    try {
      const base = dirname(resolve(fromFile));
      let p = resolve(base, spec);
      const tryPaths = [
        p,
        `${p}.js`,
        `${p}.mjs`,
        join(p, "index.js"),
        join(p, "index.mjs"),
      ];
      for (const cand of tryPaths) {
        if (!existsSync(cand) || statSync(cand).isDirectory()) continue;
        return readFileSync(cand, "utf-8");
      }
      return undefined;
    } catch {
      return undefined;
    }
  };
  const algebraReport = checkSource(filePath, source, pTrue, {
    loadModule,
    fromFile: filePath,
  });

  if (opts.json) {
    // 稳定契约：只输出 check JSON，不混 evaluator 文本
    console.log(JSON.stringify(serializeCheckJson(algebraReport), null, 2));
    if (!algebraReport.ok) process.exitCode = 1;
    return;
  }

  console.log(formatCheckReport(algebraReport, { verbose: true }));

  // 外延评估器诊断：null/结构等语言表面
  const result = await analyzeFileAsync(filePath, source);
  for (const d of result.diagnostics) {
    const loc = `${relative(process.cwd(), filePath)}:${d.range.start.line}:${d.range.start.column}`;
    console.log(`[${d.severity}] ${loc} ${d.message}${d.code ? ` (${d.code})` : ""}`);
    if (d.origin) {
      console.log(`    → value originates at ${d.origin.line}:${d.origin.column}`);
    }
  }

  const evalError = result.diagnostics.some((d) => d.severity === "error");
  if (!algebraReport.ok || evalError) {
    process.exitCode = 1;
  }
}

program
  .command("types")
  .description("Type-as-computation view: show term + constraints from the algebra (not just extensional shape)")
  .argument("<file>", "Path to the JS file")
  .option("--fn <name>", "Only analyze this function")
  .option("--assume <pred...>", "Assume constraints, e.g. x>0 y>=1")
  .option("--generalize", "Show polymorphic signatures via symbolic execution")
  .action(
    async (
      file: string,
      opts: { fn?: string; assume?: string[]; generalize?: boolean },
    ) => {
      const { readFileSync, existsSync, statSync } = await import("node:fs");
      const { basename, dirname, resolve: resolvePath } = await import("node:path");
      const algebra = await import("@nudojs/core");

      const filePath = resolvePath(file);
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
        console.error("未找到函数");
        process.exitCode = 1;
        return;
      }

      const loadModule = (spec: string, fromFile: string): string | undefined => {
        if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
        try {
          const base = dirname(resolvePath(fromFile));
          const p = resolvePath(base, spec);
          for (const cand of [p, `${p}.js`, `${p}.mjs`]) {
            if (existsSync(cand) && !statSync(cand).isDirectory()) {
              return readFileSync(cand, "utf-8");
            }
          }
          return undefined;
        } catch {
          return undefined;
        }
      };

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
    },
  );

program
  .command("check")
  .description("Check a JS file for type errors — exits with code 1 when errors are found")
  .argument("<file>", "Path to the JS file")
  .option("--json", "Emit stable CheckJson (CI / Agent contract)")
  .action(async (file: string, opts: { json?: boolean }) => {
    await runCheck(file, opts);
  });

program
  .command("test")
  .description("Run @nudo:case directives as assertions (case-as-test); exit 1 on failure")
  .argument("<file>", "Path to the JS file")
  .action(async (file: string) => {
    const filePath = resolve(file);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
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
  error?: string;
};

/** 展示路径：cwd 内取相对路径，cwd 外（如 /tmp fixture）直接用绝对路径，避免 ../ 链 */
const displayPath = (p: string): string => {
  const rel = relative(process.cwd(), p);
  return rel === "" || rel.startsWith("..") ? p : rel;
};

/**
 * 单文件体检。三项检查：
 *  a) uncovered —— 零 case 且非 skipped/entryOnly 的函数（信息级，不影响退出码）；
 *  b) drift —— 给了调用记录时按 infer --emit-cases=update 的 dry-run 编排
 *     （剥离 → 重析 → 重插）重算固化结果，最终源码与原源码不一致即漂移，
 *     指令数按 removed/新增 written 计；
 *  c) 报错 —— 读取/分析抛异常即记（含 update dry-run 阶段）。
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
  } catch (err) {
    report.error = (err as Error).message;
  }
  return report;
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
  const errorCount = reports.filter((r) => r.error).length;
  const uncoveredTotal = reports.reduce((n, r) => n + r.uncovered.length, 0);
  const failed = driftCount > 0 || errorCount > 0;

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
            ...(r.error ? { error: r.error } : {}),
          })),
          summary: { files: reports.length, drift: driftCount, errors: errorCount, uncovered: uncoveredTotal },
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
    }
    console.log(
      `\nSummary: ${reports.length} file(s) · ${driftCount} drift · ${errorCount} error(s) · ${uncoveredTotal} uncovered function(s)`,
    );
    console.log(failed ? "Result: FAIL (drift or errors found)" : "Result: OK (uncovered function(s) are informational only)");
  }

  if (failed) process.exitCode = 1;
}

program
  .command("doctor")
  .description("Health-check JS files: functions without cases, call-site solidification drift (--callsites), analysis errors — exits 1 on drift/errors")
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
      // 缓存失效：callMemo 按名键陈旧 + moduleCache 嵌入旧类型
      resetMemo();
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
          const inputSchemas = c.args.map((a, i) => `arg${i}: ${typeValueToZodSchema(a)}`).join(", ");
          const outputSchema = typeValueToZodSchema(c.result);
          lines.push(`// Case "${c.name}":`);
          lines.push(`// Input: { ${inputSchemas} }`);
          lines.push(`// Output: ${outputSchema}`);
        }
        zodChunks.push(lines.join("\n"));
      }

      if (format === "guard" || format === "all") {
        const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
        for (const c of caseResults) {
          lines.push(
            generateGuardFunction(
              `is${baseName}${c.name.charAt(0).toUpperCase() + c.name.slice(1)}Output`,
              c.result,
            ),
          );
        }
        guardChunks.push(lines.join("\n"));
      }

      if (format === "dts" || format === "all") {
        dtsChunks.push(generateFunctionDtsLines(fn).join("\n"));
      }
    }

    const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
    if (options.output) {
      const outDir = resolve(options.output);
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
  .argument("<pkg>", "Package name under @types (e.g. node)")
  .option("--out <file>", "Output .ts env file (default: ./nudo-harvest-<pkg>.ts)")
  .action((pkg: string, opts: { out?: string }) => {
    runHarvest(pkg, opts.out);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? (process.env.NUDO_DEBUG ? err.stack : err.message) : err);
  process.exitCode = 1;
});
