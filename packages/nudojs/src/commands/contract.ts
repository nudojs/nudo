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
import {
  formatContractSurfaceLine,
  type ContractSurfaceEntry,
} from "@nudojs/service/emit";
import { isNudoTargetPath, type CallRecord } from "@nudojs/service";
import {
  collectExternalRecords,
  collectTargets,
  diskCacheSignConfigError,
  pathErrorEntry,
  reportPathErrors,
  variadicSwallowError,
  type PathError,
} from "./shared.ts";
import { runContractDraft } from "./contract-draft.ts";
import { runContractEmit } from "./contract-emit.ts";
import { runContractFromDts } from "./contract-from-dts.ts";

// ---------------------------------------------------------------------------
// contract — 契约：打印 / draft / emit
// ---------------------------------------------------------------------------

/**
 * Bug 80：契约面透出的「契约装载 / 绑定失败」诊断（与 service 侧
 * `ContractFaceDiagnostic` 同形 —— 结构类型直接兼容，无需新增公开导出）。
 */
type ContractFaceDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
};

/** Bug 80：按同树 check / export 的裁决渲染（stderr + error 级非零退出）。 */
function reportContractFaceDiagnostics(diags: readonly ContractFaceDiagnostic[]): void {
  for (const d of diags) {
    const label = d.severity === "error" ? "error" : "warning";
    console.error(`${label}: [${d.code}] ${d.message}`);
  }
  if (diags.some((d) => d.severity === "error")) process.exitCode = 1;
}

