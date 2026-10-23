/**
 * contract --emit 分支 —— 从 `packages/nudojs/src/commands/contract.ts` 搬移而来。
 *
 * 搬移记录（族 20 · S0「串行前置重构」）：
 * - 原函数名：`runContractEmit`
 * - 原文件：  `packages/nudojs/src/commands/contract.ts`
 * - 搬移自：  commit `3b531d0b`（族 20 开工时的 HEAD）
 * - 承诺：    **行为零变化** —— 函数体逐字保留，只把「同包内可见」的依赖
 *             换成各自的 import（`@nudojs/service/emit` / `@nudojs/service`）。
 *             本次**不改任何判定、不改任何文案**。
 *
 * 本模块是**包内内部模块**（`packages/nudojs/package.json` 的 `exports` 只有 `"."`）
 * ⇒ 不在公开面上，零新增公开导出。
 *
 * ── 族 20 · 片 C 的三条修复（657 / 662 / 667）────────────────────────────
 * - **657**：`--fn` 未命中 ⇒ 过滤器**不再降级成 `undefined`**（静默放大作用域）。
 * - **662**：`--emit --dry-run` 的预览标签改用**侧车路径**（与另两分支同口径）。
 * - **667**：`--json` 面（`opts.json`）⇒ 吐**单文件机器文档**（机器面不再拿到人类文本）。
 */
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { formatEmitSummary } from "@nudojs/service/emit";
import type { CallRecord } from "@nudojs/service";

/**
 * 机器面**用法错误**码（族 20 · Bug 657）。
 *
 * 与 `contract.ts` 的 `CONTRACT_USAGE_ERROR_CODE` **同值**（同一条协议常量）。
 * 两处各自定义 ⇒ 不跨模块 import ⇒ 片 A 的 `contract.ts` 零改动。
 */
const CONTRACT_USAGE_ERROR_CODE = "nudo:usage-error";

