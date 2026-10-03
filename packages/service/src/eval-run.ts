/**
 * 求值引擎能力判定 + 进程内 transpile 执行（service 入口）。
 *
 * 分析默认 mode="analyze"：不执行顶层副作用，只保留函数定义。
 * throws 经 callTranspiledExportFull 捕获 $throw。
 */

import { runTranspiled, callTranspiledExport, callTranspiledExportFull, setEvalCallCollector, createEnvironment, noteEvalFallback, isAbsVal, type EvalCallRecord, type TranspiledCallResult, type Abs, type AbsModuleExports, type Phi, formatAbs, getFnImpl } from "@nudojs/core";
import { setMemberDiagCollector, setAbsTruncationCollector, createScopedSlot, registerCollectorScopeParticipant, runWithCollectorScope, type EvalMemberDiag, stableAnalyzeKeySource, hashSource, loadModuleDepsFingerprint, stablePathKey } from "@nudojs/core/internal";
import { parse, extractInlineDirectives, type FileDirective } from "@nudojs/parser";
import { loadEnvs } from "./evaluator/evaluator-api.ts";
import { evalAbsModuleGraph, type AbsGraphOptions, type AbsModuleLoadIssue } from "./abs-modules-graph.ts";
import { applyMockModuleDirectives, applyMockModuleDirectivesFromSource } from "./mock-module.ts";
import { clearAnalysisFileCache } from "./analysis-file-cache.ts";
import { getSessionCacheLimits } from "./session-cache-limits.ts";
import { clearFnAnalysisCache } from "./fn-analysis-cache.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";

/** Content part for one Abs mock seed. */
function absSeedPart(a: Abs): string {
  const impl = getFnImpl(a);
  if (impl?.fingerprint) return impl.fingerprint;
  if (a.shape.k === "fn") {
    const ret = impl?.env?.vars?.get("__nudo_mock_ret");
    if (ret) {
      try {
        return `ret=${formatAbs(ret)}`;
      } catch {
        return "ret=?";
      }
    }
    if (impl?.apply) return "apply";
  }
  try {
    return formatAbs(a);
  } catch {
    return "?";
  }
}

function seedFnPart(name: string, fn: { params: string[]; body: unknown; fingerprint?: string }): string {
  if (fn.fingerprint) return `${name}:${fn.fingerprint}`;
  const body = fn.body as { start?: number; end?: number; type?: string } | undefined;
  const bodyKey =
    body && typeof body.start === "number" && typeof body.end === "number"
      ? `${body.start}:${body.end}:${body.type ?? ""}`
      : String(body?.type ?? "?");
  return `${name}(${fn.params.join(",")})@${bodyKey}`;
}

/**
 * Cache key for @nudo:mock seeds: name list alone is not enough — same names
 * with different Abs values must miss. Uses AbsFnImpl.fingerprint when the
 * mock pipeline stamped one (formatAbs cannot see WeakMap-side returns/withArgs).
 */
export function mockSeedFingerprint(
  mocks?: Record<string, Abs>,
  seedFns?: Record<string, { params: string[]; body: unknown; fingerprint?: string }>,
): string {
  const parts: string[] = [];
  if (mocks) {
    const names = Object.keys(mocks).sort();
    for (const n of names) parts.push(`${n}=${absSeedPart(mocks[n]!)}`);
  }
  if (seedFns) {
    const names = Object.keys(seedFns).sort();
    for (const n of names) parts.push(`fn:${seedFnPart(n, seedFns[n]!)}`);
  }
  if (parts.length === 0) return "-";
  return hashSource(parts.join(";"));
}

/** @nudo:env → Abs 全局表（env 模块 Abs 原生） */
export function collectEnvGlobals(envNames: string[]): Record<string, Abs> {
  if (envNames.length === 0) return {};
  const env = createEnvironment();
  try {
    return { ...loadEnvs(envNames, env).globals };
  } catch (e) {
    noteEvalFallback(e);
    return {};
  }
}

