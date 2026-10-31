/**
 * nudo test — 逐 case 调用点真值 + 可选断言。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Command } from "commander";
import {
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitResult,
} from "@nudojs/service/emit";
import {
  analyzeFileAsync,
  getPathEnvLoadErrors,
  type AnalysisResult,
  type CallRecord,
} from "@nudojs/service";
import {
  setEvalFallbackCollector,
  type EvalFallback,
} from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { ENV_UNRESOLVED_CODE } from "../check-json-map.ts";
import { paint, paintOne } from "../ui.ts";
import { buildTestReport, entryContractNoteFns, formatTestReport } from "../run-test.ts";
import {
  ANALYSIS_FAILED_PREFIX,
  formatSyntaxErrorBlock,
  syntaxErrorInfo,
} from "./check-report.ts";
import {
  attachTargetErrors,
  collectExternalRecords,
  emitJsonDoc,
  pathErrorEntry,
  reportPathErrors,
  resolveTargetsCollect,
  startWatch,
  reemitUpdate,
  emitWiringOf,
  runAbsView,
  displayPathOf,
  variadicSwallowError,
  type EmitCasesOptions,
  type PathError,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// test — 逐 case 调用点真值 + 可选断言
// ---------------------------------------------------------------------------

/**
 * test 面机器面（`--json`）的失败条目（Bug 957 / 650）。
 *
 * **本地定义**：不改 `shared.ts` 的 `PathError["code"]` 联合（那是别的片的
 * 文件）⇒ 这里用**本地约定**的机器码（照抄 check 面
 * `GateFlagsChannel.syntaxPathErrors` 的范式）：
 * - `"syntax-error"`：解析/装配阶段的语法错（与 check 面同码同义）；
 * - `"nudo:usage-error"`：用法错误（旗标组合 / 缺路径）——**与 check /
 *   contract 同码**（Bug 1087：改前 test 面是 `"usage-error"` ⇒ 同一类错误
 *   在三个动词产出**不同的机器码** ⇒ 消费者要为 test 单独维护一张码表）。
 *
 * `PathError`（shared）逐字满足本形状 ⇒ 路径错误可直接并入同一信封。
 */
type TestFailure = {
  path: string;
  code: string;
  message: string;
  suggestion: string;
};

/** 用法错误的机器面码（与 `check` / `contract` 的 `nudo:usage-error` 同码）。 */
const USAGE_ERROR_CODE = "nudo:usage-error";

/** 语法错的机器面码（与 check 面 `pathErrors[{code:"syntax-error"}]` 同码）。 */
const SYNTAX_ERROR_CODE = "syntax-error";

/**
 * CaseJson 失败信封（`--json` 机器面）——**路径错误 / 用法错误 / 语法错
 * 共用这一条**（Bug 957）：形状与既有「路径错误」信封逐字同构
 * （version / file / summary / functions / diagnostics / assertions /
 * pathErrors）⇒ `--json` 下绝不出现「空 stdout + 非零 exit」。
 *
 * 63b：**新增可选** `targetErrors[]`（分析目标闸门错误的**精确**子集）——
 * `pathErrors[]` 字段名 + 内容 + 顺序**逐字不变**（既有机器消费者零影响）；
 * `--from` 路径错误**不**进 `targetErrors[]`；无闸门错误 ⇒ 该字段**不出现**。
 */
function failureEnvelope(
  file: string,
  failures: TestFailure[],
  targetErrors?: TestFailure[],
): Record<string, unknown> {
  return {
    version: 1,
    file,
    summary: { functions: 0, externalFunctions: 0, cases: 0, diagnostics: 0 },
    functions: [],
    diagnostics: [],
    assertions: { passed: 0, failed: 0, unchecked: 0 },
    pathErrors: failures.map((e) => ({
      path: e.path,
      code: e.code,
      message: e.message,
      suggestion: e.suggestion,
    })),
    // 63b：闸门错误的精确入口（`--from` 路径错误不在其中）
    ...(targetErrors && targetErrors.length > 0
      ? { targetErrors: targetErrors.map(pathErrorEntry) }
      : {}),
  };
}

