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
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

/**
 * 派生结果的 `fn` 字段是**同一侧车一组导出名的逗号拼接**
 * （`interface-derivation-emit.ts` 按侧车分组后 `rows.map(r => r.fn).join(",")`）
 * ⇒ 按名单比对必须先拆开：否则 `--fn wrap` 永远命中不了 `"wrap,tag"`
 * （同一处「名单匹配」缺陷在 draft 面即 BUG-042）。
 */
function splitDerivedFns(fn: string): string[] {
  return fn
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * 侧车写盘（原子：临时文件 + rename）—— 与发射器同口径。
 *
 * BUG-196：本函数是根侧车的**唯一写者** ⇒ 落盘内容 = 判定内容 = 预览内容。
 */
function writeSidecarAtomic(sidecarPath: string, content: string): void {
  const tmp = `${sidecarPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
  try {
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, sidecarPath);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
    throw e;
  }
}

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
  const { emitInterface, emitDerivedFromRoot, unifiedDiff } = await import(
    "@nudojs/service/emit"
  );
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
  const { localNamedExports, sidecarPathOf } = await import("@nudojs/core");
  let localExports: Set<string> | undefined;
  if (fnNames) {
    try {
      localExports = localNamedExports(readFileSync(filePath, "utf-8"));
    } catch {
      /* optional: local export scan failed — keep requested fn names */
    }
  }

  /** 侧车文本（不存在 ⇒ 空串）——**净效果**判定的唯一依据：写前 vs 写后。 */
  const readSidecarText = (p: string): string => {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      return "";
    }
  };
  /**
   * 本命令开始前的根侧车内容（BUG-122 / BUG-196 的**基准**）。
   *
   * 派生分支与直写分支不再各写一次：本函数是根侧车的**唯一写者**，最终文本
   * M 在这份快照之上算出来（直写分支永远 dry-run，派生分支只做段级合并），
   * 判定 = `M !== rootSidecarBefore`（逐字）⇒ 报告、预览、落盘三者同源。
   */
  const rootSidecarPath = resolve(sidecarPathOf(filePath));
  const rootSidecarBefore = readSidecarText(rootSidecarPath);

  let derivedChanged = false;
  /** 派生分支的人类面输出行（**判定之后**再打印 ⇒ 用法错误时只有错误面） */
  const derivedLines: string[] = [];
  /** `--json` 面：派生分支的顶层诊断 */
  const derivedIssues: Array<{
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
  }> = [];

  // -------------------------------------------------------------------------
  // BUG-196 —— 根侧车**只有一个写者**（= 本函数）
  //
  // 旧实现：派生分支（`emitDerivedFromRoot`）与直写分支（`emitInterface`）
  // **各写一次**同一侧车的同一段 ⇒ 两段格式不同（派生段 4 行、含
  // `// derived-from:` 溯源行；直写段 3 行、无）⇒ 后写者把前者的溯源行
  // **整段抹掉** ⇒
  //   ① 派生分支算出的溯源行**永不落盘**；
  //   ② 落盘净变化为 0，报告却说「Updated」（台账被污染，BUG-122）；
  //   ③ `--dry-run` 预览与真实写盘**不同源** ⇒ `--exit-on-diff` 恒红。
  //
  // 新实现（单写者 + 同源）：
  //   ① 直写分支**永远 dry-run**（它只**算**：产出 diff）⇒ 本函数把它的
  //      diff 还原成产物文本 D（`applyUnifiedDiff`；旧侧逐行核对不上就
  //      放弃写盘 ⇒ fail-closed）。
  //   ② 派生分支以 **D 为基底**算最终文本 M（`baseContent` 注入）⇒ 段级
  //      合并在**直写分支的正文**上做：直写分支负责的段**不整段覆盖**，只把
  //      `// derived-from:` 标签行并进去（`directSections`）⇒ 溯源行落盘，
  //      且不与直写正文打架（直写分支优先）。
  //   ③ 根侧车由本函数写（派生分支 `skipWrite` 跳过它）⇒ **同一侧车同一段
  //      只有一个写者**；落盘内容 = 判定内容 = 预览内容（M）⇒ 同源。
  // -------------------------------------------------------------------------

  // ---- ① 直写分支（永远 dry-run：它只算，不写盘）----
  const result = await emitInterface(filePath, {
    // `--fn` 名单**原样**下传（改前：过滤后为空 ⇒ 降级成 undefined ⇒ 作用域放大）
    ...(fnNames ? { fnNames } : {}),
    mode: "update",
    all: opts.all,
    dryRun: true,
    records: opts.records,
  });
  const sc = relative(process.cwd(), result.sidecarPath) || result.sidecarPath;
  /**
   * 直写分支的产物文本 = 发射器回报的**最终写盘文本**（含 BOM）。
   * BUG-196：不再从 `diff` 反解自身产物 —— 合并基底与落盘内容必须同源。
   */
  const directContent = result.finalContent;
  /** 直写分支负责的段（它的正文优先 ⇒ 派生分支只并溯源标签行，不整段覆盖） */
  const directOwned = new Set<string>([
    ...result.written,
    ...result.skipped.filter((s) => s.reason === "no-change").map((s) => s.fn),
  ]);

  // ---- ② 派生分支：基底 = 直写分支的产物（= 真写盘时的基底）----
  // 派生侧车（root 驱动）：`--fn` 白名单**原样**下传 ⇒ 它的作用域天然受限
  // （未命中的名字在派生侧没有任何目标 ⇒ 派生侧车不会被写）。
  const derived = emitDerivedFromRoot(filePath, {
    ...(fnNames ? { fnNames } : {}),
    mode: "update",
    dryRun: opts.dryRun,
    ...(!(fnNames || opts.all) ? { refreshExistingOnly: true } : {}),
    // 基底 = 直写分支的产物 ⇒ 派生分支算出的最终文本与真写盘的内容同源
    ...(directContent !== undefined
      ? {
          baseContent: (p: string) =>
            resolve(p) === rootSidecarPath ? directContent : undefined,
        }
      : {}),
    // 根侧车由本函数写（唯一写者）⇒ 派生分支只算不写
    skipWrite: [rootSidecarPath],
    // 直写分支负责的段：派生分支只并溯源标签行，不整段覆盖
    directSections: directOwned,
  });
  /** 派生侧命中的名字（合法的「下游导出名」用法） */
  const derivedMatched: string[] = [];
  type DerivedSidecar = (typeof derived.sidecars)[number];
  /**
   * 派生分支的逐侧车条目。**根侧车**的净变化由本函数统一判定（M vs 写前），
   * 下游侧车由派生分支独写 ⇒ 它自己的 `changed` 就是净效果。
   */
  const derivedEntries: Array<{ sc: DerivedSidecar; scRel: string; rootOwned: boolean }> = [];
  if (derived.hasRoot) {
    for (const i of derived.issues ?? []) derivedIssues.push(i);
    for (const sc of derived.sidecars) {
      const scRel = relative(process.cwd(), sc.sidecarPath) || sc.sidecarPath;
      // `sc.fn` 是**同侧车一组导出名的逗号拼接** ⇒ 按名单比对必须先拆开
      for (const n of splitDerivedFns(sc.fn)) {
        if (fnNames && fnNames.includes(n)) derivedMatched.push(n);
      }
      derivedEntries.push({ sc, scRel, rootOwned: resolve(sc.sidecarPath) === rootSidecarPath });
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

  // -------------------------------------------------------------------------
  // BUG-122 / BUG-196 —— **净效果**口径（落盘内容 = 判定内容 = 预览内容）
  //
  // 派生分支与直写分支不再各写一次：根侧车由**本函数**写（唯一写者），最终
  // 文本 M = 派生分支在**直写分支产物 D**之上算出的文本 ⇒
  //   - 判定基准是 M（写前 vs 写后逐字），不是任何分支的中间态；
  //   - `--dry-run` 打印的 diff 就是 M 的 diff ⇒ 预览与落盘**逐字节同源**；
  //   - `--exit-on-diff` 只在 M ≠ 写前时 exit 1 ⇒ 收敛后恒 exit 0。
  // -------------------------------------------------------------------------
  /** 派生分支对根侧车的条目（M 的来源） */
  const rootDerived = derived.sidecars.find((d) => resolve(d.sidecarPath) === rootSidecarPath);
  /**
   * 根侧车的最终文本 M（= 真写盘的内容）。
   *
   * 派生分支给出它算的文本就用它（段级合并已把 `derived-from` 标签行并进
   * 直写段）；派生侧**没有**条目（无 root / 无行）或装配自检没过（它自己
   * 拒绝写）⇒ 退回直写分支的产物 D（D 是合法的侧车文本，标签行这一轮不
   * 落地，诊断照报）。
   */
  let finalContent: string | undefined =
    directContent !== undefined ? (rootDerived?.finalContent ?? directContent) : undefined;
  // BOM 保全：派生分支重排段时可能把首行的 BOM 带走 ⇒ 写盘前补回
  if (
    finalContent !== undefined &&
    rootSidecarBefore.startsWith("\uFEFF") &&
    !finalContent.startsWith("\uFEFF")
  ) {
    finalContent = `\uFEFF${finalContent}`;
  }
  /** 净效果（写前 vs 写后逐字）——**唯一**的判定依据 */
  const netRootChanged = finalContent !== undefined && finalContent !== rootSidecarBefore;
  /** 净 diff（预览 = 落盘 ⇒ 逐字节同源） */
  const netDiff =
    netRootChanged && finalContent !== undefined
      ? unifiedDiff(rootSidecarBefore, finalContent, sc)
      : undefined;

  for (const i of derivedIssues) {
    if (!jsonMode) derivedLines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
  }
  /** `--json` 面：派生侧车的机器文档（人类面不产这些行） */
  const derivedDocs: Array<Record<string, unknown>> = [];
  for (const e of derivedEntries) {
    const { sc: dsc, scRel } = e;
    // 根侧车：本函数写（唯一写者）⇒ 净变化由主摘要报（这里不重复报）
    // 下游侧车：派生分支是唯一写者 ⇒ 它的 `changed` 就是净效果
    const lands = e.rootOwned ? netRootChanged : dsc.changed;
    if (jsonMode) {
      derivedDocs.push({
        sidecar: scRel,
        fn: dsc.fn,
        // 机器面同口径：净效果为 0 的中间态不得报 `changed`
        changed: lands,
        written: lands ? dsc.written : false,
        ...(dsc.skipped ? { skipped: dsc.skipped } : {}),
        ...(lands && (e.rootOwned ? netDiff : dsc.diff) !== undefined
          ? { diff: e.rootOwned ? netDiff : dsc.diff }
          : {}),
        issues: dsc.issues,
      });
    } else if (e.rootOwned) {
      // 根侧车的净变化由主摘要（`Updated …` / `no interface changes`）报
      // ⇒ 这里只保留诊断行，不重复报一次「Updated」。
    } else if (lands) {
      if (opts.dryRun) {
        derivedLines.push(
          `[dry-run] would update ${scRel} (derived-from ${derived.roots.join(", ")}):`,
        );
        derivedLines.push(dsc.diff ?? "");
      } else {
        derivedLines.push(
          `Updated ${rel} → ${scRel} (derived-from ${derived.roots.join(", ")})`,
        );
        derivedLines.push(`  written: ${dsc.fn}`);
      }
    } else {
      derivedLines.push(`${scRel}: no derived contract changes (${dsc.skipped ?? "no-change"})`);
    }
    for (const i of dsc.issues) {
      if (!jsonMode) derivedLines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
      // design §1.3：contract 只读/emit 不因分析诊断挡 CI；
      // 仅 usage/IO 与 --exit-on-diff（且须 --dry-run）影响 exit
    }
    // §1.3「将写盘且有 diff → 1」：只认**净效果**（中间态不算）
    if (lands && !e.rootOwned) derivedChanged = true;
  }

  // 判定之后才打印派生分支的输出（用法错误时输出面只有错误面）
  for (const line of derivedLines) console.log(line);

  // 根侧车的**唯一写者**：落盘内容 = 判定内容 = 预览内容（M）。
  if (!opts.dryRun && netRootChanged && finalContent !== undefined) {
    writeSidecarAtomic(rootSidecarPath, finalContent);
  }

  // 主摘要的口径 = **净效果**（M vs 写前）：直写分支的中间态（它自己的 diff）
  // 不是净效果 ⇒ 不得报 `Updated`（改前每次都打印 `Updated … written: …`，
  // 而写前/写后内容逐字相同 ⇒ 审计台账被污染，BUG-122）。
  const mainResult: typeof result = {
    ...result,
    changed: netRootChanged,
    // 台账 = 真写进 M 的导出名：直写分支写的 ∪ 派生分支在根侧车上并进去的
    written: netRootChanged
      ? [...new Set([...result.written, ...(rootDerived?.writtenNames ?? [])])]
      : [],
    diff: netDiff,
  };

  if (jsonMode) {
    // 族 20 · Bug 667：机器面 = **单文件文档**（与 print / draft 分支同构：
    // `file` + 该分支的字段；命令层的聚合层把它收进恒定数组外壳）。
    // 人类文本**一律不打印** ⇒ stdout 恒为一份合法 JSON。
    console.log(
      JSON.stringify(
        {
          file: rel,
          sidecar: sc,
          changed: mainResult.changed,
          written: mainResult.written,
          skipped: mainResult.skipped.map((s) => ({ fn: s.fn, reason: s.reason })),
          // BUG-035 残留收口：证据消失 ⇒ 生成段被删（不是「保留原段」），
          // 机器面必须能看见删除清单（人类面走 formatEmitSummary 的 `removed:` 行）。
          ...(mainResult.removed && mainResult.removed.length > 0
            ? { removed: mainResult.removed }
            : {}),
          issues: mainResult.issues,
          ...(mainResult.diff !== undefined ? { diff: mainResult.diff } : {}),
          ...(mainResult.emptyDefaultTargets ? { emptyDefaultTargets: true } : {}),
          ...(derivedDocs.length > 0 ? { derived: derivedDocs } : {}),
          ...(derivedIssues.length > 0 ? { derivedIssues } : {}),
        },
        null,
        2,
      ),
    );
  } else if (mainResult.changed && opts.dryRun) {
    // 族 20 · Bug 662：预览标签取**侧车**（改前取源文件 ⇒ 标签与 diff 头
    // 指向两个不同文件；同文件另两分支都取侧车 ⇒ 单点笔误，不是取舍）。
    console.log(`[dry-run] would update ${sc}:`);
    console.log(mainResult.diff ?? "");
    for (const i of mainResult.issues) {
      console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
    }
    for (const s of mainResult.skipped) {
      // 与 `formatEmitSummary` / LSP agent 面同款文案（改前是 `skipped <fn>: <reason>`）
      console.log(`  skipped ${s.fn} (${s.reason})`);
    }
  } else {
    for (const line of formatEmitSummary(rel, sc, mainResult)) console.log(line);
  }
  // Bug 508：诊断的**唯一渲染点**是 formatEmitSummary（它渲染后即消费
  // result.issues）。这里再遍历一次会让同一条诊断出两遍（dry-run 路径尤其
  // 明显：上面已逐条打印过 error 级）。故不再有第二个渲染点。
  const anyChanged = mainResult.changed || derivedChanged;
  if (opts.exitOnDiff && anyChanged) process.exitCode = 1;
  if (anyChanged && !opts.dryRun && !jsonMode) {
    console.log(`  re-run \`nudo check ${rel}\` to see the persisted contracts in action`);
  }
}
