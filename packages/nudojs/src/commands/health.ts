/**
 * nudo health — 项目体检：未覆盖函数、witness drift、契约 drift、分析错误。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, statSync, type Stats } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import type { Command } from "commander";
import { analyzeFileAsync, type CallRecord } from "@nudojs/service";
import type { RunTranspiledOptions } from "@nudojs/core";
import { paintOne } from "../ui.ts";
import { projectConfigShapeIssue } from "../config-shape.ts";
import { budgetAttributionSegs, DIAG, type AbsBudgetStats } from "@nudojs/core/internal";
import {
  collectExternalRecords,
  emitJsonDoc,
  reemitUpdate,
  resolveTargetsCollect,
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
  /**
   * 682：见证漂移计数。
   *  - `added`   = 新侧变更条数（真正新增 + 同一调用点但内容被改写）
   *  - `removed` = 旧侧删除条数（旧侧独有的调用点）
   *  - `changed` = `added` 里「同一调用点但内容被改写」的条数（机器面可拆分 new/changed）
   * ⇒ `added + removed` == **实际变更条数**（旧口径把「同一条见证被改写」
   * 计成 2：+1 new / -1 removed ⇒ 只改 1 条见证却报「2 条变更」）。
   */
  drift?: { added: number; removed: number; changed: number };
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
  /**
   * 683：本文件里已固化的生成见证（`call@…`）条数——**判定信号**：
   * 「有冻结见证 + 拿不到任何调用点证据」⇒ 无法判定漂移（不是「无漂移」）。
   * 没有冻结见证时无可判定项（0 drift 属实）。
   */
  frozenWitnesses?: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// 682：见证漂移计数（见证身份 = 调用点）
// ---------------------------------------------------------------------------

/** 生成见证行识别——与 service/emit/case-emitter.ts 的 GENERATED_CASE_LINE_REGEX 同口径 */
const GENERATED_WITNESS_LINE = /^\s*\*?\s*@nudo:case\s+"(call@[^"]*)"/;

type Witness = { name: string; text: string };

function parseWitnesses(texts: string[]): Witness[] {
  const out: Witness[] = [];
  for (const raw of texts) {
    const m = /@nudo:case\s+"([^"]*)"/.exec(raw);
    if (!m) continue;
    out.push({ name: m[1] ?? "", text: raw.trim() });
  }
  return out;
}

/** 旧侧：源文件里已固化的生成见证行（BOM 先剥离——与 emit 侧 strip 同口径） */
function sourceWitnesses(source: string): Witness[] {
  const body = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return parseWitnesses(body.split(/\r?\n/).filter((l) => GENERATED_WITNESS_LINE.test(l)));
}

/**
 * 见证身份 = **调用点行号**（见证名里的 `L<行号>` 后缀）。
 *
 * 见证名带不带现场文件前缀（`call@<site>:L<n>` vs `call@L<n>`）只是**命名方案**
 * 的差异（service 侧 `callsiteCaseName` 的两种形态：调用点在本文件内 / 在
 * `--from` 现场文件里）——**同一调用点**不得因此被计成「+1 new / -1 removed」
 * 两条变更（682）。`call@symbolic` 之类无行号的见证名按原名当身份。
 */
function witnessKey(name: string): string {
  const m = /^call@[^:]*:L(\d+)$/.exec(name);
  return m ? `call@L${m[1]}` : name;
}

/**
 * 见证漂移计数（682）：按**见证身份（调用点）**逐条比对旧/新两侧。
 *
 * 旧口径 `added = 新写出的见证条数` + `removed = 被删的见证条数` 是「新集合大小 +
 * 旧集合大小」的**和式**——把同一条见证的「改写」拆成 +1 new 与 -1 removed 各
 * 计一次 ⇒ 只改 1 条见证却报「2 条变更」（且与同屏 Summary 的「1 case drift」
 * 自相矛盾）。
 * 新口径（两侧都从**源码**取见证——`newSource` = 重新固化后的源码）：
 *  - 身份相同 + 内容相同 ⇒ 未变；
 *  - 身份相同 + 内容不同 ⇒ **改写**（只计 1 次，计入新增侧）；
 *  - 新侧独有的身份 ⇒ 新增；旧侧独有的身份 ⇒ 删除。
 * ⇒ `added + removed` == **实际变更条数**（文本面 `added + removed` 口径自洽）。
 */
