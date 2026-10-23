/**
 * nudo contract — 契约：打印 / draft / emit。
 * 从 index.ts 原样迁出，行为不变。
 *
 * 族 20 · S0（串行前置重构）：三个分支层函数搬到**同包内部模块**
 * （`./contract-draft.ts` / `./contract-emit.ts` / `./contract-from-dts.ts`），
 * 本文件只保留 `registerContractCommand`（**唯一导出**）+ `runContractPrint` + action。
 * **行为零变化**；新模块不在公开面上（`packages/nudojs/package.json` 的 `exports`
 * 只有 `"."`）⇒ 零新增公开导出。
 */
import { resolve, relative } from "node:path";
import type { Command } from "commander";
import { formatInterfaceSurfaceLine } from "@nudojs/service/emit";
import { isNudoTargetPath, type CallRecord } from "@nudojs/service";
import { collectExternalRecords, reportPathErrors, resolveTargetsCollect, variadicSwallowError, type PathError } from "./shared.ts";
import { runContractDraft } from "./contract-draft.ts";
import { runContractEmit } from "./contract-emit.ts";
import { runContractFromDts } from "./contract-from-dts.ts";

// ---------------------------------------------------------------------------
// contract — 契约：打印 / draft / emit
// ---------------------------------------------------------------------------

