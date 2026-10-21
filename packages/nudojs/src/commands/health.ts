/**
 * nudo health — 项目体检：未覆盖函数、witness drift、契约 drift、分析错误。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, statSync, type Stats } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import type { Command } from "commander";
import { analyzeFileAsync, type CallRecord } from "@nudojs/service";
import { paintOne } from "../ui.ts";
import { projectConfigShapeIssue } from "../config-shape.ts";
import { budgetAttributionSegs, DIAG, type AbsBudgetStats } from "@nudojs/core/internal";
import {
  collectExternalRecords,
  collectNudoFiles,
  reemitUpdate,
  startWatch,
  displayPathOf,
  variadicSwallowError,
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
  /** A2：本轮分析预算/截断（truncated=true 时签名可能已 widen）。
   *  快照类型 = core AbsBudgetStats（与 nudo check --json 的 budget 同源同义） */
  budget?: AbsBudgetStats;
  /** D6-A：evaluator internal 回落计数（指标暴露，非 fail 条件） */
  internalFallbacks?: number;
  /**
   * package.json#nudo 键形状问题（468/936）：`nudo` 键存在但值不是对象 /
   * 是假值 ⇒ 本包按「无 nudo 配置」处理（不继承祖先配置）。**报告面可见**
   * ——不能只靠 stderr 一行（用户不知道自己写错了）。
   */
  configShape?: { pkgPath: string; message: string };
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
    const {
      getAbsCallBudgetStats,
      getEvalFallbackStats,
      resetEvalFallbackStats,
      resetAbsCallBudget,
    } = await import("@nudojs/core/internal");
    resetEvalFallbackStats();
    // 预算快照按文件隔离（与 checkSource 入口 resetAbsCallBudget 同源同义）：
    // 不重置则上一文件（或同进程早先分析）的截断旗标/计数会 latch 进本文件
    // 报告——未截断文件被误标 truncated、counters 与触发预算对不上。
    resetAbsCallBudget();
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
      report.budget = { ...b };
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
  // 配置形状（468/936）：与分析成败无关——配置写坏了也要看得见。
  const shape = projectConfigShapeIssue(dirname(filePath));
  if (shape) {
    report.configShape = { pkgPath: shape.pkgPath, message: shape.message };
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
    return { count: r.issues.filter((i) => i.code === DIAG.interfaceDrift).length };
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
    // 单次 stat：miss（ENOENT）→ File not found 报告；
    // EACCES/EIO 等 → error 报告通道（不伪装成 miss）
    let st: Stats | undefined;
    try {
      st = statSync(abs, { throwIfNoEntry: false });
    } catch (err) {
      reports.push({ file: displayPathOf(abs), functions: 0, entryOnly: 0, uncovered: [], error: `Cannot access ${displayPathOf(abs)}: ${(err as Error).message}` });
      continue;
    }
    if (!st) {
      reports.push({ file: displayPathOf(abs), functions: 0, entryOnly: 0, uncovered: [], error: `File not found: ${displayPathOf(abs)}` });
      continue;
    }
    files.push(...(st.isDirectory() ? collectNudoFiles(abs) : [abs]));
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
            ...(r.configShape ? { configShape: r.configShape } : {}),
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
        console.log(paintOne(`  ✗ error: ${r.error}`));
        continue;
      }
      const entryInfo = r.entryOnly > 0 ? `, ${r.entryOnly} entry-only` : "";
      console.log(`  · ${r.functions} function(s)${entryInfo}`);
      if (r.configShape) {
        // 配置形状问题（468/936）——报告面可见：配置写坏了（`"nudo": true`
        // / 假值键）本包按「无 nudo 配置」处理（不继承祖先配置），用户必须
        // 知道，否则会以为祖先配置生效了。
        console.log(paintOne(`  ⚠ config: ${r.configShape.message}`));
      }
      if (r.uncovered.length > 0) {
        console.log(paintOne(`  ⚠ uncovered (no call-site evidence): ${r.uncovered.join(", ")}`));
      }
      if (r.drift) {
        const refresh = `nudo test ${r.file} --from ${(opts.from ?? []).join(" ")} --freeze=update`;
        console.log(
          paintOne(
            `  ✗ drift: ${r.drift.added + r.drift.removed} witness directive(s) changed (+${r.drift.added} new, -${r.drift.removed} removed) — refresh: ${refresh.trim()}`,
          ),
        );
      }
      if ((r.interfaceDrift ?? 0) > 0) {
        console.log(
          paintOne(
            `  ✗ contract drift: ${r.interfaceDrift} @generated slot(s) ≠ today's recompute — refresh with: nudo contract --emit ${r.file} --fn <name>`,
          ),
        );
      }
      if (r.budget?.truncated) {
        const b = r.budget;
        const onlyLoop =
          b.loopTruncated &&
          b.callReasons.length === 0 &&
          b.evalReasons.length === 0 &&
          !b.forkTruncated;
        // 归因段与 nudo check 同一实现（budgetAttributionSegs，
        // #health-budget）：只打触发截断的那条预算自己的计数段；空段 ⇔ 纯
        // cycle 触发，由共享构建器兜底（cycleOnly）
        const { segs, cycleOnly } = budgetAttributionSegs(b);
        console.log(
          paintOne(
            `  ⚠ budget truncated  ${segs.join(" · ")}` +
              (onlyLoop
                ? " — loop state widened (iteration budget; @nudo:budget does not apply)"
                : " — some results widened to unknown") +
              (b.cycleTruncated && !cycleOnly
                ? ` (includes call cycles — a budget cannot lift them)`
                : ""),
          ),
        );
      }
      if ((r.internalFallbacks ?? 0) > 0) {
        // D6-A：internal 回落=引擎缺陷指标（接受暴露，不静默）
        console.log(paintOne(`  ⚠ internal_fallbacks: ${r.internalFallbacks}`));
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
    .argument("[paths...]", "File(s) or directory(s) (default: current directory; with --from, pass paths explicitly — e.g. `nudo health . --from usage.js`)")
    .option("--watch, -w", "Watch and re-run health on change")
    .option("--from <paths...>", "Usage-site files for freeze-drift detection")
    .option("--json", "Output as JSON")
    .action(async (paths: string[], opts: { watch?: boolean; from?: string[]; json?: boolean }) => {
      // BUG-024：--from variadic 吞噬其后的位置参数。
      // G6 修正（BUG-024 后续，P3）：
      // - from 收到 ≥2 个值：其后裸 token 与「多 from 文件」不可区分
      //   （真歧义，无论 paths 是否已给出——extra.js 被静默当 from 文件
      //   是范围错误），保持 BUG-024 定向错误。
      // - from 只收到自身的一个值且 paths 为空：没有任何参数被吞
      //   （不得声称 consumed）；但 --from 下静默默认扫 cwd 会把
      //   freeze-drift 检测范围扩到整个 cwd——定向 usage error，文案如实。
      if (opts.from?.length) {
        if (opts.from.length > 1) {
          variadicSwallowError("health", ["--from"]);
          return;
        }
        if (paths.length === 0) {
          console.error(
            "error: `nudo health` --from requires explicit paths when used without positional paths " +
              "(previously defaulted to cwd scan)",
          );
          console.error("fix:  use: `nudo health . --from usage.js`");
          process.exitCode = 1;
          return;
        }
      }
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