function witnessDrift(
  oldSource: string,
  newSource: string,
): { added: number; removed: number; changed: number } {
  const oldWs = sourceWitnesses(oldSource);
  const newWs = sourceWitnesses(newSource);
  const used = new Array<boolean>(oldWs.length).fill(false);
  let added = 0;
  let changed = 0;
  for (const w of newWs) {
    const key = witnessKey(w.name);
    const same = oldWs.findIndex((o, i) => !used[i] && witnessKey(o.name) === key && o.text === w.text);
    if (same >= 0) {
      used[same] = true;
      continue;
    }
    const sameKey = oldWs.findIndex((o, i) => !used[i] && witnessKey(o.name) === key);
    if (sameKey >= 0) {
      used[sameKey] = true;
      changed += 1;
    }
    added += 1;
  }
  const newKeys = new Set(newWs.map((w) => witnessKey(w.name)));
  let removed = 0;
  for (let i = 0; i < oldWs.length; i++) {
    if (used[i]) continue;
    if (!newKeys.has(witnessKey(oldWs[i].name))) removed += 1;
  }
  return { added, removed, changed };
}

/**
 * 691：health 的**契约漂移判定**必须走 mock 通道——与 `nudo check` 的
 * buildCheckInjection **同口径**（模块图 + mocks + env 全局 + replace/as）。
 * 否则同一份陈旧生成段，`nudo check` 报 `nudo:interface-drift` 而 `nudo health`
 * 报 0 contract drift / OK / exit 0（假绿 + 跨动词自相矛盾）。
 */
async function buildHealthInjection(
  filePath: string,
  source: string,
): Promise<RunTranspiledOptions> {
  const {
    applyMockModuleDirectivesFromSource,
    collectEnvGlobals,
    collectEnvModules,
    collectEnvNames,
    collectEvalReplacements,
    evalAbsModuleGraph,
    findProjectConfig,
    mockDirectivesToAbsSeeds,
    mockSeedsToAbsMocks,
  } = await import("@nudojs/service");
  const { extractDirectives, extractFileDirectives, parse } = await import("@nudojs/parser");
  const { preloadPathEnvs } = await import("@nudojs/service/evaluator");
  const allEnvNames = collectEnvNames(filePath, source, true);
  const proj = findProjectConfig(dirname(filePath));
  await preloadPathEnvs(allEnvNames, proj?.projectDir ?? dirname(filePath));
  const graph = evalAbsModuleGraph(source, filePath);
  const reps = collectEvalReplacements(source, { diags: [] });
  const ast = parse(source);
  const seedPkg = mockDirectivesToAbsSeeds(extractDirectives(ast), { fromFile: filePath });
  // 文件级指令（@nudo:env / @nudo:mock-module）提取——与 check 同口径
  extractFileDirectives(ast);
  const mocks = mockSeedsToAbsMocks(seedPkg);
  const envGlobals = collectEnvGlobals(allEnvNames);
  const envMods = collectEnvModules(allEnvNames);
  let mergedMods = {
    ...graph.modules,
    ...(Object.keys(envMods).length > 0 ? envMods : {}),
  };
  const mm = applyMockModuleDirectivesFromSource(source, mergedMods, { fromFile: filePath });
  mergedMods = mm.modules;
  return {
    ...(Object.keys(mergedMods).length > 0 ? { modules: mergedMods } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    ...(Object.keys(envGlobals).length > 0 ? { envGlobals } : {}),
    ...(reps.targets.length > 0
      ? { replacements: reps.values, replacementTargets: reps.targets }
      : {}),
    ...(reps.asTargets.length > 0
      ? { asOverrides: reps.asValues, asOverrideTargets: reps.asTargets }
      : {}),
  };
}

async function healthFile(filePath: string, records?: CallRecord[]): Promise<HealthReport> {
  const report: HealthReport = { file: displayPathOf(filePath), functions: 0, entryOnly: 0, uncovered: [] };
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    report.error = (err as Error).message;
    return report;
  }
  // 683：已固化的生成见证条数（判定「有无待验证的冻结见证」）
  report.frozenWitnesses = sourceWitnesses(source).length;
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
    // 949：uncovered = 「**无调用点证据**（回落 entry@）」的函数——文档
    // guides/health.md:22 的定义（Uncovered functions ⇒ Entry fallback）。
    // 旧过滤式 `cases.length === 0 && !skipped && !entryOnly` 的三个条件在
    // health 的分析口径下互斥覆盖全集（要么有 entry@ 见证、要么有 call@ 见证）
    // ⇒ uncovered 恒为 []（死字段）：文档承诺的「uncovered ⇒ Reported」永不成立。
    report.uncovered = result.functions
      .filter((fn) => !fn.skipped && fn.entryOnly === true)
      .map((fn) => fn.name);
    {
      const b = getAbsCallBudgetStats();
      report.budget = { ...b };
    }
    {
      // D6-A：internal 回落是缺陷指标（接受暴露），不吞、不单独 fail
      report.internalFallbacks = getEvalFallbackStats().internal;
    }
    // 674：**分析错误**（analyzer 的 error 级诊断：侧车加载失败 / mock-module
    // 失败 / …）必须进 health 的判定面。旧口径一条都不计 ⇒ 坏掉的侧车在
    // health 面绿灯（假绿）；而 `nudo check` 对同一路径报 nudo:interface-load。
    // 口径 = guides/health.md:18 的 health 门（Analysis errors）。
    const analysisErrors = result.diagnostics.filter((d) => d.severity === "error");
    if (analysisErrors.length > 0) {
      report.error = analysisErrors.map((d) => `${d.message} (${d.code})`).join("; ");
    }
    if (records) {
      const { emitOut } = await reemitUpdate(filePath, source, records);
      if (emitOut.source !== source) {
        // 682：实际变更条数（见证身份 = 调用点）——不是「新集合 + 旧集合」
        // 旧/新两侧都从**源码**取见证（emitOut.source = 重新固化后的源码），
        // 逐条按（身份, 指令文本）比对。
        const d = witnessDrift(source, emitOut.source);
        if (d.added > 0 || d.removed > 0 || d.changed > 0) report.drift = d;
      }
    }
    const drift = await countInterfaceDrift(filePath);
    report.interfaceDrift = drift.count;
    if (drift.error) {
      report.error = report.error ? `${report.error}; ${drift.error}` : drift.error;
    }
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
    // 691：契约漂移判定必须走 **mock 通道**（与 nudo check 的 buildCheckInjection
    // 同口径）——否则同一份陈旧生成段，check 报 nudo:interface-drift 而 health
    // 报 0 contract drift / OK / exit 0（假绿 + 跨动词自相矛盾）。
    const inject = await buildHealthInjection(abs, source);
    const r = checkSource(abs, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: abs,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(Object.keys(inject).length > 0
        ? { modules: inject.modules as never, inject }
        : {}),
      // 与 nudo check 同源：@nudo:skip 的函数不评估 body，不产出 drift 候选
      skips: collectSkipReturns(source),
    });
    return { count: r.issues.filter((i) => i.code === DIAG.interfaceDrift).length };
  } catch (e) {
    return { count: 0, error: `checkSource failed: ${(e as Error).message}` };
  }
}