/** @nudo:env modules（path / node:path / fs…）→ AbsModuleExports */
export function collectEnvModules(envNames: string[]): Record<string, AbsModuleExports> {
  if (envNames.length === 0) return {};
  const env = createEnvironment();
  let mods: Record<string, Record<string, Abs>> = {};
  try {
    mods = loadEnvs(envNames, env).modules;
  } catch (e) {
    noteEvalFallback(e);
    return {};
  }
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(mods)) {
    out[spec] = { named: { ...named } };
  }
  return out;
}

/** Conflict when handwritten env overwrote a harvest module/export (B8). */
export type EnvHarvestConflict = {
  module: string;
  /** export names where env replaced a harvest binding (empty + defaulted = default only) */
  exports: string[];
  defaultOverwritten: boolean;
};

/** 冲突 collector（作用域化：runWithCollectorScope 内各分析互不串台；
 *  无作用域 = fallback 模块级单变量，行为同今日） */
const envHarvestConflictCollectorSlot = createScopedSlot<
  ((c: EnvHarvestConflict) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => envHarvestConflictCollectorSlot.runScoped(body));

/**
 * Install conflict collector; returns the previous one so nested/concurrent
 * analyzeFile callers can save/restore (scoped fallback: inside
 * runWithCollectorScope each analysis gets its own slot, no cross-talk).
 */
export function setEnvHarvestConflictCollector(
  collector: ((c: EnvHarvestConflict) => void) | null,
): ((c: EnvHarvestConflict) => void) | null {
  const prev = envHarvestConflictCollectorSlot.get();
  envHarvestConflictCollectorSlot.set(collector);
  return prev;
}

/** Read-only peek for tests / nested restore. */
export function getEnvHarvestConflictCollector():
  | ((c: EnvHarvestConflict) => void)
  | null {
  return envHarvestConflictCollectorSlot.get();
}

export type MergeHarvestOptions = {
  /**
   * Per-call conflict sink. Takes precedence over the module-global collector
   * installed via `setEnvHarvestConflictCollector`.
   */
  onConflict?: (c: EnvHarvestConflict) => void;
};

/**
 * Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping
 * module keys and overlapping export names (docs/versioning.md B8 + website
 * harvester API). Harvest-only modules/exports are kept as fill-in.
 * Overwrites notify `opts.onConflict` or the global collector.
 */
export function mergeHarvestUnderEnv(
  harvestModules: Record<string, AbsModuleExports>,
  envModules: Record<string, AbsModuleExports>,
  opts?: MergeHarvestOptions,
): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [mod, exports] of Object.entries(harvestModules)) {
    const named = { ...exports.named };
    out[mod] = exports.default !== undefined ? { named, default: exports.default } : { named };
  }
  const notify = opts?.onConflict ?? envHarvestConflictCollectorSlot.get();
  for (const [mod, envExports] of Object.entries(envModules)) {
    const existing = out[mod];
    if (!existing) {
      const named = { ...envExports.named };
      out[mod] =
        envExports.default !== undefined ? { named, default: envExports.default } : { named };
      continue;
    }
    const overwritten: string[] = [];
    for (const key of Object.keys(envExports.named)) {
      if (existing.named[key] !== undefined) overwritten.push(key);
    }
    const defaultOverwritten =
      envExports.default !== undefined && existing.default !== undefined;
    if (notify && (overwritten.length > 0 || defaultOverwritten)) {
      try {
        notify({
          module: mod,
          exports: overwritten,
          defaultOverwritten,
        });
      } catch {
        /* collector must not break analysis */
      }
    }
    const named = { ...existing.named, ...envExports.named };
    const defaultAbs =
      envExports.default !== undefined ? envExports.default : existing.default;
    out[mod] = defaultAbs !== undefined ? { named, default: defaultAbs } : { named };
  }
  return out;
}

