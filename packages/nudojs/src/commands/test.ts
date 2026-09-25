/**
 * nudo test — 逐 case 调用点真值 + 可选断言。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { Command } from "commander";
import {
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitResult,
} from "@nudojs/service/emit";
import { analyzeFileAsync, type CallRecord } from "@nudojs/service";
import { buildTestReport, formatTestReport } from "../run-test.ts";
import {
  collectExternalRecords,
  resolveTargets,
  startWatch,
  reemitUpdate,
  runAbsView,
  type EmitCasesOptions,
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

export function registerTestCommand(program: Command): void {
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
}