async function runContractPrint(
  file: string,
  records?: CallRecord[],
  opts?: { json?: boolean },
): Promise<void> {
  const { interfaceSurface } = await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const entries = await interfaceSurface(filePath, { records });
  const rel = relative(process.cwd(), filePath) || filePath;
  // 族 21 Bug 670：`--json` 是**机器面** ⇒ stdout 必须是合法 JSON。
  // 改前本函数完全不看 `opts.json` ⇒ `nudo contract --json` 把人类文本
  // （`<file>` + 每行签名）写进 stdout ⇒ `JSON.parse(stdout)` 抛错。
  if (opts?.json === true) {
    console.log(
      JSON.stringify(
        {
          file: rel,
          entries: entries.map((e) => ({
            fn: e.fn,
            signature: formatInterfaceSurfaceLine(e),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
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

// ---------------------------------------------------------------------------
// 族 20 · Bug 658 / 661 / 664 —— `--json` 的**跨文件聚合层**
// ---------------------------------------------------------------------------

/**
 * `--json` 聚合信封的**元素**。顶层恒为**数组**（单文件 = 单元素数组），
 * 元素有三种：
 * 1. **分支层的单文件机器文档**（print: `{file, entries}`；draft:
 *    `{file, draftPath, draftSource, diff, entries}`；emit: 片 C 的信封）；
 * 2. **失败条目** `{file, errors:[{code, message}]}`（某个 root 抛错 ⇒ Bug 664）；
 * 3. **错误条目** `{pathErrors:[{path, code, message, suggestion}]}`
 *    （路径错误 / 用法错误 ⇒ Bug 661）。
 */
type ContractJsonEntry = Record<string, unknown>;

/** 聚合信封里的错误条目（路径错误 / 用法错误共用 `pathErrors[]` 字段）。 */
type ContractJsonError = {
  path: string;
  code: string;
  message: string;
  suggestion?: string;
};

/** 用法错误的机器面码（与 `check` 的 `usageErrorExit` 同码族）。 */
const CONTRACT_USAGE_ERROR_CODE = "nudo:usage-error";

/** 某个 root 分析失败（解析 / 分析抛错）的机器面码。 */
const CONTRACT_ANALYSIS_FAILED_CODE = "nudo:contract-analysis-failed";

/** 某个 root 的分支层输出**不是 JSON 文档**（机器面拿不到合法载荷）的机器面码。 */
const CONTRACT_JSON_PAYLOAD_INVALID_CODE = "nudo:contract-json-payload-invalid";

/** 错误条目（`pathErrors[]`）——路径错误与用法错误同字段（`check` 面同款）。 */
function contractErrorEntry(errors: ContractJsonError[]): ContractJsonEntry {
  return {
    pathErrors: errors.map((e) => ({
      path: e.path,
      code: e.code,
      message: e.message,
      ...(e.suggestion ? { suggestion: e.suggestion } : {}),
    })),
  };
}

/**
 * 收走**一个 root** 的机器面输出（族 20 · Bug 658 / 664）。
 *
 * 分支层（`runContractPrint` / `contract-draft.ts` 的 `runContractDraft` /
 * `contract-emit.ts` 的 `runContractEmit`）各自 `console.log(JSON.stringify(单文件文档))`
 * ⇒ 命令层对**每个 root** 各跑一次 ⇒ stdout 是 N 份 JSON 首尾相接
 * （`JSON.parse` 抛 "Unexpected non-whitespace character after JSON"）。
 *
 * 修法（**不改分支层签名** ⇒ 分支层照旧吐单文件文档）：命令层在 `--json` 形态下
 * **临时接管 `console.log`**，把该 root 吐出的文档收进聚合层；循环结束后
 * **一次** `console.log(JSON.stringify(聚合结果, null, 2))`
 * ⇒ stdout 恒为**一份**合法 JSON（单文件 = 单元素数组）。
 *
 * 失败（抛错 / 输出不是 JSON）也**产 body**（Bug 664）⇒ stdout 永不为空。
 */
async function captureRootDocument(
  run: () => Promise<void>,
): Promise<
  { ok: true; doc: unknown } | { ok: false; code: string; message: string; raw: string }
> {
  const original = console.log;
  const chunks: string[] = [];
  console.log = (...args: unknown[]): void => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  let failure: { code: string; message: string } | undefined;
  try {
    await run();
  } catch (err) {
    failure = { code: CONTRACT_ANALYSIS_FAILED_CODE, message: (err as Error).message };
  } finally {
    console.log = original;
  }
  const raw = chunks.join("\n");
  if (failure) return { ok: false, code: failure.code, message: failure.message, raw };
  try {
    return { ok: true, doc: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      code: CONTRACT_JSON_PAYLOAD_INVALID_CODE,
      message: "branch output is not a JSON document",
      raw,
    };
  }
}

export function registerContractCommand(program: Command): void {
  program
    .command("contract")
    .description("Draft / emit / print contracts (sidecar interfaces)")
    .argument("[paths...]", "File(s) or directory(s)")
    .option("--emit", "Write/update @generated sidecar segments (mode: update)")
    .option("--draft", "Generate a reviewable contract draft from existing code")
    .option(
      "--from-dts",
      "Reverse TypeScript .d.ts / package types into a reviewable contract draft (NOT enforced)",
    )
    .option("--write", "With --draft / --from-dts: write draft on disk")
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
    .option("--json", "With --draft: machine-readable draftSource + unified diff (AI4)")
    // 族 20 · Bug 944：`--from-dts --write` 现在拒绝覆盖既有草稿（存在性检查）
    // ⇒ 需要一条**显式**的覆盖通道（与 `NUDO_DRAFT_FORCE=1` 环境变量等价，
    // 但走 CLI 面可见、可被脚本审计）。仅对 `--from-dts --write` 生效。
    .option("--force", "With --from-dts --write: overwrite an existing draft")
    .action(
      async (
        paths: string[],
        opts: {
          emit?: boolean;
          draft?: boolean;
          fromDts?: boolean;
          write?: boolean;
          force?: boolean;
          fn?: string[];
          all?: boolean;
          dryRun?: boolean;
          exitOnDiff?: boolean;
          from?: string[];
          json?: boolean;
        },
      ) => {
        const jsonMode = opts.json === true;
        /**
         * 用法错误出口：人类面 = stderr 文案；`--json` 面 = 聚合信封里的
         * `pathErrors[]` 条目（`code: nudo:usage-error`）⇒ stdout 永不为空 +
         * exit 1（口径与 `check` 的 `usageErrorExit` 同款 —— 族 20 · Bug 661
         * 的不变量：「exit 1 必须有一个可机器读取的理由」）。
         */
        const usageError = (message: string, suggestion?: string): void => {
          if (jsonMode) {
            console.log(
              JSON.stringify(
                [
                  contractErrorEntry([
                    {
                      path: "",
                      code: CONTRACT_USAGE_ERROR_CODE,
                      message,
                      ...(suggestion ? { suggestion } : {}),
                    },
                  ]),
                ],
                null,
                2,
              ),
            );
          } else {
            console.error(message);
          }
          process.exitCode = 1;
        };
        // ---- 族 20 · Bug 659：模式分派顺序 = 「**先校验、后分派**」----
        // 改前 `--from-dts` 在**所有用法校验之前**短路 ⇒ `--emit` / `--draft` /
        // `--json` 被静默吞掉（`--from-dts --emit --draft` 不报互斥、exit 0；
        // `--from-dts --json` 的 stdout 是 draft 文本、不是 JSON）。
        // 改后 `--from-dts` 与其它模式**共用同一套校验**，分派在校验**之后**。
        //
        // ① 路径面（`--from-dts` 自带专属用法错误 ⇒ 交给 runContractFromDts）
        if (!opts.fromDts && paths.length === 0) {
          // BUG-024：--from variadic 吞噬其后的位置参数——
          // 定向 usage error（直指旗标 + `--` 终止符解法）
          if (opts.from?.length) {
            variadicSwallowError("contract", ["--from"]);
            return;
          }
          usageError(
            "Usage error: `nudo contract` needs at least one path. " +
              (opts.emit
                ? "Writing filters: --fn <names> / --all (default: only refresh existing @generated segments)."
                : opts.draft
                  ? "Draft mode: pass a file or directory."
                  : "Print-only: pass a file or directory."),
          );
          return;
        }
        // ② `--emit` / `--draft` 互斥（对所有模式生效，含 `--from-dts`）
        if (opts.emit && opts.draft) {
          usageError("Usage error: --emit and --draft are mutually exclusive");
          return;
        }
        // ③ `--write` 需要草稿模式：**`--draft` 或 `--from-dts`**
        //    （help 与 cli-reference 的口径都是「With --draft / --from-dts」）
        if (opts.write === true && !opts.draft && !opts.fromDts) {
          usageError("Usage error: --write requires --draft");
          return;
        }
        // ④ `--exit-on-diff` 需要 `--emit --dry-run`（对所有模式生效，含 `--from-dts`）
        if (opts.exitOnDiff && (!opts.dryRun || !opts.emit)) {
          usageError("--exit-on-diff requires --emit --dry-run");
          return;
        }
        // ⑤ `--json` 与 `--from-dts` 互斥（`--from-dts` **没有** JSON 载荷契约
        //    ⇒ 显式拒绝，不许「给了不生效且不报错」）
        if (jsonMode && opts.fromDts) {
          usageError(
            "Usage error: --json cannot be combined with --from-dts",
            "drop --json (--from-dts prints a reviewable draft, not a machine-readable payload)",
          );
          return;
        }
        // ⑥ 分派（校验之后）
        if (opts.fromDts) {
          await runContractFromDts(paths, {
            write: opts.write === true,
            dryRun: opts.dryRun === true,
            // 族 20 · Bug 944：显式覆盖通道（CLI 面可见；等价于 `NUDO_DRAFT_FORCE=1`）
            force: opts.force === true,
          });
          return;
        }
        const fromErrors: PathError[] = [];
        const externalRecords = opts.from?.length
          ? collectExternalRecords(opts.from, jsonMode ? fromErrors : undefined)
          : undefined;
        const targets: string[] = [];
        const pathErrors: PathError[] = [];
        for (const p of paths) {
          const r = resolveTargetsCollect(p);
          targets.push(...r.targets);
          pathErrors.push(...r.errors);
        }
        const allPathErrors = [...pathErrors, ...fromErrors];
        if (!jsonMode) reportPathErrors(allPathErrors);
        const roots = targets.filter((t) => isNudoTargetPath(t));
        if (roots.length === 0) {
          if (jsonMode) {
            // --json：路径错误也必须有 body（绝不空 stdout + exit 1）
            console.log(
              JSON.stringify(
                allPathErrors.length > 0 ? [contractErrorEntry(allPathErrors)] : [],
                null,
                2,
              ),
            );
            if (allPathErrors.length > 0) {
              process.exitCode = 1;
            } else if (targets.length > 0) {
              console.error(
                `Usage error: no nudo analysis targets in the given paths: ${paths.join(", ")}`,
              );
              process.exitCode = 1;
            }
            return;
          }
          if (targets.length > 0) {
            console.error(`Usage error: no nudo analysis targets in the given paths: ${paths.join(", ")}`);
            process.exitCode = 1;
          }
          return;
        }
        if (jsonMode && allPathErrors.length > 0) process.exitCode = 1;
        // --json：跨文件聚合层（Bug 658）——每个 root 一项，循环后**一次**打印
        const jsonEntries: ContractJsonEntry[] = [];
        for (const t of roots) {
          const rel = relative(process.cwd(), t) || t;
          const runRoot = async (): Promise<void> => {
            if (opts.draft) {
              await runContractDraft(t, {
                fnNames: opts.fn ?? [],
                write: opts.write === true,
                dryRun: opts.dryRun === true,
                json: jsonMode,
                records: externalRecords,
              });
            } else if (opts.emit) {
              await runContractEmit(t, {
                fnNames: opts.fn ?? [],
                all: opts.all === true,
                dryRun: opts.dryRun === true,
                exitOnDiff: opts.exitOnDiff === true,
                records: externalRecords,
                // 族 20 · Bug 667（片 C）：emit 分支的 JSON 信封由
                // `contract-emit.ts` 消费 `opts.json`（该字段由片 C 加进 opts 类型）
                // ⇒ 这里用**展开**传（展开不吃 excess property 检查
                // ⇒ 片 C 落地前后都能编译）。
                ...(jsonMode ? { json: true } : {}),
              });
            } else {
              await runContractPrint(t, externalRecords, { json: jsonMode });
            }
          };
          if (!jsonMode) {
            try {
              await runRoot();
            } catch (err) {
              console.error(`Error analyzing ${relative(process.cwd(), t)}: ${(err as Error).message}`);
              process.exitCode = 1;
            }
            continue;
          }
          const captured = await captureRootDocument(runRoot);
          if (captured.ok) {
            jsonEntries.push(captured.doc as ContractJsonEntry);
          } else {
            // Bug 664：失败的 root 也必须进载荷（否则机器面看不到哪个文件失败）
            const shown = relative(process.cwd(), t);
            if (captured.code === CONTRACT_ANALYSIS_FAILED_CODE) {
              console.error(`Error analyzing ${shown}: ${captured.message}`);
            } else {
              console.error(`Error: ${shown}: ${captured.message}`);
            }
            process.exitCode = 1;
            jsonEntries.push({
              file: rel,
              errors: [{ code: captured.code, message: captured.message }],
              ...(captured.raw ? { output: captured.raw } : {}),
            });
          }
        }
        if (jsonMode) {
          // 路径错误是**命令级**事实（不是某个 root 的）⇒ 独立成一项
          // （print / emit / draft 三形态统一 —— 族 20 · Bug 661）
          if (allPathErrors.length > 0) jsonEntries.push(contractErrorEntry(allPathErrors));
          console.log(JSON.stringify(jsonEntries, null, 2));
        }
      },
    );
}