/** 收集 @nudo:replace + @nudo:as → transpile 注入表 */
export function collectEvalReplacements(source: string): {
  targets: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  values: Record<string, Abs>;
  asTargets: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  asValues: Record<string, Abs>;
} {
  const targets: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }> = [];
  const values: Record<string, Abs> = {};
  const asTargets: Array<{ varName: string; stmtStart: number; stmtEnd: number }> = [];
  const asValues: Record<string, Abs> = {};
  let i = 0;
  try {
    const file = parse(source);
    const visitStmts = (stmts: unknown[]) => {
      for (const stmt of stmts) {
        if (!stmt || typeof stmt !== "object") continue;
        const loc = (stmt as { loc?: { start: { line: number }; end: { line: number } } }).loc;
        const dirs = extractInlineDirectives(stmt as never);
        for (const d of dirs) {
          if (d.kind === "replace") {
            const varName = `__rep${i++}`;
            targets.push({
              target: d.targetSource,
              varName,
              stmtStart: loc?.start.line,
              stmtEnd: loc?.end.line,
            });
            values[varName] = d.typeAbs;
          } else if (d.kind === "as" && loc) {
            const varName = `__as${i++}`;
            asTargets.push({
              varName,
              stmtStart: loc.start.line,
              stmtEnd: loc.end.line,
            });
            asValues[varName] = d.typeAbs;
          }
        }
        const s = stmt as {
          type?: string;
          body?: unknown;
          block?: unknown;
          consequent?: unknown;
          alternate?: unknown;
          declaration?: unknown;
        };
        if (s.type === "BlockStatement" && Array.isArray(s.body)) visitStmts(s.body);
        if (s.type === "FunctionDeclaration" || s.type === "FunctionExpression") {
          if (s.body) visitStmts([s.body]);
        }
        if (s.type === "ExportNamedDeclaration" && s.declaration) {
          visitStmts([s.declaration]);
        }
        if (s.type === "IfStatement") {
          if (s.consequent) visitStmts([s.consequent]);
          if (s.alternate) visitStmts([s.alternate]);
        }
      }
    };
    visitStmts(file.program.body);
  } catch (err) {
    // BUG-025：半张注入表比无注入更糟——@nudo:replace/
    // @nudo:as 前几条生效、后几条静默消失，应 exact
    // 的 Abs 变 unknown/真执行。已收集任何 directive
    // 时 rethrow（外层 catch → 整跑 fail-closed：
    // eval-run 返回 undefined / check 注入面报错）；
    // 零收集时 fail-closed 空 maps + noteEvalFallback
    // 记录（无可注入项，throw 前的 parse/访问失败
    // 不影响正确性）。
    if (targets.length > 0 || asTargets.length > 0) {
      throw err;
    }
    noteEvalFallback(err);
  }
  return { targets, values, asTargets, asValues };
}

export type EvalRunResult = {
  exports: Record<string, unknown>;
  modules: Record<string, AbsModuleExports>;
  /** 顶层执行期 method-missing */
  memberDiags?: EvalMemberDiag[];
  /** 模块图 cycle/depth/missing（eval 权威） */
  moduleIssues?: import("./abs-modules-graph.ts").AbsModuleLoadIssue[];
  /** Abs 求值递归截断的函数标签 */
  truncatedFns?: string[];
  /** 顶层 $callNamed 调用点（call@ 合成；不经 TypeValue collector） */
  calls?: EvalCallRecord[];
};

/**
 * 模块图组装的共享产物：analyzer 与 tryRunEval 走同一序列
 * （evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv →
 * applyMockModule*），单一事实源，不再各自漂移。
 */
export type ComposedEvalModules = {
  modules: Record<string, AbsModuleExports>;
  /** 模块图 cycle/depth/missing/missing-export（eval 权威） */
  issues: AbsModuleLoadIssue[];
  /** @nudo:mock-module 应用失败（analyzer 映射 nudo:module-missing 诊断） */
  mockErrors: string[];
};

