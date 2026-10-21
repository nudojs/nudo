/**
 * nudo check 的 commander 装配层（自 commands/check.ts 拆出，纯搬移零行为变化）：
 * 旗标定义、组合旗标 usage error、--what-if、路径/外部记录解析、
 * --json/--gitlab 聚合、--watch、批次探针创建与 #9 缓存提示。
 * 编排（loadCache / buildInjection / runCheck / runCheckFix）仍在 check.ts，
 * 渲染面在 check-report.ts；#11 帮助分组在 check-help-groups.ts。
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  formatAbs,
  serializeCheckJsonMulti,
  type CheckJson,
  type GitlabCodeQualityIssue,
} from "@nudojs/core";
import { analyzeFile, defaultLoadModule, injectBindings, type CallRecord } from "@nudojs/service";
import {
  isEntryThrowsMode,
  isGateProfile,
  parseIgnoreThrows,
  parseWhatIfBindings,
  validateGateFlags,
  type EntryThrowsMode,
  type GateProfile,
} from "../check-gate-config.ts";
import { attachPathErrors } from "../check-json-map.ts";
import {
  collectExternalRecords,
  reportPathErrors,
  resolveTargets,
  resolveTargetsCollect,
  startWatch,
  variadicSwallowError,
  type PathError,
} from "./shared.ts";
import {
  CACHE_HINT,
  freshBatchProbe,
  runCheck,
  runCheckFix,
  type GateFlagsChannel,
  type RunCheckOptions,
} from "./check.ts";

/** `nudo check --watch` 的编排参数（watch 分支专用） */
export type CheckWatchOptions = {
  /** --from 使用点路径：**每轮重采**调用点证据（928） */
  from?: string[];
  /** 人类面（每轮独立探针；机器面无探针） */
  humanMode: boolean;
  /** 与非 watch 面共用的门禁/观察选项 */
  shared: RunCheckOptions;
};

/**
 * `nudo check --watch` 的编排（928）。
 *
 * **--from 的调用点证据每轮重采**，不是启动快照：旧实现只在进程启动时采一次
 * ⇒ 之后每轮都拿陈旧的调用点事实 ⇒ 同一轮里两个文件对同一次调用给出相反
 * 裁决（被依赖方看新值、依赖方看旧值），且与同一磁盘状态下的**全新**非
 * watch 运行结论相反。口径同 `nudo health`（health 的 --from 记录写在
 * runHealth 内部，每轮重收）。
 *
 * 证据缺失（--from 文件这一轮读不到 / 解析失败）必须进入**本轮**门禁（红）：
 * 否则「陈旧」会退化成「缺失也不报」。路径错误每轮报一次（stderr），
 * exit 由 runner 在本轮文件处理完后落（startWatch 的轮首复位会吃掉更早的
 * exit 写入）。
 *
 * 返回 startWatch 的关闭句柄（确定性清理；测试与宿主都能停）。
 */
