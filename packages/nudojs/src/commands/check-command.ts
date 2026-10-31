/**
 * nudo check 的 commander 装配层（自 commands/check.ts 拆出，纯搬移零行为变化）：
 * 旗标定义、组合旗标 usage error、--what-if、路径/外部记录解析、
 * --json/--gitlab 聚合、--watch、批次探针创建与 #9 缓存提示。
 * 编排（loadCache / buildInjection / runCheck / runCheckFix）仍在 check.ts，
 * 渲染面在 check-report.ts；#11 帮助分组在 check-help-groups.ts。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  formatAbs,
  serializeCheckJsonMulti,
  type Abs,
  type CheckJson,
  type GitlabCodeQualityIssue,
} from "@nudojs/core";
import {
  analyzeFile,
  defaultLoadModule,
  injectBindings,
  type AnalysisResult,
  type CallRecord,
} from "@nudojs/service";
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
import { DIAG } from "@nudojs/core/internal";
import { shouldEmitGha } from "../check-ci-flags.ts";
import {
  attachTargetErrors,
  collectExternalRecords,
  emitJsonDoc,
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
import {
  ciAnnotationsForHardErrors,
  ciRowsForHardErrors,
  emitHardErrorCiAnnotations,
} from "./check-report.ts";

/** 诊断码注册表全量（`--only` 的取值校验用；BUG-048） */
const KNOWN_DIAG_CODES: ReadonlySet<string> = new Set(Object.values(DIAG));

/** CI 注解面的工作区根（与 check-report.ts 同口径） */
function workspaceRootOf(): string {
  return process.env.GITHUB_WORKSPACE ?? process.cwd();
}

/** 该取值在磁盘上是否真的是一个路径（被 variadic 旗标吞掉的位置参数） */
function isExistingPath(v: string): boolean {
  try {
    return existsSync(resolve(v));
  } catch {
    return false;
  }
}

/**
 * BUG-046：variadic 旗标（`--only` / `--assume` / `--what-if`）把**后面的
 * 位置参数**吞进自己的取值数组——旧守卫只在「paths 全被吞空」
 * （`paths.length === 0`）时触发 ⇒ **部分吞**的情况静默丢文件：被吞的文件
 * 从未进入分析、退出码仍是 0（CI 假绿）。
 *
 * 判定不重解析 argv：commander 已把被吞的位置参数塞进该旗标的取值数组，
 * 这里按「该旗标**不接受**的取值形态 + 该值在磁盘上确实是一个路径」识别。
 * （`--from` 的取值本来就是路径 ⇒ 单看取值无法区分，故不参与本判定。）
 */
function swallowedPositionals(opts: {
  only?: string[];
  assume?: string[];
  whatIf?: string[];
}): Array<{ flag: string; values: string[] }> {
  const groups: Array<{
    flag: string;
    values: string[];
    accepts: (v: string) => boolean;
  }> = [
    {
      flag: "--only",
      values: opts.only ?? [],
      // 诊断码（`nudo:*` / 注册表里的码）——路径不会是合法码
      accepts: (v) => KNOWN_DIAG_CODES.has(v),
    },
    {
      flag: "--assume",
      values: opts.assume ?? [],
      // 谓词（`x>0` / `x >= 1`）必须带关系运算符
      accepts: (v) => /[<>=!]/.test(v),
    },
    {
      flag: "--what-if",
      values: opts.whatIf ?? [],
      // `name:type` 绑定
      accepts: (v) => /^[^:\s]+:\S/.test(v),
    },
  ];
  const out: Array<{ flag: string; values: string[] }> = [];
  for (const g of groups) {
    const swallowed = g.values.filter((v) => !g.accepts(v) && isExistingPath(v));
    if (swallowed.length > 0) out.push({ flag: g.flag, values: swallowed });
  }
  return out;
}