/**
 * 模块图组装单一入口：相对/harvest 模块图 → @nudo:env modules 并入
 * （手写 env wins，B8）→ @nudo:mock-module 覆盖。
 * `fileDirectives`：调用方已抽取的文件指令（省一次 parse）；缺省从 source 解析。
 */
export function composeEvalModules(
  source: string,
  filePath: string,
  opts: {
    envNames?: string[];
    seedVars?: Record<string, Abs>;
    seedFns?: AbsGraphOptions["seedFns"];
    /** 宿主模块加载器（虚拟 FS / 侧车）；缺省 defaultAbsLoadModule */
    loadModule?: LoadModule;
    fileDirectives?: FileDirective[];
  } = {},
): ComposedEvalModules {
  const g = evalAbsModuleGraph(source, filePath, {
    ...(opts.seedVars ? { seedVars: opts.seedVars } : {}),
    ...(opts.seedFns ? { seedFns: opts.seedFns } : {}),
    ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
  });
  // env modules 必须并入图：@nudo:env 的 node:* / 裸包由 loadEnvs 提供，
  // 模块图只处理相对 import 与 harvest 裸包（跳过 node: 前缀）。
  let modules = mergeHarvestUnderEnv(g.modules, collectEnvModules(opts.envNames ?? []));
  const mockOpts = {
    fromFile: filePath,
    ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
  };
  const mm = opts.fileDirectives
    ? applyMockModuleDirectives(modules, opts.fileDirectives, mockOpts)
    : applyMockModuleDirectivesFromSource(source, modules, mockOpts);
  modules = mm.modules;
  return { modules, issues: g.issues, mockErrors: mm.errors.map((e) => e.message) };
}

/** 缓存键维度：lenientGlobals / maxLoopIters 透传 runTranspiled，必须参与命中判定 */
type EvalCacheEntry = {
  stableSource: string;
  envKey: string;
  mockKey: string;
  depKey: string;
  /** lenientGlobals（"1"/"0"）——exec 调用点发现与 analyze 口径不同 */
  lenientKey: string;
  /** maxLoopIters（""=引擎默认）——循环预算改变求值结果 */
  itersKey: string;
  /** 只缓存成功求值；失败结果禁止入 memo（瞬时失败不得固化为空导出） */
  value: EvalRunResult;
};

/** 按「入口文件 × mode」键控多槽：analyze / exec 互不逐出（exec 采集不再踢掉分析结果） */
function evalCacheSlotKey(filePath: string, mode: string): string {
  return `${stablePathKey(filePath)}\0${mode}`;
}

const evalRunByFile = new Map<string, EvalCacheEntry>();

/** disk dep fingerprint — null = fail-closed（截断/异常时禁止 evaluator memo） */
function evalDepKey(source: string, filePath: string, loadModule?: LoadModule): string | null {
  try {
    // 指纹经同一 loadModule 采集：自定义 loader（虚拟 FS）的内容变更同样翻转键
    const fp = loadModuleDepsFingerprint(source, loadModule ?? defaultLoadModule, filePath);
    // fingerprint is path=hash,… — hash whole blob so long abs paths still flip
    if (fp.truncated) return null;
    return hashSource(fp.fp);
  } catch {
    return null;
  }
}

export function clearEvalCache(): void {
  evalRunByFile.clear();
  // 测试/宿主习惯：清 evaluator 时一并丢掉整文件/函数级分析缓存
  clearAnalysisFileCache();
  clearFnAnalysisCache();
}

/** 测试/诊断：当前 evaluator run 缓存条目数（≤ getSessionCacheLimits().maxEvalRuns） */
export function getEvalCacheSize(): number {
  return evalRunByFile.size;
}