/**
 * `nudo health` 的**一轮**执行（文本面 + `--json` 面共用同一份事实）。
 *
 * **`--json` 面的机器契约（族 63）**：
 * - `pathErrors[]`：**路径级错误全集**（`--from` 路径错误 + **分析目标闸门**
 *   错误 + 「无法判定漂移」证据错误）。**字段名与内容逐字不变**（兼容既有
 *   机器消费者）——名字只承诺「path」层错误，不只承诺「--from」层。
 * - `targetErrors[]`（**新增·可选**）：`pathErrors[]` 里**分析目标闸门**那部分
 *   （非分析目标 / 空目录 / 路径不存在）的**精确**入口 ⇒ 语义可见、旧字段兼容。
 * - `summary.drift`：单位 = **见证（case）条数**（= Σ `files[].drift.(added+
 *   removed)` = 文本面 Summary 的「N case drift」）⇒ 文本面 / JSON 面 /
 *   每文件明细行**同一个数字、同一个量纲**。
 * - **watch 面**（`--watch --json`）：stdout = **JSON Lines**（一行一份完整
 *   JSON 文档）；**非 watch 面** = 一份 pretty 文档（既有形态，逐字不变）。
 */
async function runHealth(
  paths: string[],
  opts: { from?: string[]; json?: boolean; jsonLines?: boolean },
): Promise<void> {
  const targetPaths = paths.length > 0 ? paths : ["."];
  // 路径错误 sink（不直接设 exit），ok↔exit 单一来源；check/test 同规。
  // 683/947/948 三条都进这个 sink：--from 路径错误、**目标闸门**错误
  // （非分析目标 / 空目录）——文本面打 stderr（message + fix），
  // --json 面进 pathErrors[]（机器消费者拿得到原因，不只是 ok:false）。
  //
  // 63：**sink 拆成两摊**（内部命名不再漂移，`pathErrors[]` 的**名字**与
  // **内容**不再互相矛盾）：
  //  - `pathErrorSink` = **有序**的路径级错误全集（= JSON 面 `pathErrors[]`
  //    的内容；**字段名与内容逐字不变** ⇒ 既有机器消费者零影响）。
  //  - `targetErrors`  = 其中的**分析目标闸门**子集（非分析目标 / 空目录 /
  //    路径不存在）——**新增**的可选 JSON 字段 `targetErrors[]` 让这层语义
  //    **对机器消费者可见**（旧字段继续兼容，两份内容一致 ⇒ 不丢事实）。
  const pathErrorSink: PathError[] = [];
  const targetErrors: PathError[] = [];
  const externalRecords = opts.from?.length
    ? collectExternalRecords(opts.from, pathErrorSink)
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
    // 947/948：**分析目标闸门**（与 nudo check / nudo test 同口径）——
    //  · 侧车（*.nudo.js）/ .d.ts 声明 / .jsx 不是「已检查的源文件」：
    //    旧口径把它们当分析目标 ⇒ health 报 Result: OK / exit 0，而 check/test
    //    对同一路径 exit 1「Not an analysis target」（假绿 + 跨动词自相矛盾）。
    //  · 空目录 = 一个文件都没检查 ⇒ 空集 ≠ 一切正常（不能发绿灯通行证）。
    // 两类都产出 check/test **同款**的 PathError（同样的 message / suggestion）。
    const { targets, errors } = resolveTargetsCollect(p);
    pathErrorSink.push(...errors);
    targetErrors.push(...errors);
    files.push(...targets);
  }
  for (const filePath of files) {
    reports.push(await healthFile(filePath, externalRecords));
  }
  // 683：--from 给了却**一条调用记录都没有** ⇒ 「无法判定漂移」，**不是**「无漂移」。
  // 旧口径把「零记录」当成「没有 --from」（records 为 undefined ⇒ 整段漂移检测
  // 被跳过）⇒ 见证早已陈旧仍报 0 case drift / Result: OK / exit 0（假绿）。
  // 判据：只有**存在待验证的冻结见证**时才判「无法判定」——没有冻结见证时
  // 「0 drift」属实（不得因此给合法用法发假红）。
  const frozenWitnessTotal = reports.reduce((n, r) => n + (r.frozenWitnesses ?? 0), 0);
  if (opts.from?.length && pathErrorSink.length === 0 && !externalRecords && frozenWitnessTotal > 0) {
    pathErrorSink.push({
      path: resolve(opts.from[0]),
      code: DIAG.pathMissingCallsite,
      message: `Cannot determine witness drift: --from produced no call-site records (${opts.from.join(", ")})`,
      suggestion: `pass --from <usage-site file> that actually calls the analyzed functions; frozen call@ witnesses cannot be validated without call-site evidence`,
    });
  }

  // 63：漂移计数**两个量纲**分开算：
  //  - `driftCases` = 漂移的**见证（case）条数** = Σ 各文件明细行的
  //    「N witness directive(s) changed」⇒ **与明细行同量纲**。
  //  - 有漂移的**文件数**不再单独计数：门禁判据用 `driftCases > 0`
  //    （⇔ 旧口径的「有漂移的文件数 > 0」，两者恒等 ⇒ 判红口径不变）。
  // 旧口径 Summary 印「**有漂移的文件数**」而明细行印「**见证条数**」⇒
  // 同一份报告里两个「N」量纲不同（用户读到的数自相矛盾）。
  // 现在 Summary 印 `driftCases`：标签「case drift」= 一条 `@nudo:case`
  // 见证指令 ⇒ **标签与数字终于同义**（数字 == Σ 明细行的条数）。
  const driftCases = reports.reduce(
    (n, r) => n + (r.drift ? r.drift.added + r.drift.removed : 0),
    0,
  );
  const ifaceDriftCount = reports.filter((r) => (r.interfaceDrift ?? 0) > 0).length;
  const errorCount = reports.filter((r) => r.error).length;
  const uncoveredTotal = reports.reduce((n, r) => n + r.uncovered.length, 0);
  const failed = driftCases > 0 || ifaceDriftCount > 0 || errorCount > 0;
  // ok↔exit 单一来源：pathErrors 非空 ⇒ ok:false（绝不 ok:true + 非零 exit）
  const ok = !failed && pathErrorSink.length === 0;
  // exit 只由 ok 决定（单一来源）；--json / 非 JSON 共用
  process.exitCode = ok ? 0 : 1;

  // 687：错误计数**单一来源**——文件内 error + 路径级错误（--from 路径错误 +
  // 分析目标闸门错误）。
  // 文本面与 --json 面必须报同一个数字（同一次运行不得给两个结论）。
  const totalErrors = errorCount + pathErrorSink.length;
  // 925：budget 截断快照（与 `nudo check --json` 的 budget 同源同义）——
  // 文本面报了「budget truncated / 结果被宽化」，机器面必须也拿得到
  // truncated 标志（否则机器消费者读到一份「干净」的健康报告）。
  const budgetTruncated = reports.some((r) => r.budget?.truncated === true);

  if (opts.json) {
    emitJsonDoc(
      {
        ok,
        // 63：`pathErrors[]` **逐字不变**（字段名 + 内容 + 顺序）——既有机器
        // 消费者零影响。它是**路径级错误全集**（--from 路径错误 + 分析目标
        // 闸门错误 + 「无法判定漂移」证据错误），名字只说「path」不只说
        // 「--from」⇒ 精确语义由下面的 `targetErrors[]` 给出。
        ...(pathErrorSink.length > 0
          ? {
              pathErrors: pathErrorSink.map((e) => ({
                path: e.path,
                code: e.code,
                message: e.message,
                suggestion: e.suggestion,
              })),
            }
          : {}),
        // 63：**新增**的可选字段——「分析目标闸门」错误（非分析目标 / 空目录 /
        // 路径不存在）的**精确**入口。内容是 `pathErrors[]` 的子集（旧字段
        // 继续兼容 ⇒ 不丢事实；新消费者可按语义分流）。
        ...(targetErrors.length > 0
          ? {
              targetErrors: targetErrors.map((e) => ({
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
          ...(r.budget ? { budget: { ...r.budget } } : {}),
          ...(r.internalFallbacks !== undefined ? { internal_fallbacks: r.internalFallbacks } : {}),
          ...(r.configShape ? { configShape: r.configShape } : {}),
          ...(r.error ? { error: r.error } : {}),
        })),
        summary: {
          files: reports.length,
          // 63：单位 = **见证（case）条数**（与文本面 Summary、与
          // Σ files[].drift.(added+removed) 同量纲）⇒ 三个面同一个数字。
          drift: driftCases,
          interfaceDrift: ifaceDriftCount,
          errors: totalErrors,
          uncovered: uncoveredTotal,
          ...(budgetTruncated ? { budgetTruncated: true } : {}),
          internal_fallbacks: reports.reduce((n, r) => n + (r.internalFallbacks ?? 0), 0),
        },
      },
      // 63：watch 面 ⇒ **JSON Lines**（一行一份完整 JSON 文档；第 2 轮起
      // stdout 里会累积第 2 份文档 ⇒ 整份 JSON.parse(stdout) 会炸）。
      // 非 watch 面仍是**一份 pretty 文档**（既有形态，逐字不变）。
      opts.jsonLines === true,
    );
  } else {
    // 路径级错误上屏（usage face，与 check/test 一致）；ok:false 已在上方挡 exit
    for (const e of pathErrorSink) {
      console.error(e.message);
      console.error(`fix:  ${e.suggestion}`);
    }
    if (reports.length === 0) {
      if (pathErrorSink.length > 0) {
        console.log("Result: FAIL (path errors found)");
      } else {
        console.log("No files to check.");
        // 空目标集（Bug 948）⇒ `ok:false` + 非零 exit ⇒ 文本面**必须**有
        // 裁决行，否则出现「exit 1 但无 Result / 无 Summary」⇒ 与 JSON 面
        // 的 `ok:false` 不对称（机器面红、人类面沉默）。
        console.log(`\nSummary: 0 file(s) · 0 case drift · 0 contract drift · ${totalErrors} error(s) · 0 uncovered function(s)`);
        console.log("Result: FAIL (no files to check)");
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
    // 63：Summary 的漂移数 = **见证（case）条数**（= Σ 明细行的
    // 「N witness directive(s) changed」）⇒ 与明细行**同量纲**（旧口径印的是
    // 「有漂移的文件数」⇒ 同一份报告里两个「N」互相矛盾）。
    console.log(
      `\nSummary: ${reports.length} file(s) · ${driftCases} case drift · ${ifaceDriftCount} contract drift · ${totalErrors} error(s) · ${uncoveredTotal} uncovered function(s)` +
        (internalTotal > 0 ? ` · ${internalTotal} internal_fallback(s)` : ""),
    );
    // ok↔exit 单一来源：pathErrors / drift / errors 任一存在都不得报 OK
    console.log(
      ok
        ? "Result: OK (uncovered function(s) are informational only)"
        : pathErrorSink.length > 0 && !failed
          ? "Result: FAIL (path errors found)"
          : "Result: FAIL (drift or errors found)",
    );
  }
}

/**
 * 路径存在性（ENOENT ⇒ 缺失；EACCES/EIO 等 ⇒ **不算**缺失——
 * 那是「不可访问」，由分析面报「Cannot access」，不得伪装成「不存在」）。
 */
function pathIsMissing(p: string): boolean {
  try {
    return statSync(resolve(p), { throwIfNoEntry: false }) === undefined;
  } catch {
    return false;
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
      // 688：--from 的多值语义与 check / contract **同口径**——
      //  - 多文件 --from（`nudo health lib.js --from a.js b.js`）：**接受**。
      //    「多 from 文件」不是「variadic 吞噬位置参数」：目标路径写在旗标
      //    之前时不存在歧义（要再补位置路径用 `--` 终止符）。旧实现把
      //    多值当吞噬 ⇒ 文案失实（paths 明明收到了）+ 与 check/contract 分叉。
      //  - paths 为空：没有任何分析目标 ⇒ usage error（--from 下不得静默
      //    扫 cwd：freeze-drift 范围错误）。多值时沿用 check/test/contract
      //    同款 variadic 面（此处「received no paths」**属实**）。
      if (opts.from?.length) {
        if (paths.length === 0) {
          if (opts.from.length > 1) {
            variadicSwallowError("health", ["--from"]);
          } else {
            console.error(
              "error: `nudo health` --from requires explicit paths when used without positional paths " +
                "(previously defaulted to cwd scan)",
            );
            console.error("fix:  use: `nudo health . --from usage.js`");
          }
          process.exitCode = 1;
          return;
        }
        if (opts.from.length > 1) {
          // 如实告知多值归属：--from 之后的裸 token **全部**按使用点文件处理
          // （位置路径必须写在 --from 之前）——不得静默换一个分析目标。
          console.error(
            `note: \`nudo health --from\` received ${opts.from.length} usage-site files (${opts.from.join(", ")}); positional paths must be listed before \`--from\``,
          );
        }
      }
      const fromPaths = opts.from;
      const runOptions = { ...(fromPaths ? { from: fromPaths } : {}), json: opts.json };
      if (opts.watch) {
        const watchPaths = paths.length > 0 ? paths : ["."];
        // 63：watch 面 ⇒ stdout 是**流** ⇒ `--json` 走 **JSON Lines**
        // （一行一份完整 JSON 文档；第 2 轮起 stdout 里会累积第 2 份文档
        // ⇒ 整份 `JSON.parse(stdout)` 抛 "Unexpected non-whitespace
        // character after JSON"）。非 watch 面仍是**一份 pretty 文档**。
        const watchOptions = { ...runOptions, jsonLines: true };
        // 927：缺失路径必须在 watch 装上**之前**报告——watch 的文件收集会
        // 跳过不存在的路径 ⇒ 「File not found」报告不可达 ⇒ 静默空会话
        // （exit 0 / 零报告 / 假绿）。与无 watch 面同口径：同一份报告 + 红。
        if (watchPaths.some((p) => pathIsMissing(p))) {
          await runHealth(paths, watchOptions);
          return;
        }
        // 929：watch runner 必须消费 per-file 目标——health 是**项目级**报告，
        // 一轮只产出一份（文本面一份完整报告；--json 面一份 JSON 文档）。
        // startWatch 按文件数逐个调 runner ⇒ 旧实现每轮重跑整个路径集、
        // 打印 N 份完整报告（N 份 JSON 文档 ⇒ JSON.parse 必炸）。
        // 这里按轮去重：onRoundStart = 每轮开跑回调（轮末标记之前）。
        let ranThisRound = false;
        startWatch(
          watchPaths,
          async () => {
            if (ranThisRound) return;
            ranThisRound = true;
            await runHealth(paths, watchOptions);
          },
          "health",
          () => {
            ranThisRound = false;
          },
        );
        return;
      }
      await runHealth(paths, runOptions);
    });
}