/**
 * 用法错误出口（Bug 957）。
 *
 * - 人类面：stderr 一行原文（**文案不变**）+ exit 1；
 * - `--json` 机器面：stdout 输出 CaseJson 失败信封（`pathErrors[]`）+ exit 1
 *   ⇒ 用法错误与路径错误在机器面上同形（同一动词不再有两条失败通道）。
 */
function usageError(
  json: boolean | undefined,
  message: string,
  extra?: { human?: string; suggestion?: string },
): void {
  if (!json) {
    console.error(extra?.human ?? message);
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify(
      failureEnvelope("", [
        {
          path: "",
          code: USAGE_ERROR_CODE,
          message,
          suggestion: extra?.suggestion ?? "",
        },
      ]),
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

/**
 * 语法错出口（Bug 650）：人类面 tsc 风格块（path:line:col + 摘录 + `^`
 * 指位）、`--json` 面并入 `pathErrors[{code:"syntax-error"}]`。
 */
function syntaxErrorExit(
  filePath: string,
  source: string,
  syntax: { line: number; column: number; essence: string },
  json: boolean | undefined,
  jsonLines = false,
): void {
  if (json) {
    emitJsonDoc(
      failureEnvelope(filePath, [
        {
          path: filePath,
          code: SYNTAX_ERROR_CODE,
          message: `${syntax.line}:${syntax.column + 1} — syntax error: ${syntax.essence}`,
          suggestion:
            "fix the syntax error; run `nudo test` without --json for a source excerpt with a caret",
        },
      ]),
      jsonLines,
    );
  } else {
    console.error(paint(formatSyntaxErrorBlock(filePath, source, syntax)));
  }
  process.exitCode = 1;
}

/** 分析结果 / 语法错的二分返回（Bug 650：解析失败不再上浮到顶层 catch）。 */
type AnalysisOutcome =
  | { ok: true; result: AnalysisResult; evalFailures: EvalFallback[] }
  | { ok: false; syntax: { line: number; column: number; essence: string } };

/**
 * `nudo test` 的分析入口：与 check 面同款收集**引擎内部回落**（BUG-014）。
 *
 * 模块级求值失败（`internal` 回落 = 生成模块编译失败 / 求值抛内部错误）⇒
 * 该模块**全部导出丢失** ⇒ 观察面只拿到编造的 `entry@… => unknown` synthetic
 * case ⇒ 「0 passed · 0 failed · 0 unchecked」+ exit 0 ⇒ **假绿**。
 * CLI `check` / `health` 都按 Bug 1145 硬化过（「模块级求值失败必须红」），
 * `test` 漏了：从不安装 `setEvalFallbackCollector` ⇒ 内部回落**不可观测**。
 *
 * 只收 `internal`（`unsupported:*` 是能力边界、`module-throw` 是程序自身抛
 * ⇒ 收进来就是假红，与 check 同一分档）。
 *
 * collector 是**进程级单槽** ⇒ 本函数内装、`finally` 卸（否则下一文件的
 * 回落会被记到本文件名下）。
 */
async function analyzeForTest(
  filePath: string,
  source: string,
  from: CallRecord[] | undefined,
): Promise<AnalysisOutcome> {
  const evalFailures: EvalFallback[] = [];
  setEvalFallbackCollector((f: EvalFallback) => {
    if (f.reason === "internal") evalFailures.push(f);
  });
  try {
    const result = await analyzeFileAsync(filePath, source, undefined, from, undefined, "all");
    return { ok: true, result, evalFailures };
  } catch (err) {
    // 语法错 ⇒ 结构化出口（人类面块 / --json 面 pathErrors）；
    // 非语法类失败（装配失败等）**行为不变**：继续上浮到顶层 catch。
    const syntax = syntaxErrorInfo(err);
    if (!syntax) throw err;
    return { ok: false, syntax };
  } finally {
    setEvalFallbackCollector(null);
  }
}

async function runTest(
  file: string,
  opts: {
    from?: CallRecord[];
    freeze?: EmitCasesOptions;
    json?: boolean;
    abs?: boolean;
    /** --json 面：路径错误并入 CaseJson（ok↔exit 同源的 test 面） */
    pathErrors?: TestFailure[];
    /**
     * 63b：--json 面的**分析目标闸门**错误（路径不存在 / 空目录 / 非分析目标）
     * ——`pathErrors[]` 里的**精确子集**（`--from` 路径错误不在其中）。
     */
    targetErrors?: TestFailure[];
    /** env-unresolved 告警去重表（同 baseDir 多文件只报一次；批轮/watch 轮由调用方持有） */
    envErrorSeen?: Set<string>;
    /**
     * 63：**watch 面**的 `--json` 落盘形态 = **JSON Lines**（一行一份完整
     * JSON 文档；watch 的 stdout 是流，第 2 轮起会累积第 2 份文档 ⇒ 整份
     * `JSON.parse(stdout)` 会炸）。非 watch 面 = 一份 pretty 文档（逐字不变）。
     */
    jsonLines?: boolean;
  } = {},
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const analysis = await analyzeForTest(filePath, source, opts.from);
  if (!analysis.ok) {
    // Bug 650：解析失败此前直接上浮到顶层 catch ⇒ 裸 message、无文件名、
    // `--json` 面 stdout 0 字节。现在复用 check 面的语法错分支。
    syntaxErrorExit(filePath, source, analysis.syntax, opts.json, opts.jsonLines === true);
    return;
  }
  let result = analysis.result;
  // BUG-014：模块级求值失败（引擎 `internal` 回落）⇒ 与 check 面同源的
  // **error 级诊断**（同码 `nudo:internal`、同文案前缀）⇒ 观察面可见、退出码
  // 判红（不再「0 passed · 0 failed · 0 unchecked」+ exit 0 的假绿）。
  // 与 check 一致：同一原因被多个求值通道各记一条 ⇒ 文案去重，条数如实报
  // 回落**总**数。
  if (analysis.evalFailures.length > 0) {
    const detail = [...new Set(analysis.evalFailures.map((f) => f.message))].join("; ");
    result = {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        {
          range: {
            start: { line: 0, column: 0 },
            end: { line: 0, column: 0 },
          },
          severity: "error",
          code: DIAG.internal,
          message:
            `${ANALYSIS_FAILED_PREFIX} (engine internal fallback ×${analysis.evalFailures.length}): ` +
            `${filePath} — ${detail}`,
          suggestions: [
            "the module could not be evaluated (engine internal failure) — the observed cases are NOT trustworthy; fix the reported cause, or report it as an engine bug together with the tested source file",
          ],
        },
      ],
    };
  }
  /** 分析诊断里的 error 级条目（BUG-014：必须挡退出码——与 check / health 同口径） */
  const analysisErrorCount = result.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;

  let emitOut: EmitResult | undefined;
  /** BUG-119：update 链**净删除**的生成态见证（汇总必须如实报出） */
  let removedWitnesses: string[] = [];
  if (opts.freeze) {
    if (opts.freeze.mode === "update") {
      const re = await reemitUpdate(filePath, source, opts.from);
      result = re.result;
      emitOut = re.emitOut;
      removedWitnesses = re.removedWitnesses;
    } else {
      // BUG-055：写回必须用**被写方自己的有效契约**守门 ⇒ 契约定位的宿主接线
      // （侧车 / fromFile / autoBind / projectDir）与 check 面同口径。
      emitOut = insertGeneratedCaseDirectives(source, result, await emitWiringOf(filePath));
    }
  }

  if (opts.json) {
    if (opts.abs) {
      // Bug 957：用法错误在 `--json` 下也必须有机器可读产物（绝不空 stdout）。
      usageError(true, "error: --json cannot be combined with --abs", {
        suggestion: "drop one of --json / --abs (they are two different machine faces)",
      });
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
    // 63b：**新增可选** `targetErrors[]`（分析目标闸门错误的精确子集）——
    // `pathErrors[]` 逐字不变；无闸门错误 ⇒ 该字段不出现。
    const targetErrors = opts.targetErrors ?? [];
    // BUG-014：error 级分析诊断（含模块求值失败）也挡 exit —— 与 check /
    // health 的「模块级求值失败必须红」同口径；`--json` 面同时补 `ok` 与
    // error 计数（CI 消费方不必解析 diagnostics[] 才能发现失败）。
    const ok = report.failed === 0 && pathErrors.length === 0 && analysisErrorCount === 0;
    json.ok = ok;
    json.summary = {
      ...((json.summary as Record<string, unknown> | undefined) ?? {}),
      errors: analysisErrorCount,
    };
    // 63：watch 面 ⇒ **JSON Lines**（一行一份完整 JSON 文档）；非 watch
    // 面 ⇒ 一份 pretty 文档（既有形态，逐字不变）。
    emitJsonDoc(attachTargetErrors(json, targetErrors), opts.jsonLines === true);
    if (report.failed > 0 || pathErrors.length > 0 || analysisErrorCount > 0) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } else if (opts.abs) {
    // 观察面仍走 abs，但声明断言失败必须可见 + 挡 exit（design §1.3 / §0）
    const report = buildTestReport(displayPathOf(filePath), result);
    // Bug 652：`--abs` 与非 `--abs` 必须共用**同一套**「无函数」结论
    // （同一句报告 + 同一个退出码）。`runAbsView` 把「文件没有函数」当
    // **用法错误**（exit 1 + 「Function not found」）——那是 `check --abs`
    // 的既有语义（Bug 669 钉住）⇒ 这里**不调**它的空函数分支：文件无
    // 函数时直接跳过观察面，报告与退出码与非 `--abs` 面逐字一致。
    const algebra = await import("@nudojs/core");
    if (algebra.listFunctionNames(source).length > 0) {
      await runAbsView(filePath, {});
    }
    console.log("");
    console.log(paint(formatTestReport(report)));
    if (report.failed > 0 || analysisErrorCount > 0) process.exitCode = 1;
  } else {
    // 人类默认面：entry@ 回退 × 有效契约（check 同判定）加注解行；
    // --json / --abs 输出面不碰
    const report = buildTestReport(displayPathOf(filePath), result, {
      entryContractNotes: entryContractNoteFns(filePath, source, result),
    });
    console.log(paint(formatTestReport(report)));
    if (report.failed > 0 || analysisErrorCount > 0) process.exitCode = 1;
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

  // diagnostics：分析错误上屏
  //
  // BUG-014：**error 级**诊断同时挡 exit（与 check / health 的「模块级求值
  // 失败必须红」同口径）；warning 级只上屏、不影响退出码。
  //
  // Bug 919：`--abs` **不**排除诊断上屏 ⇒ 默认面 / `--json` 面 / `--abs`
  // 面**对**同一文件的**诊断条数一致**（此前 `--abs` 把整段 diagnostics 吞掉
  // ⇒ 期望写错在观察面上是「屏幕上零提示」的假绿）。
  if (!opts.json && result.diagnostics.length > 0) {
    console.log("\ndiagnostics");
    for (const d of result.diagnostics) {
      // #7 路径口径与 check 同规：cwd 内相对展示；目标在 cwd 外打绝对路径
      //（displayPathOf：relative 以 .. 开头即逃出 cwd，回落原值）
      const loc = `${displayPathOf(filePath)}:${d.range.start.line}:${d.range.start.column}`;
      console.log(paintOne(`  [${d.severity}] ${loc} ${d.message}${d.code ? ` (${d.code})` : ""}`));
    }
  }

  if (opts.freeze && emitOut) {
    const relPath = displayPathOf(filePath);
    const skippedLines = emitOut.skipped.map((s) => `  ${s.fn}: ${s.reason}${s.detail ? ` (${s.detail})` : ""}`);
    /** 删除面的单行摘要（净删除 0 条时不出现——不制造噪音） */
    const removedNote =
      removedWitnesses.length > 0 ? `, ${removedWitnesses.length} removed` : "";
    if (emitOut.source === source) {
      console.log("\nfreeze: no changes.");
      for (const line of skippedLines) console.log(line);
      return;
    }
    if (opts.freeze.dryRun) {
      console.log(`\nfreeze: would write cases → ${relPath} (dry run${removedNote})`);
      for (const w of emitOut.written) console.log(`  ${w.fn}: ${w.cases.join(", ")}`);
      for (const line of skippedLines) console.log(line);
      process.stdout.write(unifiedDiff(source, emitOut.source, relPath));
      if (opts.freeze.exitOnDiff) process.exitCode = 1;
      return;
    }
    writeFileSync(filePath, emitOut.source, "utf-8");
    const directiveCount = emitOut.written.reduce((n, w) => n + w.cases.length, 0);
    console.log(
      `\nfreeze → ${relPath} (${directiveCount} directive(s) across ${emitOut.written.length} function(s)${removedNote})`,
    );
    for (const w of emitOut.written) console.log(`  ${w.fn}: ${w.cases.join(", ")}`);
    for (const name of removedWitnesses) console.log(`  - ${name}`);
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
        // BUG-018：`--freeze` 是 CLI 上**唯一**的「可选取值」选项
        // （`.option("--freeze [mode]")`）⇒ commander 把紧跟其后的**非选项
        // 参数当成该选项的取值** ⇒ `nudo test --freeze <path>` 的路径被吞成
        // 取值 ⇒ 必然报「needs at least one path」（惯用调用形式下该功能不可达）。
        // 修法：取值**白名单**（`update` / `add`，与 --help 承诺一致）——
        // 白名单外的字符串**不是模式**，它是**路径** ⇒ 还原成路径 + 省略取值
        // （默认 add，帮助文本承诺「取值省略时默认 add」）。
        if (paths.length === 0 && typeof opts.freeze === "string") {
          const mode = opts.freeze;
          if (mode !== "update" && mode !== "add") {
            paths = [mode];
            opts.freeze = true;
          }
        }
        // BUG-024：--from variadic 吞噬其后的位置参数——
        // paths 空且 --from 非空时定向 usage error
        // （直指旗标 + `--` 终止符解法）
        if (paths.length === 0) {
          if (opts.from?.length) {
            // Bug 957：`--json` 面必须产出机器可读产物（绝不空 stdout + exit 1）
            // ⇒ 人类面沿用共享层的定向 usage error；机器面走同一条 CaseJson
            // 失败信封（事实与文案同源，只是形态分面）。
            if (opts.json) {
              usageError(
                true,
                "error: `nudo test` received no paths — variadic flag(s) --from consumed the following arguments",
                {
                  suggestion:
                    "separate variadic flags from paths with `--` (e.g. `nudo test --from a.js -- b.js`) or list paths before the flags",
                },
              );
            } else {
              variadicSwallowError("test", ["--from"]);
            }
            return;
          }
          usageError(opts.json, "Usage error: `nudo test` needs at least one path.", {
            suggestion: "pass at least one file or directory (e.g. `nudo test src/index.js`)",
          });
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
        if (!opts.json) {
          reportPathErrors(targetErrors);
          if (targets.length === 0) return;
        }
        if (opts.json && targets.length > 1) {
          usageError(true, "--json requires a single file", {
            suggestion: "run `nudo test --json <file>` per file, or drop --json for the multi-file human face",
          });
          return;
        }
        const fromErrors: PathError[] = [];
        const externalRecords = opts.from?.length
          ? collectExternalRecords(opts.from, opts.json ? fromErrors : undefined)
          : undefined;
        const allPathErrors = [...targetErrors, ...fromErrors];
        if (opts.json && targets.length === 0) {
          // **任何**失败形态都必有 JSON body（绝不空 stdout + exit 1）：
          // 路径错误 / 用法错误 / 语法错共用这一条 CaseJson 失败信封。
          const file = allPathErrors[0]?.path ?? paths[0] ?? "";
          // Bug 1085：watch 面的 stdout 是 **JSON Lines**（每行一份完整
          // JSON 文档）⇒ 这条**早退**分支（watch 安装之前）也必须落一行
          // （改前落 pretty 多行文档 ⇒ 逐行 `JSON.parse` 的消费者在第一行
          // 就炸，且同一 flag 组合的 stdout 形态随路径是否可解析而变）。
          // 非 watch 面**逐字不变**（仍是一份 pretty 文档）。
          emitJsonDoc(failureEnvelope(file, allPathErrors, targetErrors), opts.watch === true);
          process.exitCode = 1;
          return;
        }

        // Bug 653：`--exit-on-diff` 的前置校验**不得**嵌在 `--freeze` 分支内
        // ⇒ 无 `--freeze` 时也必须被检查并报用法错误（此前被静默忽略、exit 0
        // ⇒ CI 门禁形同虚设；`nudo contract --exit-on-diff` 同款报错）。
        if (opts.exitOnDiff && opts.freeze === undefined) {
          usageError(opts.json, "--exit-on-diff requires --freeze --dry-run", {
            suggestion:
              "run `nudo test <file> --freeze --dry-run --exit-on-diff` (or drop --exit-on-diff)",
          });
          return;
        }

        let freeze: EmitCasesOptions | undefined;
        if (opts.freeze !== undefined) {
          let mode: "add" | "update";
          if (opts.freeze === true) mode = "add";
          else if (opts.freeze === "update") mode = "update";
          // Bug 654 / 656：帮助文本承诺 `--freeze` 的取值是 `update | add`
          // ⇒ 解析器**必须**接受 `=add`（此前只认 `=update` 与省略值 ⇒
          // 用户照 `--help` 写就命令失败）。
          else if (opts.freeze === "add") mode = "add";
          else {
            usageError(
              opts.json,
              `Invalid --freeze value: ${opts.freeze} (expected: =update or =add, or --freeze without a value for add)`,
              { suggestion: "use `--freeze` (add), `--freeze=add` or `--freeze=update`" },
            );
            return;
          }
          if (opts.json) {
            usageError(true, "--freeze cannot be combined with --json", {
              suggestion: "drop --json (freeze writes the source file) or drop --freeze",
            });
            return;
          }
          if (opts.exitOnDiff && !opts.dryRun) {
            usageError(opts.json, "--exit-on-diff requires --dry-run", {
              suggestion:
                "run `nudo test <file> --freeze --dry-run --exit-on-diff` (or drop --exit-on-diff)",
            });
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
            // 63b：闸门错误的精确子集（`--from` 路径错误不在其中）
            ...(opts.json && targetErrors.length > 0 ? { targetErrors } : {}),
          });
        };

        if (opts.watch) {
          // 族 21 Bug 928（test 面同机制）：`--from` 的调用点证据此前是**启动
          // 快照** ⇒ 每轮从不刷新 ⇒ 同一轮里两个文件对同一次调用给出相反
          // 裁决，且与同一磁盘状态下的全新非 watch 运行结论相反。改为
          // **每轮开跑前重采**（与 `nudo check --watch --from` 同口径）。
          let roundFrom: CallRecord[] | undefined = externalRecords;
          let roundFromErrors: PathError[] = [];
          startWatch(
            paths,
            async (t: string): Promise<void> => {
              await runTest(t, {
                ...(roundFrom ? { from: roundFrom } : {}),
                ...(freeze ? { freeze } : {}),
                json: opts.json,
                abs: opts.abs,
                envErrorSeen,
                // 63：watch 面 ⇒ `--json` 落 **JSON Lines**（一行一份完整
                // JSON 文档；第 2 轮起 stdout 累积第 2 份文档 ⇒ 整份
                // `JSON.parse(stdout)` 会炸）。
                jsonLines: true,
                ...(opts.json && roundFromErrors.length > 0
                  ? { pathErrors: [...allPathErrors, ...roundFromErrors] }
                  : opts.json && allPathErrors.length > 0
                    ? { pathErrors: allPathErrors }
                    : {}),
                // 63b：闸门错误的精确子集（`--from` 路径错误不在其中）
                ...(opts.json && targetErrors.length > 0 ? { targetErrors } : {}),
              });
              // 本轮证据缺失 ⇒ 本轮红（runTest 之后落，避免被轮首复位吃掉）
              if (roundFromErrors.length > 0) process.exitCode = 1;
            },
            "test",
            () => {
              envErrorSeen.clear();
              roundFromErrors = [];
              roundFrom = opts.from?.length
                ? collectExternalRecords(opts.from, roundFromErrors)
                : undefined;
              if (roundFromErrors.length > 0) reportPathErrors(roundFromErrors);
            },
          );
          return;
        }
        for (const t of targets) await runOne(t);
      },
    );
}