/** 依赖文件变更后：逐出以这些文件为入口的 evaluator 缓存（键走 stablePathKey；两种 mode 槽一并清） */
export function evictEvalCacheForFiles(files: string[]): number {
  let n = 0;
  for (const f of files) {
    for (const mode of ["analyze", "exec"] as const) {
      if (evalRunByFile.delete(evalCacheSlotKey(f, mode))) n++;
    }
  }
  return n;
}

function evalCacheSet(
  filePath: string,
  mode: string,
  entry: EvalCacheEntry,
): void {
  const max = getSessionCacheLimits().maxEvalRuns;
  if (max <= 0) return;
  const key = evalCacheSlotKey(filePath, mode);
  while (evalRunByFile.size >= max && !evalRunByFile.has(key)) {
    const oldest = evalRunByFile.keys().next().value;
    if (oldest === undefined) break;
    evalRunByFile.delete(oldest);
  }
  // 覆盖已有键先 delete 再 set：刷新为最近使用（与 BoundedLruMap.set 一致）
  evalRunByFile.delete(key);
  evalRunByFile.set(key, entry);
}

/** 立刻压到当前 maxEvalRuns（调低上限时收内存） */
export function trimEvalCache(): void {
  const max = getSessionCacheLimits().maxEvalRuns;
  while (evalRunByFile.size > max) {
    const oldest = evalRunByFile.keys().next().value;
    if (oldest === undefined) break;
    evalRunByFile.delete(oldest);
  }
}