/**
 * BUG-115：`--json` 信封**新增**不含歧义的 `summary.pathErrors`（路径错误 /
 * 文件级硬错误条数）。
 *
 * `summary.errors` 保持 695 口径（= Σ`reports[].summary.errors`，**不含**
 * 路径错误——路径错误不是分析诊断），而设计文档写的是「并计入
 * `summary.errors`」⇒ 只读 `summary.errors` 的机器消费方会把「路径失败」
 * 读成「0 错」。给出条数后两个口径都能读出来。仅在非空时加字段 ⇒ 绿运行
 * 的 JSON 逐字节不变。
 */
function withPathErrorCount<T extends object>(envelope: T, count: number): T {
  if (count === 0) return envelope;
  const summary = (envelope as { summary?: Record<string, unknown> }).summary;
  if (summary === undefined) return envelope;
  return { ...envelope, summary: { ...summary, pathErrors: count } } as T;
}

/** `nudo check --watch` 的编排参数（watch 分支专用） */
export type CheckWatchOptions = {
  /** --from 使用点路径：**每轮重采**调用点证据（928） */
  from?: string[];
  /** 人类面（每轮独立探针；机器面无探针） */
  humanMode: boolean;
  /** 与非 watch 面共用的门禁/观察选项 */
  shared: RunCheckOptions;
  /**
   * `--json` watch 面（Bug 645）：每轮**每文件**吐一份机器可读文档
   * （单文件 = 裸 CheckJson；有语法错 = 带 pathErrors 的 CheckJsonMulti 信封）。
   * 旧实现里 `--json` 分支在 watch 安装之前就 return ⇒ `--watch` 被**静默丢弃**
   * （进程跑完 JSON 即退出，监听从未启动）。
   */
  jsonFace?: boolean;
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
      // `--json` watch 面（Bug 645）：每轮仍吐机器可读文档（见 runCheckJsonFace）
      if (opts.jsonFace) {
        await runCheckJsonFace(t, { ...opts.shared, from: roundFrom });
        return;
      }
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

/**
 * watch 面的 `--json` 文档（Bug 645）。
 *
 * watch 面**没有**信封（每轮的文件集合随磁盘变），所以每处理一个文件就落一份
 * 机器可读文档：
 * - 正常文件 ⇒ 裸 CheckJson（与非 watch 面的**单文件**契约同形）
 * - 语法错等「runCheck 提前 return、没有 report 条目」⇒ 带 pathErrors 的
 *   CheckJsonMulti 信封（与非 watch 面同形）⇒ **stdout 永不为空**
 *
 * exit 只由**打印出去的那份文档**的 ok 决定（与 watch 的「最近一轮门禁状态」
 * 语义一致：startWatch 的轮首复位会吃掉更早的 exit 写入）。
 *
 * 63：落盘形态 = **JSON Lines**（**一行**一份完整 JSON 文档）——watch 的
 * stdout 是**流**（第 2 轮起会累积第 2 份文档 ⇒ 整份 `JSON.parse(stdout)`
 * 抛 "Unexpected non-whitespace character after JSON"）。逐行落盘后机器
 * 消费者可**逐行** `JSON.parse`。本函数**只**被 watch 面调用 ⇒ 非 watch
 * 面的 pretty 文档形态不受影响。
 */
async function runCheckJsonFace(
  file: string,
  opts: RunCheckOptions,
): Promise<void> {
  const collected: CheckJson[] = [];
  const gateFlags: GateFlagsChannel = {};
  await runCheck(file, {
    ...opts,
    json: true,
    jsonCollect: collected,
    gateFlags,
  });
  const syntaxErrors = gateFlags.syntaxPathErrors ?? [];
  const injectionFailed = gateFlags.injectionSetupFailed === true;
  if (collected.length === 0 || syntaxErrors.length > 0) {
    const envelope = withPathErrorCount(
      attachPathErrors(serializeCheckJsonMulti(collected), syntaxErrors),
      syntaxErrors.length,
    );
    emitJsonDoc(envelope, true);
    process.exitCode = envelope.ok && !injectionFailed ? 0 : 1;
    return;
  }
  const single = collected[0];
  if (!single) {
    process.exitCode = 1;
    return;
  }
  emitJsonDoc(single, true);
  process.exitCode = single.ok && !injectionFailed ? 0 : 1;
}

/** 用法错误的机器面码（`--json` 信封的 pathErrors[]）。 */
const USAGE_ERROR_CODE = "nudo:usage-error";

/**
 * 用法错误出口（Bug 954）。
 *
 * - 人类面：stderr 文案（`extra.human`，缺省 = `message`）+ exit 1（历史行为不变）
 * - `--json` 机器面：stdout 输出 CheckJsonMulti 信封（ok:false + pathErrors[]），
 *   exit **只**由信封的 ok 决定 ⇒ 绝不出现「空 stdout + 非零 exit」
 *   （docs/design/cli-semantics.md §6.1）。
 *
 * 用法错误没有「路径」⇒ pathErrors[0].path 为空串，事实全在 message/suggestion。
 */
function usageErrorExit(
  json: boolean | undefined,
  message: string,
  extra?: { human?: string; suggestion?: string },
): void {
  if (!json) {
    console.error(extra?.human ?? message);
    process.exitCode = 1;
    return;
  }
  const envelope = withPathErrorCount(
    attachPathErrors(serializeCheckJsonMulti([]), [
      {
        path: "",
        code: USAGE_ERROR_CODE,
        message,
        ...(extra?.suggestion ? { suggestion: extra.suggestion } : {}),
      },
    ]),
    1,
  );
  console.log(JSON.stringify(envelope, null, 2));
  process.exitCode = envelope.ok ? 0 : 1;
}

/**
 * Bug 405：`--target` 指向的名字 ⇒ 类型串（`--what-if` 早退分支专用）。
 *
 * 顶层绑定 Abs 的 fn 形状**没有 returnType**（只有 `{ k: "fn", params: [...] }`）
 * ⇒ `formatAbs` 打出 `() => ?`——`?` 既不是合法 TS 类型也不是 Nudo 的类型
 * 记号（坏渲染 / 误导输出）。同一函数的**签名表**走的是另一条面
 * （`result.functions` / `combinedAbs`）⇒ 同一个函数在签名表里是
 * `useRaw() => 3`、在 `--target` 里却是 `() => ?`（两条面互相矛盾）。
 *
 * 修法（路线 ①）：命中**函数名** ⇒ 从 `result.functions` 取该函数的
 * `combinedAbs`（真实返回域）补进绑定 fn 形状缺失的 returnType 再渲染；
 * 取不到（非函数 / 无 combinedAbs）才回落到 `result.bindings`。
 *
 * 返回槽**不带 term**：term 是引擎内部抽象变量名（`len#N`）⇒ 不进用户面
 * 文本（签名表口径：`formatShape` 不带 `= term`）。
 */
function whatIfTargetType(result: AnalysisResult, name: string): string {
  const returnAbs = result.functions.find((f) => f.name === name)?.combinedAbs;
  const bindingAbs = result.bindings.get(name)?.abs;
  if (returnAbs && bindingAbs && bindingAbs.shape.k === "fn") {
    const returnSlot: Abs = {
      shape: returnAbs.shape,
      ...(returnAbs.pred !== undefined ? { pred: returnAbs.pred } : {}),
      conf: returnAbs.conf,
    };
    return formatAbs({
      ...bindingAbs,
      shape: { ...bindingAbs.shape, returnType: returnSlot },
    });
  }
  if (bindingAbs) return formatAbs(bindingAbs);
  if (returnAbs) return formatAbs(returnAbs);
  return "unknown";
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
            // 人类面：shared.ts 的 variadicSwallowError（两行文案 + exit 1）
            // 机器面（--json）：同一事实进信封 pathErrors[]（Bug 954）——
            // 旧实现只有 stderr 文案 ⇒ stdout 空 + exit 1（机器面 JSON.parse 炸）。
            if (opts.json) {
              usageErrorExit(
                true,
                `error: \`nudo check\` received no paths — variadic flag(s) ${swallowed.join(", ")} consumed the following arguments`,
                {
                  suggestion:
                    "separate variadic flags from paths with `--` (e.g. `nudo check --from a.js -- b.js`) or list paths before the flags",
                },
              );
              return;
            }
            variadicSwallowError("check", swallowed);
            return;
          }
          usageErrorExit(
            opts.json,
            "Usage error: `nudo check` needs at least one path.",
          );
          return;
        }
        // BUG-046：variadic 旗标**部分吞掉**后面的路径（paths 已非空时上面
        // 的守卫不触发）⇒ 被吞的文件从未进入分析 ⇒ exit 0 **假绿**。
        // 只要某 variadic 旗标的取值里出现了「该旗标不接受 + 磁盘上确实是
        // 一个路径」的项，就报同款定向 usage error。
        const partialSwallow = swallowedPositionals(opts);
        if (partialSwallow.length > 0) {
          const flags = partialSwallow.map((g) => g.flag);
          const files = partialSwallow.flatMap((g) => g.values);
          usageErrorExit(
            opts.json,
            `error: \`nudo check\` — variadic flag(s) ${flags.join(", ")} consumed the following path(s): ${files.join(", ")} (they would never be checked)`,
            {
              suggestion:
                "separate variadic flags from paths with `--` (e.g. `nudo check --only nudo:entry-may-throw -- a.js b.js`) or list paths before the flags",
            },
          );
          return;
        }
        // BUG-048：`--only` 的取值必须落在诊断码注册表（DIAG）内——旧实现里
        // 拼错的码与「这些诊断确实没有可自动应用的修复」输出完全一样
        // （静默 no-op：用户无从判断自己是不是拼错了）。
        if (opts.only && opts.only.length > 0) {
          const unknown = opts.only.filter((c) => !KNOWN_DIAG_CODES.has(c));
          if (unknown.length > 0) {
            usageErrorExit(
              opts.json,
              `error: --only got unknown diagnostic code(s): ${unknown.join(", ")}`,
              {
                suggestion:
                  "run `nudo check` without --fix: its issues list prints the diagnostic codes this file reports (e.g. nudo:entry-may-throw)",
              },
            );
            return;
          }
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
          usageErrorExit(
            opts.json,
            "error: --fix cannot be combined with --json/--abs/--gha/--gitlab/--watch/--verbose/--from/--what-if (materialization face; the CI gate is plain `nudo check`)",
          );
          return;
        }
        // AI3：what-if 与门禁分离——只回答「假设下 target 是什么」
        if (opts.whatIf && opts.whatIf.length > 0) {
          // Bug 644：what-if 是**早退**分支 ⇒ 机器/观察旗标（--json/--abs/
          // --gha/--gitlab/--from/--watch/--verbose）此前被**静默丢弃**
          // （stdout 是人读文本、exit 0 ⇒ 机器面 JSON.parse 直接炸；
          //  且用户以为 --json 生效了）。组合表显式拒绝（与 --fix 的拒绝表同款纪律）。
          const machineFlags = [
            ...(opts.json ? ["--json"] : []),
            ...(opts.abs ? ["--abs"] : []),
            ...(opts.gha ? ["--gha"] : []),
            ...(opts.gitlab ? ["--gitlab"] : []),
            ...(opts.from?.length ? ["--from"] : []),
            ...(opts.watch ? ["--watch"] : []),
            ...(opts.verbose ? ["--verbose"] : []),
          ];
          if (machineFlags.length > 0) {
            usageErrorExit(
              opts.json,
              `error: --what-if cannot be combined with ${machineFlags.join("/")} (what-if answers one question; the machine / observation faces are not applied)`,
            );
            return;
          }
          const targets: string[] = [];
          for (const p of paths) targets.push(...resolveTargets(p));
          // Bug 644：多文件**静默塌缩**成第 1 个（此前 b.js 从未被分析、
          // 也没有任何提示）⇒ 显式 usage error。
          if (targets.length > 1) {
            usageErrorExit(
              opts.json,
              `error: --what-if needs exactly one file (got ${targets.length})`,
            );
            return;
          }
          const file = targets[0];
          if (!file || !opts.target) {
            usageErrorExit(
              opts.json,
              "error: --what-if needs one file and --target <name>",
            );
            return;
          }
          const bindings = parseWhatIfBindings(opts.whatIf);
          const original = readFileSync(file, "utf-8");
          const { source, applied, unapplied } = injectBindings(original, bindings);
          const result = analyzeFile(file, source, undefined, undefined, defaultLoadModule);
          const typeStr = whatIfTargetType(result, opts.target);
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
        // 63b：**分析目标闸门**错误（路径不存在 / 空目录 / 非分析目标）——
        // **单独一摊**（`targetErrors`）：`--from` 路径错误**不**进这里
        // （它是**精确入口**，不是副本）；全集仍是 `allPathErrors`
        // （= 闸门错误 + `--from` 错误，顺序不变 ⇒ `pathErrors[]` 逐字不变）。
        const targetErrors: PathError[] = [];
        for (const p of paths) {
          const r = resolveTargetsCollect(p);
          targets.push(...r.targets);
          targetErrors.push(...r.errors);
        }
        if (opts.json && opts.abs) {
          usageErrorExit(opts.json, "error: --json cannot be combined with --abs");
          return;
        }
        // 非 --json：路径错误走 usageError+exit（历史行为）
        if (!opts.json) {
          reportPathErrors(targetErrors);
          // BUG-284：文件级硬错误（路径不存在 / 空目录 / 非目标）不得在 CI
          // 注解通道上静默。`--gitlab` 的数组由下方**恰好打印一份**（多目标
          // 聚合 / 0 目标分支）⇒ 这里只发 GHA 注解，且 stdout 被占 ⇒ stderr。
          if (opts.gitlab) {
            if (shouldEmitGha(opts.gha, process.env.GITHUB_ACTIONS)) {
              const ann = ciAnnotationsForHardErrors(targetErrors, workspaceRootOf());
              if (ann.length > 0) console.error(ann);
            }
          } else {
            emitHardErrorCiAnnotations(targetErrors, opts);
          }
          if (targets.length === 0) {
            // BUG-284：`--gitlab` 的 stdout 契约是**恰好一份** Code Quality
            // JSON 数组（哪怕是 `[]` / 只有硬错误行）——旧实现在这里直接
            // return ⇒ 0 字节 ⇒ 消费方 `JSON.parse` 抛
            // `Unexpected end of JSON input`（真实失败原因丢失）。
            if (opts.gitlab) {
              console.log(
                JSON.stringify(ciRowsForHardErrors(targetErrors, workspaceRootOf()), null, 2),
              );
            }
            return;
          }
        }
        const fromErrors: PathError[] = [];
        // watch 模式不在启动时采 --from（928）：启动快照会被后续每轮沿用 ⇒
        // 被依赖方拿陈旧输入（同一轮两个文件对同一次调用给出相反裁决）。
        // watch 分支每轮重采（startCheckWatch）。
        const externalRecords =
          opts.from?.length && !opts.watch
            ? collectExternalRecords(opts.from, opts.json ? fromErrors : undefined)
            : undefined;
        const allPathErrors = [...targetErrors, ...fromErrors];
        const ignoreThrows = parseIgnoreThrows(opts.ignoreThrows);
        const gateErr = validateGateFlags(opts);
        if (gateErr) {
          usageErrorExit(opts.json, gateErr);
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
            // Bug 629：--write 与 --dry-run 同时给出时**以 dry-run 为准**
            // （旧实现 `opts.write === true` 直接落盘 ⇒ --dry-run 被静默忽略，
            //  用户以为在演练、实际改了磁盘）。与兄弟命令同款口径：
            // `nudo contract --draft --write --dry-run` / `nudo test --freeze --dry-run`
            // 都是「只打印、不落盘」。
            write: opts.write === true && opts.dryRun !== true,
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
          /**
           * `--from` **现场文件路径**（Bug 643）：调用点义务的静态证据源。
           *
           * `from`（执行态 `CallRecord[]`）只覆盖**被执行过**的调用点 ⇒
           * 被包在函数 / 箭头 / 方法体里的调用点整条失明：现场文件零条
           * 执行态记录时 `collectExternalRecords` 直接回 `undefined` ⇒
           * 连「现场文件是哪个」都到不了 `runCheck` ⇒ 同一处静态可见的
           * 违例，`nudo check <调用方>` 报红、`nudo check <被调方> --from
           * <调用方>` 报绿（谁被检查谁决定颜色）。本字段把**路径**原样
           * 交下去 ⇒ check 面按同文件通道的判据（core 静态全树扫描）
           * 复核一遍 ⇒ 两个通道同码同判据。
           */
          fromPaths?: string[];
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
          // Bug 643：`--from` 的**路径**与执行态记录是两条通道，不可混用——
          // 这里传的是 CLI 的 `--from` 路径数组（`string[]`），
          // `externalRecords` 才是塌缩后的执行态记录。
          fromPaths: opts.from,
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
          // Bug 645：`--watch` 不再被 `--json` 的早退**静默丢弃**——旧实现
          // 在这里就 return（watch 安装在下方）⇒ 进程跑完 JSON 即退出，
          // 「Watching for changes...」永不出现、监听从未启动。
          // 现在两者**共存**：watch 每轮仍吐 JSON（每文件一份文档，
          // 口径见 runCheckJsonFace）。
          if (opts.watch) {
            if (allPathErrors.length > 0) {
              // watch 面没有信封 ⇒ 路径错误先以机器可读信封落红（不装 watch）
              const envelope = withPathErrorCount(
                attachPathErrors(serializeCheckJsonMulti([]), allPathErrors),
                allPathErrors.length,
              );
              // 63b：`pathErrors[]` 逐字不变 + **新增**可选 `targetErrors[]`
              // （分析目标闸门错误的精确子集；`--from` 路径错误不进它）。
              // Bug 1085：watch 面的 stdout 是 **JSON Lines**（每行一份完整
              // JSON 文档）⇒ 这条**早退**分支也必须落一行（改前落 pretty
              // 多行文档 ⇒ 逐行 `JSON.parse` 的消费者在第一行就炸，且
              // 同一 flag 组合的 stdout 形态随路径是否可解析而变）。
              emitJsonDoc(attachTargetErrors(envelope, targetErrors), true);
              process.exitCode = envelope.ok ? 0 : 1;
              return;
            }
            startCheckWatch(paths, {
              from: opts.from,
              humanMode: false,
              jsonFace: true,
              shared,
            });
            return;
          }
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
            const envelope = withPathErrorCount(
              attachPathErrors(serializeCheckJsonMulti(collected), [
                ...allPathErrors,
                ...syntaxErrors,
              ]),
              allPathErrors.length + syntaxErrors.length,
            );
            // 63b：`pathErrors[]` **逐字不变**（字段名 + 内容 + 顺序）——
            // 既有机器消费者零影响；**新增**可选 `targetErrors[]` = 分析目标
            // 闸门错误（路径不存在 / 空目录 / 非分析目标）的**精确**子集
            // （`--from` 路径错误**不**进它；闸门错误仍留在 `pathErrors[]` 里）。
            console.log(
              JSON.stringify(attachTargetErrors(envelope, targetErrors), null, 2),
            );
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
        if (opts.gitlab && (targets.length > 1 || targetErrors.length > 0)) {
          // BUG-284：文件级硬错误的行先入列（**同一份**数组，不另起一份）
          const rowsCollect: GitlabCodeQualityIssue[] = [
            ...ciRowsForHardErrors(targetErrors, workspaceRootOf()),
          ];
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