export function startCheckWatch(
  paths: string[],
  opts: CheckWatchOptions,
): () => void {
  let roundFrom: CallRecord[] | undefined;
  let roundFromErrors: PathError[] = [];
  return startWatch(
    paths,
    async (t: string) => {
      await runCheck(t, {
        ...opts.shared,
        from: roundFrom,
        ...(opts.humanMode
          ? { batchProbe: freshBatchProbe(), onboardingFinal: true }
          : {}),
      });
      // 本轮证据缺失 ⇒ 本轮红（runCheck 之后落，runCheck 的 exit 写入不覆盖它）
      if (roundFromErrors.length > 0) process.exitCode = 1;
    },
    "check",
    () => {
      // 每轮开跑前重采调用点证据（onRoundStart 在 startWatch 的轮首 exit 复位
      // 之前跑 ⇒ 这里的 exit 写入会被复位吃掉，故 exit 只在 runner 里落）
      roundFromErrors = [];
      roundFrom = opts.from?.length
        ? collectExternalRecords(opts.from, roundFromErrors)
        : undefined;
      if (roundFromErrors.length > 0) reportPathErrors(roundFromErrors);
    },
  );
}

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Gate contracts + entry throws; print signatures (CI). Day 0 observation lives here.")
    .argument("[paths...]", "File(s) or directory(s) to check")
    .option("--watch, -w", "Watch files and re-run check on change")
    .option("--json", "Emit stable CheckJson (1 file) or CheckJsonMulti envelope (N files) for CI / Agent")
    .option(
      "--quiet",
      "Suppress the signature table (issues + summary + gate exit unchanged); clean run prints one summary line",
    )
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
          quiet?: boolean;
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
        // watch 模式不在启动时采 --from（928）：启动快照会被后续每轮沿用 ⇒
        // 被依赖方拿陈旧输入（同一轮两个文件对同一次调用给出相反裁决）。
        // watch 分支每轮重采（startCheckWatch）。
        const externalRecords =
          opts.from?.length && !opts.watch
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
          quiet?: boolean;
        } = {
          from: externalRecords,
          verbose: opts.verbose,
          gha: opts.gha,
          gitlab: opts.gitlab,
          ...(opts.quiet ? { quiet: true } : {}),
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
          if (targets.length === 0 && allPathErrors.length === 0) {
            // 0 targets 且无路径错误：paths 必有值，每个路径要么出目标要么出错误
            process.exitCode = 0;
            return;
          }
          // 统一 collect：单文件无路径/语法错时与原直连面逐字节一致地打单
          // CheckJson；语法错文件（runCheck 提前 return、无 reports 条目）
          // 经 gateFlags.syntaxPathErrors 与路径错误同信封字段并入 → ok:false
          const collected: CheckJson[] = [];
          // 注入装配失败跨文件聚合（单文件 ok:true 的降级分析 + 失败态
          // 必须让信封 exit 红，不能被 envelope.ok 覆盖成假绿）
          const gateFlags: GateFlagsChannel = {};
          for (const t of targets) {
            await runCheck(t, { ...shared, json: true, jsonCollect: collected, gateFlags });
          }
          const syntaxErrors = gateFlags.syntaxPathErrors ?? [];
          if (targets.length > 1 || allPathErrors.length > 0 || syntaxErrors.length > 0) {
            const envelope = attachPathErrors(serializeCheckJsonMulti(collected), [
              ...allPathErrors,
              ...syntaxErrors,
            ]);
            console.log(JSON.stringify(envelope, null, 2));
            process.exitCode = envelope.ok && !gateFlags.injectionSetupFailed ? 0 : 1;
            return;
          }
          const single = collected[0];
          if (!single) {
            process.exitCode = 1;
            return;
          }
          console.log(JSON.stringify(single, null, 2));
          // exit 与打印出的 ok 同源；注入装配失败独立于 ok 挡红
          process.exitCode = single.ok && !gateFlags.injectionSetupFailed ? 0 : 1;
          return;
        }

        // #1/#9 人类面批次探针：--json / --gitlab / --gha / --fix 不参与
        //（机器契约面 stdout 与 stderr 都必须干净；--fix 在上方已早退）
        const humanMode = !opts.json && !opts.gitlab && !opts.gha;
        // #9 批量指纹：多路径，或任一路径是目录
        const multiPath =
          paths.length > 1 ||
          paths.some((p) => {
            try {
              return statSync(resolve(p)).isDirectory();
            } catch {
              return false;
            }
          });
        // #1：批次探针——末目标的 issues 段后、docs 段前打 onboarding 块
        const probe = humanMode ? freshBatchProbe() : undefined;
        const lastTarget = targets[targets.length - 1];

        const runOne = async (t: string): Promise<void> => {
          // --abs 仍走 runCheck：代数观察 + L1/L2 门禁（design §1.3）
          await runCheck(t, {
            ...shared,
            json: opts.json,
            ...(probe ? { batchProbe: probe, onboardingFinal: t === lastTarget } : {}),
          });
        };

        if (opts.watch) {
          // watch 每轮独立探针（单文件轮即终轮）——指纹不跨轮残留
          // --from 调用点证据每轮重采（928，见 startCheckWatch）
          startCheckWatch(paths, { from: opts.from, humanMode, shared });
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
        // #9 缓存 opt-in：批量（多路径/目录）check 跑完且磁盘缓存未启用 →
        // stderr 一行提示（人类面；--json/--gitlab/--gha 面不创建探针，天然不打）
        if (probe && multiPath && !probe.cacheEnabled) {
          console.error(CACHE_HINT);
        }
      },
    );
}