/** 模块图 + runTranspiled（默认 analyze 模式） */
export function tryRunEval(
  source: string,
  filePath: string,
  opts: {
    maxLoopIters?: number;
    mode?: "exec" | "analyze";
    envNames?: string[];
    /** @nudo:mock → Abs，注入为全局绑定（防止顶层调用真 fetch 等） */
    mocks?: Record<string, Abs>;
    /** 宽松全局（调用点发现 exec 采集） */
    lenientGlobals?: boolean;
    /** 宿主模块加载器（虚拟 FS / 侧车）；透传图组装与 depKey，缺省 defaultLoadModule */
    loadModule?: LoadModule;
    /**
     * 宿主已计算的依赖指纹（hashSource(loadModuleDepsFingerprint(src, loader, path).fp)）。
     * 提供时跳过重算（per-fn 循环复用宿主一次 BFS，R2-5）；null = fail-closed 禁缓存。
     */
    depKey?: string | null;
    /** 宿主已组装的模块图（analyzer 一次分析内复用，消除重复 parse/eval） */
    composed?: ComposedEvalModules;
  } = {},
): EvalRunResult | undefined {
  // collector 作用域（幂等）：本入口安装 collector，先开作用域再装才能隔离；
  // 嵌套（checkSource / 宿主外层已开）零开销复用外层 store。
  return runWithCollectorScope(() => {
    const mode = opts.mode ?? "analyze";
    const envKey = (opts.envNames ?? []).join(",");
    const mockKey = mockSeedFingerprint(opts.mocks);
    const lenientKey = opts.lenientGlobals === true ? "1" : "0";
    const itersKey = opts.maxLoopIters === undefined ? "" : String(opts.maxLoopIters);
    // 尾部无 @nudo 注释不参与：comment-only 编辑命中 evaluator。
    // 同 source 引用时 stable 快路径返回原串 → 下方 === 为 O(1)。
    const stable = stableAnalyzeKeySource(source);
    // 指纹截断/异常 → 禁止读写 memo（fail-closed）；0 = 关闭：读路径也 miss
    //（与 BoundedLruMap max<=0 口径一致）
    const depKey = opts.depKey !== undefined ? opts.depKey : evalDepKey(source, filePath, opts.loadModule);
    const canCache = depKey !== null;
    if (canCache && getSessionCacheLimits().maxEvalRuns > 0) {
      const cacheKey = evalCacheSlotKey(filePath, mode);
      const cached = evalRunByFile.get(cacheKey);
      if (
        cached &&
        cached.stableSource === stable &&
        cached.envKey === envKey &&
        cached.mockKey === mockKey &&
        cached.depKey === depKey &&
        cached.lenientKey === lenientKey &&
        cached.itersKey === itersKey
      ) {
        // LRU：命中移到队尾
        evalRunByFile.delete(cacheKey);
        evalRunByFile.set(cacheKey, cached);
        return cached.value;
      }
    }
    let out: EvalRunResult | null = null;
    try {
      const memberDiags: EvalMemberDiag[] = [];
      const truncated = new Set<string>();
      const topCalls: EvalCallRecord[] = [];
      // collector 先于模块图：import 函数体在 evalAbsModuleGraph 内的 method-missing 也要收
      const prevMember = setMemberDiagCollector((d) => memberDiags.push(d));
      const prevTrunc = setAbsTruncationCollector((label) => truncated.add(label));
      const prevCall = setEvalCallCollector((r) => topCalls.push(r));
      try {
        // 单一组装入口（与 analyzer 共用）；宿主已组装时直接复用
        const composed =
          opts.composed ??
          composeEvalModules(source, filePath, {
            envNames: opts.envNames,
            loadModule: opts.loadModule,
          });
        const modules = composed.modules;
        const { targets, values, asTargets, asValues } = collectEvalReplacements(source);
        const envGlobals = {
          ...collectEnvGlobals(opts.envNames ?? []),
          ...(opts.mocks ?? {}),
        };
        const exports = runTranspiled(source, {
          modules: modules as never,
          maxLoopIters: opts.maxLoopIters,
          mode,
          replacementTargets: targets.length ? targets : undefined,
          replacements: targets.length ? values : undefined,
          asOverrideTargets: asTargets.length ? asTargets : undefined,
          asOverrides: asTargets.length ? asValues : undefined,
          envGlobals: Object.keys(envGlobals).length ? envGlobals : undefined,
          lenientGlobals: opts.lenientGlobals,
        });
        out = {
          exports,
          modules,
          memberDiags: memberDiags.length ? memberDiags : undefined,
          moduleIssues: composed.issues.length ? composed.issues : undefined,
          truncatedFns: truncated.size ? [...truncated] : undefined,
          calls: topCalls.length ? topCalls : undefined,
        };
      } finally {
        setMemberDiagCollector(prevMember);
        setAbsTruncationCollector(prevTrunc);
        setEvalCallCollector(prevCall);
      }
    } catch (e) {
      // 与 tryRunTranspiled 同口径：失败可观测，且不得写入 memo
      // （瞬时失败入缓存会把该 source 固化成永久空导出）
      noteEvalFallback(e);
      out = null;
    }
    if (out !== null && canCache) {
      evalCacheSet(filePath, mode, {
        stableSource: stable,
        envKey,
        mockKey,
        depKey: depKey!,
        lenientKey,
        itersKey,
        value: out,
      });
    }
    return out ?? undefined;
  });
}

/**
 * 求值引擎求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录。
 *
 * `calls` 只含**本次具名调用期间**（callTranspiledExportFull 内）发生的
 * 调用点——不含模块级顶层调用（run.calls）。模块级记录由主分析流程
 * 另行收集（analyzer 的 evalTopCallRecords / absCallRecords）；在此重复返回
 * 会把 求值引擎结果（常为 unknown）当第二组记录推给 analyzer，dedupe 因
 * 结果形态不同而保留，污染被调函数的 case 列表（多余 call@L 重复 +
 * call@symbolic 聚合 case，见 analyzer directive-case 分支）。
 */
