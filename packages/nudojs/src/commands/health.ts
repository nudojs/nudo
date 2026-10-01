/**
 * nudo health — 项目体检：未覆盖函数、witness drift、契约 drift、分析错误。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import type { Command } from "commander";
import { analyzeFileAsync, type CallRecord } from "@nudojs/service";
import {
  collectExternalRecords,
  collectNudoFiles,
  reemitUpdate,
  startWatch,
  displayPathOf,
  type PathError,
} from "./shared.ts";

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
  /** A2：本轮分析预算/截断（truncated=true 时签名可能已 widen） */
  budget?: {
    truncated: boolean;
    callTruncated: boolean;
    forkTruncated: boolean;
    calls: number;
    maxCalls: number;
    forks: number;
    maxForks: number;
  };
  /** D6-A：evaluator internal 回落计数（指标暴露，非 fail 条件） */
  internalFallbacks?: number;
  error?: string;
};

async function healthFile(filePath: string, records?: CallRecord[]): Promise<HealthReport> {
  const report: HealthReport = { file: displayPathOf(filePath), functions: 0, entryOnly: 0, uncovered: [] };
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    report.error = (err as Error).message;
    return report;
  }
  try {
    const { getAbsCallBudgetStats, getEvalFallbackStats, resetEvalFallbackStats } = await import("@nudojs/core/internal");
    resetEvalFallbackStats();
    const result = await analyzeFileAsync(
      filePath,
      source,
      undefined,
      records,
      undefined,
      "none",
    );
    report.functions = result.functions.length;
    report.entryOnly = result.functions.filter((fn) => fn.entryOnly).length;
    report.uncovered = result.functions
      .filter((fn) => fn.cases.length === 0 && !fn.skipped && !fn.entryOnly)
      .map((fn) => fn.name);
    {
      const b = getAbsCallBudgetStats();
      report.budget = {
        truncated: b.truncated,
        callTruncated: b.callTruncated,
        forkTruncated: b.forkTruncated,
        calls: b.calls,
        maxCalls: b.maxCalls,
        forks: b.forks,
        maxForks: b.maxForks,
      };
    }
    {
      // D6-A：internal 回落是缺陷指标（接受暴露），不吞、不单独 fail
      report.internalFallbacks = getEvalFallbackStats().internal;
    }
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
    const { collectSkipReturns, findProjectConfig, interfaceConfig } = await import(
      "@nudojs/service"
    );
    const proj = findProjectConfig(dirname(abs));
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const source = rf(abs, "utf-8");
    const r = checkSource(abs, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: abs,
      ...(autoBind === false ? { autoBind: false } : {}),
      // 与 nudo check 同源：@nudo:skip 的函数不评估 body，不产出 drift 候选
      skips: collectSkipReturns(source),
    });
    return { count: r.issues.filter((i) => i.code === "nudo:interface-drift").length };
  } catch (e) {
    return { count: 0, error: `checkSource failed: ${(e as Error).message}` };
  }
}

async function runHealth(paths: string[], opts: { from?: string[]; json?: boolean }): Promise<void> {
  const targetPaths = paths.length > 0 ? paths : ["."];
  // --from 路径错误进 sink（不直接设 exit），ok↔exit 单一来源；check/test 同规。
  const fromErrors: PathError[] = [];
  const externalRecords = opts.from?.length
    ? collectExternalRecords(opts.from, fromErrors)
    : undefined;

  const files: string[] = [];
  const reports: HealthReport[] = [];
  for (const p of targetPaths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      reports.push({ file: displayPathOf(abs), functions: 0, entryOnly: 0, uncovered: [], error: `File not found: ${displayPathOf(abs)}` });
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
  // ok↔exit 单一来源：pathErrors 非空 ⇒ ok:false（绝不 ok:true + 非零 exit）
  const ok = !failed && fromErrors.length === 0;
  // exit 只由 ok 决定（单一来源）；--json / 非 JSON 共用
  process.exitCode = ok ? 0 : 1;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok,
          ...(fromErrors.length > 0
            ? {
                pathErrors: fromErrors.map((e) => ({
                  path: e.path,
                  code: e.code,
                  message: e.message,
                  suggestion: e.suggestion,
                })),
              }
            : {}),
          files: reports.map((r) => ({
            file: r.file,
            functions: r.functions,
            entryOnly: r.entryOnly,
            uncovered: r.uncovered,
            ...(r.drift ? { drift: r.drift } : {}),
            ...(r.interfaceDrift ? { interfaceDrift: r.interfaceDrift } : {}),
            ...(r.internalFallbacks !== undefined ? { internal_fallbacks: r.internalFallbacks } : {}),
            ...(r.error ? { error: r.error } : {}),
          })),
          summary: {
            files: reports.length,
            drift: driftCount,
            interfaceDrift: ifaceDriftCount,
            errors: errorCount + fromErrors.length,
            uncovered: uncoveredTotal,
            internal_fallbacks: reports.reduce((n, r) => n + (r.internalFallbacks ?? 0), 0),
          },
        },
        null,
        2,
      ),
    );
  } else {
    // --from 路径错误上屏（usage face，与 check/test 一致）；ok:false 已在上方挡 exit
    for (const e of fromErrors) {
      console.error(e.message);
      console.error(`fix:  ${e.suggestion}`);
    }
    if (reports.length === 0) {
      if (fromErrors.length > 0) {
        console.log("Result: FAIL (path errors found)");
      } else {
        console.log("No files to check.");
      }
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
      if (r.budget?.truncated) {
        console.log(
          `  ⚠ budget truncated  calls ${r.budget.calls}/${r.budget.maxCalls} · forks ${r.budget.forks}/${r.budget.maxForks}` +
            `${r.budget.callTruncated ? "  (calls)" : ""}${r.budget.forkTruncated ? "  (forks)" : ""} — some results widened to unknown`,
        );
      }
      if ((r.internalFallbacks ?? 0) > 0) {
        // D6-A：internal 回落=引擎缺陷指标（接受暴露，不静默）
        console.log(`  ⚠ internal_fallbacks: ${r.internalFallbacks}`);
      }
    }
    const internalTotal = reports.reduce((n, r) => n + (r.internalFallbacks ?? 0), 0);
    console.log(
      `\nSummary: ${reports.length} file(s) · ${driftCount} case drift · ${ifaceDriftCount} contract drift · ${errorCount} error(s) · ${uncoveredTotal} uncovered function(s)` +
        (internalTotal > 0 ? ` · ${internalTotal} internal_fallback(s)` : ""),
    );
    // ok↔exit 单一来源：pathErrors / drift / errors 任一存在都不得报 OK
    console.log(
      ok
        ? "Result: OK (uncovered function(s) are informational only)"
        : fromErrors.length > 0 && !failed
          ? "Result: FAIL (path errors found)"
          : "Result: FAIL (drift or errors found)",
    );
  }
}

export function registerHealthCommand(program: Command): void {
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
}
