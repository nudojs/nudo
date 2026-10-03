/**
 * nudo test — 逐 case 调用点真值 + 可选断言。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import type { Command } from "commander";
import {
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitResult,
} from "@nudojs/service/emit";
import { analyzeFileAsync, getPathEnvLoadErrors, type CallRecord } from "@nudojs/service";
import { ENV_UNRESOLVED_CODE } from "../check-json-map.ts";
import { buildTestReport, formatTestReport } from "../run-test.ts";
import {
  collectExternalRecords,
  reportPathErrors,
  resolveTargetsCollect,
  startWatch,
  reemitUpdate,
  runAbsView,
  displayPathOf,
  variadicSwallowError,
  type EmitCasesOptions,
  type PathError,
} from "./shared.ts";

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
    /** --json 面：路径错误并入 CaseJson（ok↔exit 同源的 test 面） */
    pathErrors?: PathError[];
    /** env-unresolved 告警去重表（同 baseDir 多文件只报一次；批轮/watch 轮由调用方持有） */
    envErrorSeen?: Set<string>;
  } = {},
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  let result = await analyzeFileAsync(filePath, source, undefined, opts.from, undefined, "all");

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
    const { serializeCaseJson } = await import("@nudojs/service/emit");
    const json = serializeCaseJson(result, filePath) as Record<string, unknown>;
    json.assertions = {
      passed: report.passed,
      failed: report.failed,
      unchecked: report.unchecked,
    };
    const pathErrors = opts.pathErrors ?? [];
    if (pathErrors.length > 0) {
      json.pathErrors = pathErrors.map((e) => ({
        path: e.path,
        code: e.code,
        message: e.message,
        suggestion: e.suggestion,
      }));
    }
    console.log(JSON.stringify(json, null, 2));
    if (report.failed > 0 || pathErrors.length > 0) process.exitCode = 1;
    else process.exitCode = 0;
  } else if (opts.abs) {
    // 观察面仍走 abs，但声明断言失败必须可见 + 挡 exit（design §1.3 / §0）
    const report = buildTestReport(displayPathOf(filePath), result);
    await runAbsView(filePath, {});
    console.log("");
    console.log(formatTestReport(report));
    if (report.failed > 0) process.exitCode = 1;
  } else {
    const report = buildTestReport(displayPathOf(filePath), result);
    console.log(formatTestReport(report));
    if (report.failed > 0) process.exitCode = 1;
  }

  // path env 加载失败必须可见（issue #88 原始复现面）：与 check 同格式告警，
  // 仅告警——不改退出码、不改 case 输出结构（--json 面走 stderr，stdout
  // 保持机器契约）。preload 点在 analyzeFileAsync 内部（baseDir=dirname），
  // 此处按同 baseDir 过滤；seen 表跨文件去重（同 baseDir 多文件只报一次）。
  {
    const seen = opts.envErrorSeen ?? new Set<string>();
    const envLoadErrors = getPathEnvLoadErrors(dirname(filePath)).filter(
      (e) => !seen.has(`${e.baseDir}\0${e.path}\0${e.error}`),
    );
    if (envLoadErrors.length > 0) {
      const emit = opts.json ? console.error : console.log;
      emit("");
      emit("env warnings");
      for (const e of envLoadErrors) {
        seen.add(`${e.baseDir}\0${e.path}\0${e.error}`);
        emit(`  [WARNING] path env failed to load: ${e.path} — ${e.error}  (${ENV_UNRESOLVED_CODE})`);
      }
    }
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

export function registerTestCommand(program: Command): void {
  program
    .command("test")
    .description("Report every inferred case (call@/entry@ + debug witnesses); assert declared expectations")
    .argument("[paths...]", "File(s) or directory(s)")
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
        // BUG-024：--from variadic 吞噬其后的位置参数——
        // paths 空且 --from 非空时定向 usage error
        // （直指旗标 + `--` 终止符解法）
        if (paths.length === 0) {
          if (opts.from?.length) {
            variadicSwallowError("test", ["--from"]);
            return;
          }
          console.error("Usage error: `nudo test` needs at least one path.");
          process.exitCode = 1;
          return;
        }
        const targets: string[] = [];
        const pathErrors: PathError[] = [];
        for (const p of paths) {
          const r = resolveTargetsCollect(p);
          targets.push(...r.targets);
          pathErrors.push(...r.errors);
        }
        if (!opts.json) {
          reportPathErrors(pathErrors);
          if (targets.length === 0) return;
        }
        if (opts.json && targets.length > 1) {
          console.error("--json requires a single file");
          process.exitCode = 1;
          return;
        }
        const fromErrors: PathError[] = [];
        const externalRecords = opts.from?.length
          ? collectExternalRecords(opts.from, opts.json ? fromErrors : undefined)
          : undefined;
        const allPathErrors = [...pathErrors, ...fromErrors];
        if (opts.json && targets.length === 0) {
          // 路径错误也必须有 JSON body（绝不空 stdout + exit 1）
          const file = allPathErrors[0]?.path ?? paths[0] ?? "";
          console.log(
            JSON.stringify(
              {
                version: 1,
                file,
                summary: {
                  functions: 0,
                  externalFunctions: 0,
                  cases: 0,
                  diagnostics: 0,
                },
                functions: [],
                diagnostics: [],
                assertions: { passed: 0, failed: 0, unchecked: 0 },
                pathErrors: allPathErrors.map((e) => ({
                  path: e.path,
                  code: e.code,
                  message: e.message,
                  suggestion: e.suggestion,
                })),
              },
              null,
              2,
            ),
          );
          process.exitCode = 1;
          return;
        }

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

        // env-unresolved 告警去重表：单次批跑共享（同 baseDir 多文件只报
        // 一次）；watch 每轮开跑前清空（console.clear 后告警需重印）
        const envErrorSeen = new Set<string>();
        const runOne = async (t: string): Promise<void> => {
          await runTest(t, {
            ...(externalRecords ? { from: externalRecords } : {}),
            ...(freeze ? { freeze } : {}),
            json: opts.json,
            abs: opts.abs,
            envErrorSeen,
            ...(opts.json && allPathErrors.length > 0 ? { pathErrors: allPathErrors } : {}),
          });
        };

        if (opts.watch) {
          startWatch(paths, runOne, "test", () => envErrorSeen.clear());
          return;
        }
        for (const t of targets) await runOne(t);
      },
    );
}