export function tryEvalCallFull(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: {
    collectCalls?: boolean;
    collectMemberDiags?: boolean;
    envNames?: string[];
    mocks?: Record<string, Abs>;
    /** 入口 Φ 种子（assume 约束——eval 侧路径条件收窄） */
    phi?: Phi;
    /** 宿主模块加载器；透传 tryRunEval（图组装 + depKey 同口径） */
    loadModule?: LoadModule;
    /** 宿主已计算的依赖指纹（跳过重算）；null = fail-closed 禁缓存 */
    depKey?: string | null;
  } = {},
): (TranspiledCallResult & {
  calls?: EvalCallRecord[];
  memberDiags?: EvalMemberDiag[];
  moduleIssues?: import("./abs-modules-graph.ts").AbsModuleLoadIssue[];
  truncatedFns?: string[];
}) | undefined {
  // collector 作用域（幂等）：同 tryRunEval——先开作用域再装 collector。
  return runWithCollectorScope(() => {
    const run = tryRunEval(source, filePath, {
      envNames: opts.envNames,
      mocks: opts.mocks,
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      ...(opts.depKey !== undefined ? { depKey: opts.depKey } : {}),
    });
    if (!run) return undefined;
    // own-property：`in` 走原型链，toString/constructor 等继承名会被当模块导出调用
    if (!Object.hasOwn(run.exports, fnName)) return undefined;
    const collected: EvalCallRecord[] = [];
    const memberDiags: EvalMemberDiag[] = [];
    // undefined = 本次未安装（finally 不动全局）；null = 之前就是空
    const prevCall:
      | ((r: EvalCallRecord) => void)
      | null
      | undefined = opts.collectCalls
        ? setEvalCallCollector((r) => collected.push(r))
        : undefined;
    const wantMember = opts.collectMemberDiags ?? true;
    const prevMember:
      | ((d: EvalMemberDiag) => void)
      | null
      | undefined = wantMember
        ? setMemberDiagCollector((d) => memberDiags.push(d))
        : undefined;
    try {
      const full = callTranspiledExportFull(run.exports, fnName, args, opts.phi ? { phi: opts.phi } : undefined);
      const all = [...(run.memberDiags ?? []), ...memberDiags];
      return {
        ...full,
        calls: opts.collectCalls ? collected : undefined,
        memberDiags: all.length ? all : undefined,
        moduleIssues: run.moduleIssues,
        truncatedFns: run.truncatedFns,
      };
    } finally {
      if (prevCall !== undefined) setEvalCallCollector(prevCall);
      if (prevMember !== undefined) setMemberDiagCollector(prevMember);
    }
  });
}

/** 求值引擎求值具名导出（仅成功结果） */
export function tryEvalCall(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: {
    envNames?: string[];
    mocks?: Record<string, Abs>;
    phi?: Phi;
    /** 宿主模块加载器；透传 tryRunEval（图组装 + depKey 同口径） */
    loadModule?: LoadModule;
    /** 宿主已计算的依赖指纹（跳过重算）；null = fail-closed 禁缓存 */
    depKey?: string | null;
  } = {},
): Abs | undefined {
  // collector 作用域（幂等）：透传 tryEvalCallFull（已开），此处兜底独立入口。
  return runWithCollectorScope(() => {
    const full = tryEvalCallFull(source, filePath, fnName, args, opts);
    if (!full) return undefined;
    const r = full.result;
    // BUG-028：类型级 result 必填，但运行时不变量
    // 可能被破坏（producer 缺陷）——显式 isAbsVal
    // 守卫 + 回落观测（旧实现 !r 死检查：缺 result
    // 的记录静默 undefined，原因不可观测）
    if (!isAbsVal(r)) {
      noteEvalFallback(
        new Error(
          `tryEvalCall: '${fnName}' result is not an Abs value (producer contract violation)`,
        ),
      );
      return undefined;
    }
    if (r.shape.k === "never" && full.throws.shape.k !== "never") {
      return undefined;
    }
    if (r.shape.k === "unknown" && !r.term) return undefined;
    return r;
  });
}

export { callTranspiledExport, callTranspiledExportFull };