export async function runContractEmit(
  file: string,
  opts: {
    fnNames: string[];
    all: boolean;
    dryRun: boolean;
    exitOnDiff: boolean;
    records?: CallRecord[];
    /**
     * `--json` 面（族 20 · Bug 667）：**给已有 opts 类型加可选字段**
     * （不算新增导出 ⇒ 不动公开面）。action 的 emit 分支传 `json: true`
     * ⇒ 本函数吐**单文件机器文档**（命令层的聚合层把它收进恒定数组外壳）。
     */
    json?: boolean;
  },
): Promise<void> {
  const { emitInterface, emitDerivedFromRoot } = await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  const fnNames = opts.fnNames.length > 0 ? opts.fnNames : undefined;
  const jsonMode = opts.json === true;

  // -------------------------------------------------------------------------
  // 族 20 · Bug 657 —— `--fn` 未命中：**过滤器不再降级成 `undefined`**
  //
  // 改前（根因行）：`localFnNames = filtered.length > 0 ? filtered : undefined;`
  // ⇒ 命中数为 0 时**整段降级成 `undefined`** ⇒ 发射器收不到任何 `fnNames`
  // ⇒ 作用域从「只写这一个」静默放大成「刷新全部既有 `@generated` 段」
  //   （叠加 `--all` 时放大成「新建全部导出段」）⇒ 写盘、exit 0、零告警。
  //
  // 改后（裁决）：
  // - `--fn` 名单**原样**下传给发射器 ⇒ 未命中的名字走发射器**已存在**的
  //   `skipped <fn> (not-an-export)` 通道（`formatEmitSummary` 与 LSP agent 面
  //   同款文案）⇒ 跨产品面一致；**过滤器永不降级成 `undefined`**（作用域不放大）。
  // - **全部未命中**（本地导出名与派生目标名都没命中）⇒ 当**用法错误**：
  //   列出本地导出名候选、exit 1、**不写盘**。
  //
  // ⚠ `--fn` 的名字有两种合法来源：**本地导出名**与**派生（下游）导出名**
  //   （root 驱动推导：`--emit lib.js --fn add2` 写的是 `add.nudo.js` 的 add2，
  //   而 `add2` 不是 `lib.js` 的导出）⇒ 判定必须**同时**看这两处，
  //   否则会把合法的派生用法误判成用法错误。
  // -------------------------------------------------------------------------
  let localExports: Set<string> | undefined;
  if (fnNames) {
    try {
      const { localNamedExports } = await import("@nudojs/core");
      localExports = localNamedExports(readFileSync(filePath, "utf-8"));
    } catch {
      /* optional: local export scan failed — keep requested fn names */
    }
  }

  let derivedChanged = false;
  /** 派生分支的人类面输出行（**判定之后**再打印 ⇒ 用法错误时只有错误面） */
  const derivedLines: string[] = [];
  /** `--json` 面：派生侧车的机器文档（人类面不产这些行） */
  const derivedDocs: Array<Record<string, unknown>> = [];
  /** `--json` 面：派生分支的顶层诊断 */
  const derivedIssues: Array<{
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
  }> = [];
  // 派生侧车（root 驱动）：`--fn` 白名单**原样**下传 ⇒ 它的作用域天然受限
  // （未命中的名字在派生侧没有任何目标 ⇒ 派生侧车不会被写）。
  const derived = emitDerivedFromRoot(filePath, {
    ...(fnNames ? { fnNames } : {}),
    mode: "update",
    dryRun: opts.dryRun,
    ...(!(fnNames || opts.all) ? { refreshExistingOnly: true } : {}),
  });
  /** 派生侧命中的名字（合法的「下游导出名」用法） */
  const derivedMatched: string[] = [];
  if (derived.hasRoot) {
    for (const i of derived.issues ?? []) {
      if (!jsonMode) derivedLines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
      derivedIssues.push(i);
    }
    for (const sc of derived.sidecars) {
      const scRel = relative(process.cwd(), sc.sidecarPath) || sc.sidecarPath;
      if (fnNames && fnNames.includes(sc.fn)) derivedMatched.push(sc.fn);
      if (jsonMode) {
        derivedDocs.push({
          sidecar: scRel,
          fn: sc.fn,
          changed: sc.changed,
          written: sc.written,
          ...(sc.skipped ? { skipped: sc.skipped } : {}),
          ...(sc.diff !== undefined ? { diff: sc.diff } : {}),
          issues: sc.issues,
        });
      } else if (sc.changed && opts.dryRun) {
        derivedLines.push(
          `[dry-run] would update ${scRel} (derived-from ${derived.roots.join(", ")}):`,
        );
        derivedLines.push(sc.diff ?? "");
      } else if (sc.changed) {
        derivedLines.push(
          `Updated ${rel} → ${scRel} (derived-from ${derived.roots.join(", ")})`,
        );
        derivedLines.push(`  written: ${sc.fn}`);
      } else {
        derivedLines.push(
          `${scRel}: no derived contract changes (${sc.skipped ?? "no-change"})`,
        );
      }
      for (const i of sc.issues) {
        if (!jsonMode) derivedLines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
        // design §1.3：contract 只读/emit 不因分析诊断挡 CI；
        // 仅 usage/IO 与 --exit-on-diff（且须 --dry-run）影响 exit
      }
      // §1.3「将写盘且有 diff → 1」：changed 即计入（含 dry-run 与 written 为空的
      // 纯归一化重排），不依赖 sc.written（written.length>0 && changed 的子集）
      if (sc.changed) derivedChanged = true;
    }
  }

  // ---- 判定（族 20 · Bug 657）：`--fn` 名单**一处都没命中** ⇒ 用法错误 ----
  if (fnNames && localExports) {
    const localMatched = fnNames.filter((n) => localExports.has(n));
    if (localMatched.length === 0 && derivedMatched.length === 0) {
      const candidates = [...localExports].sort();
      const message =
        `Usage error: --fn ${fnNames.map((n) => `\`${n}\``).join(", ")} matched no export in ${rel}; nothing was written` +
        (candidates.length > 0 ? `\navailable exports: ${candidates.join(", ")}` : "");
      if (jsonMode) {
        // 机器面：吐**合法 JSON 文档**（否则聚合层判「不是 JSON 文档」）
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
  }

  // 判定之后才打印派生分支的输出（用法错误时输出面只有错误面）
  for (const line of derivedLines) console.log(line);

  const result = await emitInterface(filePath, {
    // `--fn` 名单**原样**下传（改前：过滤后为空 ⇒ 降级成 undefined ⇒ 作用域放大）
    ...(fnNames ? { fnNames } : {}),
    mode: "update",
    all: opts.all,
    dryRun: opts.dryRun,
    records: opts.records,
  });
  const sc = relative(process.cwd(), result.sidecarPath) || result.sidecarPath;
  if (jsonMode) {
    // 族 20 · Bug 667：机器面 = **单文件文档**（与 print / draft 分支同构：
    // `file` + 该分支的字段；命令层的聚合层把它收进恒定数组外壳）。
    // 人类文本**一律不打印** ⇒ stdout 恒为一份合法 JSON。
    console.log(
      JSON.stringify(
        {
          file: rel,
          sidecar: sc,
          changed: result.changed,
          written: result.written,
          skipped: result.skipped.map((s) => ({ fn: s.fn, reason: s.reason })),
          issues: result.issues,
          ...(result.diff !== undefined ? { diff: result.diff } : {}),
          ...(result.emptyDefaultTargets ? { emptyDefaultTargets: true } : {}),
          ...(derivedDocs.length > 0 ? { derived: derivedDocs } : {}),
          ...(derivedIssues.length > 0 ? { derivedIssues } : {}),
        },
        null,
        2,
      ),
    );
  } else if (result.changed && opts.dryRun) {
    // 族 20 · Bug 662：预览标签取**侧车**（改前取源文件 ⇒ 标签与 diff 头
    // 指向两个不同文件；同文件另两分支都取侧车 ⇒ 单点笔误，不是取舍）。
    console.log(`[dry-run] would update ${sc}:`);
    console.log(result.diff ?? "");
    for (const i of result.issues) {
      console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
    }
    for (const s of result.skipped) {
      // 与 `formatEmitSummary` / LSP agent 面同款文案（改前是 `skipped <fn>: <reason>`）
      console.log(`  skipped ${s.fn} (${s.reason})`);
    }
  } else {
    for (const line of formatEmitSummary(rel, sc, result)) console.log(line);
  }
  // Bug 508：诊断的**唯一渲染点**是 formatEmitSummary（它渲染后即消费
  // result.issues）。这里再遍历一次会让同一条诊断出两遍（dry-run 路径尤其
  // 明显：上面已逐条打印过 error 级）。故不再有第二个渲染点。
  const anyChanged = result.changed || derivedChanged;
  if (opts.exitOnDiff && anyChanged) process.exitCode = 1;
  if (anyChanged && !opts.dryRun && !jsonMode) {
    console.log(`  re-run \`nudo check ${rel}\` to see the persisted contracts in action`);
  }
}