async function runContractPrint(
  file: string,
  records?: CallRecord[],
  opts?: { json?: boolean; fnNames?: string[]; all?: boolean },
): Promise<void> {
  const { contractSurface } = await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  // Bug 80：本次分析产生的装载诊断透出（不再被 contractSurface 取走丢弃）。
  const diagnostics: ContractFaceDiagnostic[] = [];
  const entries = await contractSurface(filePath, { records, diagnostics });
  reportContractFaceDiagnostics(diagnostics);

  // Bug 101：`--fn` / `--all` 是 contract 的通用过滤项
  // （cli-reference.md:267-268，条目未限定作用域）。print 面默认即全量；
  // `--all` = 显式全量，`--fn` = 按名单过滤。两者同给时按 :357/:374 的纪律
  // 「不许给了不生效且不报错」⇒ 显式 usage error（不是静默二选一）。
  const fnNames = opts?.fnNames ?? [];
  if (fnNames.length > 0 && opts?.all === true) {
    const message = "Usage error: --fn and --all are mutually exclusive on the print face";
    if (opts?.json === true) {
      console.log(
        JSON.stringify(
          { file: rel, errors: [{ code: CONTRACT_USAGE_ERROR_CODE, message }] },
          null,
          2,
        ),
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }
  const shown = fnNames.length > 0 ? entries.filter((e) => fnNames.includes(e.fn)) : entries;
  // `--fn` 一处都没命中 ⇒ 与 --draft / --emit 同纪律：usage error + exit 1
  // （绝不静默输出空条目表）。
  if (fnNames.length > 0 && shown.length === 0) {
    const candidates = [...new Set(entries.map((e) => e.fn))].sort();
    const message =
      `Usage error: --fn ${fnNames.map((n) => `\`${n}\``).join(", ")} matched no contract entry in ${rel}` +
      (candidates.length > 0 ? `\navailable exports: ${candidates.join(", ")}` : "");
    if (opts?.json === true) {
      console.log(
        JSON.stringify(
          { file: rel, errors: [{ code: CONTRACT_USAGE_ERROR_CODE, message }] },
          null,
          2,
        ),
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }

  // 族 21 Bug 670：`--json` 是**机器面** ⇒ stdout 必须是合法 JSON。
  // 改前本函数完全不看 `opts.json` ⇒ `nudo contract --json` 把人类文本
  // （`<file>` + 每行签名）写进 stdout ⇒ `JSON.parse(stdout)` 抛错。
  if (opts?.json === true) {
    console.log(
      JSON.stringify(
        {
          file: rel,
          entries: shown.map((e) => ({
            fn: e.fn,
            signature: formatContractSurfaceLine(e),
            // BUG-081：机器面必须带同名字段（此前冲突 / 不可判定在契约面上完全无痕）
            ...(e.conflict !== undefined ? { conflict: e.conflict } : {}),
            ...(e.undecidable !== undefined ? { undecidable: e.undecidable } : {}),
          })),
          // Bug 80：坏侧车也必须在机器面有承载诊断的字段
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        },
        null,
        2,
      ),
    );
    reportContractMarks(shown);
    return;
  }
  console.log(`${rel}`);
  if (shown.length === 0) {
    console.log("  (no top-level functions found)");
    console.log();
    return;
  }
  for (const e of shown) {
    console.log(formatContractSurfaceLine(e));
  }
  console.log();
  reportContractMarks(shown);
}

/**
 * BUG-081 —— **结论对齐**：`nudo check` 对无解契约报 `nudo:contract-conflict`
 * error（exit 1），`nudo export` 拒绝出货（exit 1），而 `nudo contract` 此前把
 * 同一个契约印成**有效契约**并 exit 0 ⇒ 三个一级动词对同一事实给出相反结论。
 *
 * 契约面是「我的契约是什么」的权威读取口 ⇒ 必须同结论：
 * - `conflict`（合取不可满足）⇒ stderr 报同码 error，**不改退出码**
 *   （Bug 34 / §1.3：只读 contract / export 只在用法 / IO 错误时 exit 1；
 *    契约冲突是被分析代码的状态，属于 stdout/stderr 上的诊断内容，不是
 *    「命令没跑成」；CI 门禁只认 check。冲突的行尾标记 + `--json` 字段照旧透出）；
 * - `undecidable`（结构型组合算不出交集，另一侧义务未执法）⇒ error 级**不**成立
 *   （check 面是 warning，能力边界不是用户代码矛盾）⇒ 只报 warning，不改退出码，
 *   但绝不静默（行尾标记 + `--json` 字段已经透出）。
 *
 * ⚠ 侧车**装载失败**（`nudo:contract-load` 等）是另一条通道：它与
 * check / test / health / export 同裁决 ⇒ 由 `reportContractFaceDiagnostics`
 * 报 error 并改退出码（Bug 80），不能与这里的「数据内容」混为一谈。
 */
function reportContractMarks(entries: readonly ContractSurfaceEntry[]): void {
  for (const e of entries) {
    if (e.conflict !== undefined) {
      if (e.conflict.params.length > 0) {
        console.error(
          `error: [nudo:contract-conflict] ${e.fn}: handwritten contract conjunction unsatisfiable (${e.conflict.params.join(", ")})`,
        );
      }
      if (e.conflict.returns === true) {
        console.error(
          `error: [nudo:contract-conflict] ${e.fn}: handwritten contract conjunction unsatisfiable on the return slot`,
        );
      }
      // Bug 34：只读面不因契约**数据内容**改退出码（仅用法 / IO 错误才 exit 1）。
    }
    if (e.undecidable !== undefined) {
      if (e.undecidable.params.length > 0) {
        console.error(
          `warning: [nudo:contract-undecidable] ${e.fn}: contract conjunction not computable (${e.undecidable.params.join(", ")}) — only one side is enforced`,
        );
      }
      if (e.undecidable.returns === true) {
        console.error(
          `warning: [nudo:contract-undecidable] ${e.fn}: contract conjunction not computable on the return slot — only one side is enforced`,
        );
      }
    }
  }
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

/**
 * 错误条目（`pathErrors[]`）——路径错误与用法错误同字段（`check` 面同款）。
 *
 * 63b：**新增可选** `targetErrors[]`（分析目标闸门错误的**精确**子集）——
 * `pathErrors[]` 字段名 + 内容 + 顺序**逐字不变**（既有机器消费者零影响）；
 * `--from` 路径错误**不**进 `targetErrors[]`；无闸门错误 ⇒ 该字段**不出现**。
 */
function contractErrorEntry(
  errors: ContractJsonError[],
  targetErrors?: PathError[],
): ContractJsonEntry {
  return {
    pathErrors: errors.map((e) => ({
      path: e.path,
      code: e.code,
      message: e.message,
      ...(e.suggestion ? { suggestion: e.suggestion } : {}),
    })),
    // 63b：闸门错误的精确入口（`--from` 路径错误不在其中）
    ...(targetErrors && targetErrors.length > 0
      ? { targetErrors: targetErrors.map(pathErrorEntry) }
      : {}),
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
    .description("Draft / emit / print contracts (sidecar contracts)")
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
    .option(
      "--dry-run",
      "With --emit, --draft --write or --from-dts --write: print a unified diff instead of writing",
    )
    .option("--exit-on-diff", "With --emit + --dry-run: exit 1 when the sidecar would change")
    .option("--from <paths...>", "Usage-site files feeding domain evidence")
    // 族 20 · Bug 1147：帮助文本与**实现**对齐 —— `--json` 是**三形态**通用
    // （print / `--draft` / `--emit`）且**顶层恒为数组**；元素形状按形态不同。
    // 改前写的是 "With --draft: …" ⇒ 用户以为 `--json` 只能配 `--draft`。
    // ⚠ 只改文案，**不改行为**（三形态的 JSON 载荷形状见
    // `runContractPrint` / `contract-draft.ts` / `contract-emit.ts`）。
    .option(
      "--json",
      "Machine face for print / --draft / --emit: the top level is always a JSON array (one element per input), and the element shape differs per mode. " +
        "print elements: { file, entries[] }. " +
        "--draft elements: { file, draftPath, draftSource, diff, entries[] }. " +
        "--emit elements: { file, sidecar, changed, written, skipped[], issues[], diff? }.",
    )
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
            // Bug 45：variadic 吞噬这一支过去无条件调 variadicSwallowError
            // （只有 stderr）⇒ `contract --json --from <file>` 的 stdout 是
            // 0 字节，机器面 JSON.parse 直接炸；同命令的其它三条用法错误
            // 分支都正常出 `{ pathErrors: [...] }` 信封 ⇒ 单点漏接。
            if (jsonMode) {
              usageError(
                "Usage error: `nudo contract` received no paths — variadic flag(s) --from consumed the following arguments",
                "separate variadic flags from paths with `--` (e.g. `nudo contract --from a.js -- b.js`) or list paths before the flags",
              );
            } else {
              variadicSwallowError("contract", ["--from"]);
            }
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
        // ⑥ BUG-100：`--from-dts` 与 `--emit` / `--fn` / `--all` 互斥
        //
        // 改前：分派只把 `write` / `dryRun` / `force` 交给 `runContractFromDts`，
        // `opts.emit` / `opts.fn` / `opts.all` **既没转发也没校验** ⇒
        // `nudo contract --from-dts --emit --all --dry-run --exit-on-diff x.d.ts`
        // 与单跑 `--from-dts` **逐字节相同**：exit 0、无侧车、无警告 ⇒
        // 漂移门禁**恒绿**（`--exit-on-diff` 永不生效）；`--fn` / `--all` 的过滤
        // 同样被吞（以为在筛某个函数，实际是全量草稿）。
        //
        // 改后：与 ⑤（`--json`）**同一条策略** —— 「不许『给了不生效且不报错』」
        // ⇒ 显式拒绝并指明替代命令。
        const fromDtsConflicts = [
          opts.emit ? "--emit" : undefined,
          opts.fn && opts.fn.length > 0 ? "--fn" : undefined,
          opts.all ? "--all" : undefined,
        ].filter((f): f is string => f !== undefined);
        if (opts.fromDts && fromDtsConflicts.length > 0) {
          usageError(
            `Usage error: --from-dts cannot be combined with ${fromDtsConflicts.join(" / ")}`,
            `drop ${fromDtsConflicts.join(" / ")} (--from-dts prints a reviewable draft, never sidecars; ` +
              "use `nudo contract --emit <file>` to write sidecars)",
          );
          return;
        }
        // ⑦ 分派（校验之后）
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
        // 63b：**分析目标闸门**错误（路径不存在 / 空目录 / 非分析目标）——
        // **单独一摊**（`targetErrors`）：`--from` 路径错误**不**进这里
        // （它是**精确入口**，不是副本）；全集仍是 `allPathErrors`
        // （= 闸门错误 + `--from` 错误，顺序不变 ⇒ `pathErrors[]` 逐字不变）。
        // Bug 79：跨位置参数收敛 ⇒ 同一模块只打印/分析一遍。
        const { targets, errors: targetErrors } = collectTargets(paths);
        const allPathErrors = [...targetErrors, ...fromErrors];
        if (!jsonMode) reportPathErrors(allPathErrors);
        // `nudo.cache.sign` 预检（B3 信任面）：签名开但 NUDO_CACHE_KEY 缺席 ⇒
        // 拒绝运行（打印面同样会开 iface 磁盘缓存；安全旋钮不静默降级）
        const signErr = diskCacheSignConfigError(targets);
        if (signErr) {
          usageError(signErr);
          return;
        }
        const roots = targets.filter((t) => isNudoTargetPath(t));
        if (roots.length === 0) {
          if (jsonMode) {
            // --json：路径错误也必须有 body（绝不空 stdout + exit 1）
            console.log(
              JSON.stringify(
                allPathErrors.length > 0
                  ? [contractErrorEntry(allPathErrors, targetErrors)]
                  : [],
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
              // Bug 101：打印面也转发通用过滤项（此前只传 json ⇒ --fn / --all
              // 被解析、被接受、然后被丢弃）。
              await runContractPrint(t, externalRecords, {
                json: jsonMode,
                fnNames: opts.fn ?? [],
                all: opts.all === true,
              });
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
          // 63b：该项里**新增可选** `targetErrors[]`（分析目标闸门错误的精确
          // 子集）；`pathErrors[]` 逐字不变。
          if (allPathErrors.length > 0)
            jsonEntries.push(contractErrorEntry(allPathErrors, targetErrors));
          console.log(JSON.stringify(jsonEntries, null, 2));
        }
      },
    );
}
