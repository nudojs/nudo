/**
 * 求值引擎能力判定 + 进程内 transpile 执行（service 入口）。
 *
 * 分析默认 mode="analyze"：不执行顶层副作用，只保留函数定义。
 * throws 经 callTranspiledExportFull 捕获 $throw。
 */

import { $invoke, runTranspiled, callTranspiledExport, callTranspiledExportFull, setEvalCallCollector, createEnvironment, noteEvalFallback, isAbsVal, isNudoThrow, never, withExecPhi, type EvalCallRecord, type TranspiledCallResult, type Abs, type AbsModuleExports, type Phi, formatAbs, getFnImpl, namespaceAbsOf } from "@nudojs/core";
import { setMemberDiagCollector, setAbsTruncationCollector, createScopedSlot, registerCollectorScopeParticipant, runWithCollectorScope, type EvalMemberDiag, stableAnalyzeKeySource, hashSource, loadModuleDepsFingerprint, stablePathKey } from "@nudojs/core/internal";
import { parse, type FileDirective } from "@nudojs/parser";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { loadEnvs } from "./evaluator/evaluator-api.ts";
import { pathEnvPreloadFingerprint } from "./evaluator/env-loader.ts";
import { evalAbsModuleGraph, type AbsGraphOptions, type AbsModuleLoadIssue } from "./abs-modules-graph.ts";
import { applyMockModuleDirectives, applyMockModuleDirectivesFromSource } from "./mock-module.ts";
import { mockScopeSelected } from "./mock-abs.ts";
import { clearAnalysisFileCache } from "./analysis-file-cache.ts";
import { getSessionCacheLimits } from "./session-cache-limits.ts";
import { clearFnAnalysisCache } from "./fn-analysis-cache.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { collectEvalReplacementsFromProgram } from "./eval-injection.ts";
import { cjsObjectExportMemberNames } from "./analyzer-ast.ts";
import { applyPureMarkers, pureFnNamesOfAst } from "./eval-pure.ts";

/**
 * 行内指令注入表（@nudo:replace / @nudo:as）——收集器在叶子模块
 * `eval-injection.ts`（根侧与依赖侧共用，避免 eval-run ↔ abs-modules-graph 成环）。
 * 这里转出以保持既有导入面（`eval-run.ts` 是公开入口）。
 */
export { collectEvalReplacements, resolveEvalInjection, type EvalInjection } from "./eval-injection.ts";

/**
 * 项目级 path env 文件的**内容**指纹（Bug 501）。
 *
 * env 名只是维度之一：同一个 env 名（`./env.ts`）指向的文件内容变了，
 * 类型面必须跟着变——否则整文件分析缓存（analysisFileCacheKey）与
 * evaluator memo（tryRunEval）会命中陈旧结果（env 改了、类型没改）。
 * 文件级 `/// @nudo:env` 的同款维度已由 dep 指纹覆盖（load-deps-fp 采
 * 路径 env 内容）——此处只补**项目级**（package.json#nudo.env）的路径 env。
 *
 * 口径与 env-loader 的 `isPathEnvName` 同源：内建名（es/web/node）不是
 * 路径；带 "/" 或 "./" / "../" 前缀的是路径；裸拼写按「解析到 .ts 且存在」
 * 判定。baseDir = 被分析文件所在目录（相对说明符的解析基准）。
 */
export function pathEnvContentFingerprint(envNames: string[], baseDir: string): string {
  const parts: string[] = [];
  for (const name of envNames) {
    if (typeof name !== "string" || name.length === 0) continue;
    // 内建 env 名（es / web / node）——不是路径 env
    if (name === "es" || name === "web" || name === "node") continue;
    const pathLike = name.includes("/") || name.startsWith("./") || name.startsWith("../");
    const resolved = resolvePath(baseDir, name);
    if (!pathLike && !(resolved.endsWith(".ts") && existsSync(resolved))) continue;
    let content: string;
    try {
      content = readFileSync(resolved, "utf-8");
    } catch {
      content = "<unreadable>";
    }
    parts.push(`${resolved}=${hashSource(content)}`);
  }
  return parts.length === 0 ? "" : hashSource(parts.join("\u0001"));
}

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

/**
 * @nudo:env modules（path / node:path / fs…）→ AbsModuleExports
 *
 * Bug 282：env 模块是 **CJS 互操作**模块——Node 的 `node:fs` 的默认导出就是
 * 模块对象本身（具名导出挂在它上面）⇒ ESM **默认导入**
 * （`import fs from "node:fs"`）必须绑到**命名空间**。
 *
 * 此前 env 表**只有 named、没有 default 槽** ⇒ core 的 `bindImport` 在
 * `name === "default"` 分支取不到值 ⇒ 折 `unknown` ⇒ 该文件的导出函数
 * 全量降级 `unknown` + 追加一条**误导性**的 `nudo:unknown-inference`
 * （真实原因是绑定没接上，不是推断失败）+ 门禁**假绿**（exit 0）；
 * 而**同一模块**的命名空间导入（`import * as fs`）却正常执法
 * （`nudo:entry-may-throw` 判红）⇒ 同一种导入语义两种门禁结论。
 *
 * 口径：default 槽 = 该模块的**命名空间 Abs**（全部具名导出），
 * 与 `mock-module.ts` 的「仅有 named 时合成 default 命名空间」同惯例；
 * 同时打 `interopDefault` 标记（CJS 互操作模块 ⇒ default = 模块对象本身）
 * ——core 的默认导入绑定（`defaultImportBindingOf`）据此回退，两条口径同源。
 * 只装在 **env 表**上——用户模块表不动 ⇒ 用户模块缺 default 仍是
 * `unknown`（Bug 990 口径：模块表有该 mod 但没有 default ⇒ 就是没有
 * default，不得回退到命名空间）。
 */
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
    const namedTable = { ...named };
    out[spec] = {
      named: namedTable,
      // CJS 互操作：default = 模块对象本身（= 命名空间）
      default: namespaceAbsOf({ named: namedTable }),
      interopDefault: true,
    };
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
 * 保活导出表合并（Bug 476）：ESM 的 import 绑定是指向依赖模块作用域的
 * **间接引用**——依赖模块的内部变异必须对导入方可见。
 * 旧口径用对象展开搬运导出表（`{ ...exports.named }`）→ **求值**活 getter
 * → 冻结成快照 ⇒ 依赖内部变异对导入方不可见（原生 "hello"，引擎 0）。
 * 这里改为 defineProperty 委派：named 槽与 default 槽都保持 getter。
 *
 * 优先级：靠前的表先占位（同名槽取先到者）。
 */
function liveNamedTable(tables: Array<Record<string, Abs>>): Record<string, Abs> {
  const out: Record<string, Abs> = {};
  for (const table of tables) {
    for (const k of Object.keys(table)) {
      // 自有属性判定：`in` 走原型链（toString/constructor 等继承名会被当导出）
      if (Object.hasOwn(out, k)) continue;
      const d = Object.getOwnPropertyDescriptor(table, k);
      if (d?.get) {
        Object.defineProperty(out, k, {
          enumerable: true,
          configurable: true,
          get: () => (table as Record<string, Abs>)[k],
        });
      } else {
        out[k] = table[k];
      }
    }
  }
  return out;
}

/**
 * 复制模块导出表（保活 default 槽）。
 * `named` 由调用方给定；`defaultSrc` 决定 default 槽取自谁（env 优先）。
 * `keepFlags` = 是否保留 evaluated / cjsMain 等标记位（合并覆盖场景与
 * 旧口径一致：env 覆盖后只留 named + default）。
 */
function copyModuleExports(
  src: AbsModuleExports,
  named: Record<string, Abs>,
  defaultSrc: AbsModuleExports = src,
  keepFlags = true,
): AbsModuleExports {
  const out = { named } as AbsModuleExports;
  if (keepFlags) {
    for (const k of Object.keys(src)) {
      if (k === "named" || k === "default") continue;
      const d = Object.getOwnPropertyDescriptor(src, k);
      if (!d) continue;
      if (d.get) {
        Object.defineProperty(out, k, {
          enumerable: true,
          configurable: true,
          get: () => (src as unknown as Record<string, unknown>)[k],
        });
      } else {
        (out as unknown as Record<string, unknown>)[k] = d.value;
      }
    }
  }
  const dd = Object.getOwnPropertyDescriptor(defaultSrc, "default");
  if (dd?.get) {
    Object.defineProperty(out, "default", {
      enumerable: true,
      configurable: true,
      get: () => defaultSrc.default,
    });
  } else if (dd) {
    out.default = dd.value as Abs;
  }
  return out;
}

/**
 * Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping
 * module keys and overlapping export names (docs/versioning.md B8 + website
 * harvester API). Harvest-only modules/exports are kept as fill-in.
 * Overwrites notify `opts.onConflict` or the global collector.
 *
 * **导出表保活**（Bug 476）：named / default 槽都是活绑定（getter 委派），
 * 合并不得按值快照——否则依赖模块的内部变异对导入方不可见。
 */
export function mergeHarvestUnderEnv(
  harvestModules: Record<string, AbsModuleExports>,
  envModules: Record<string, AbsModuleExports>,
  opts?: MergeHarvestOptions,
): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [mod, exports] of Object.entries(harvestModules)) {
    // 保留 cjsMain / evaluated 等标记位（Bug 10 回归：require 对 CJS 单函数
    // 导出需返回 default 本身，丢标记会回落 namespace obj → obj-callee 定抛）
    out[mod] = copyModuleExports(exports, liveNamedTable([exports.named]));
  }
  const notify = opts?.onConflict ?? envHarvestConflictCollectorSlot.get();
  for (const [mod, envExports] of Object.entries(envModules)) {
    const existing = out[mod];
    if (!existing) {
      out[mod] = copyModuleExports(envExports, liveNamedTable([envExports.named]));
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
    // env wins：同名槽取 env（保活），其余填 harvest
    const named = liveNamedTable([envExports.named, existing.named]);
    const defaultSrc = envExports.default !== undefined ? envExports : existing;
    out[mod] = copyModuleExports(existing, named, defaultSrc, false);
    // Bug 282：互操作标记随 env 侧走（keepFlags=false 会丢标记位 ⇒ env 模块的
    // 「default = 模块对象本身」语义在合并后丢失）。default 槽本身已由
    // defaultSrc 带上（env 侧 default 优先），此处只补标记。
    if (envExports.interopDefault) out[mod].interopDefault = true;
  }
  return out;
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
  /**
   * 已组装的模块图（依赖状态跨实例共享——与原生「同一模块实例」一致）。
   * fresh 实例复用同一张图：避免重复组图（依赖指纹复核要读盘）与
   * refresh 注册表被反复清空。
   */
  composed?: ComposedEvalModules;
  /**
   * 求值结果（**仅非 fresh 路径写入**）：memo 里的实例是「干净」的——
   * 调用会污染它的模块级状态（Bug 472），故调用面一律走 fresh 实例。
   */
  value?: EvalRunResult;
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
    // truncated/readerr（#135）：读错误轮的键不可信（flaky 与持久错误轮同
    // readerr 键但底层现实不同）→ fail-closed 禁 evaluator memo
    if (fp.truncated || fp.readError) return null;
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
    /**
     * 新建独立模块实例（不复用 memo 里的活实例）——调用面专用。
     * memo 里的实例捕获着模块级 `let` 绑定：一次调用改写它，后续用例
     * 就会看到被污染的状态（合成 entry@ 用例之间「串味」，Bug 472）。
     * fresh 实例只重建**根模块**（依赖模块图共享——与原生「同一依赖实例」
     * 一致）；fresh 结果不入 memo 的 value（实例会被调用污染）。
     */
    fresh?: boolean;
  } = {},
): EvalRunResult | undefined {
  // collector 作用域（幂等）：本入口安装 collector，先开作用域再装才能隔离；
  // 嵌套（checkSource / 宿主外层已开）零开销复用外层 store。
  return runWithCollectorScope(() => {
    const mode = opts.mode ?? "analyze";
    // env 维度 = 名字 + 项目级 path env 的**内容**（Bug 501：env 文件改了
    // 类型必须跟着变——只编码名字会让 memo 命中陈旧导出表）
    // + **预载状态**（Bug 993：path 型 env 只能异步装载，同一份源码在
    // 「预载前 / 预载后」得到两份不同结果——env 全局可见性不同。内容指纹
    // 两边相同 ⇒ 不加这一段时「先同步（未预载）、后异步（已预载）」会命中
    // 前者那份「无 env」的陈旧 memo）。
    const envKey = `${(opts.envNames ?? []).join(",")}#${pathEnvContentFingerprint(
      opts.envNames ?? [],
      dirname(filePath),
    )}#${pathEnvPreloadFingerprint() || "-"}`;
    const mockKey = mockSeedFingerprint(opts.mocks);
    const lenientKey = opts.lenientGlobals === true ? "1" : "0";
    const itersKey = opts.maxLoopIters === undefined ? "" : String(opts.maxLoopIters);
    // fresh：新建独立模块实例（不复用 memo 里的活实例）——调用面专用。
    const fresh = opts.fresh === true;
    // 尾部无 @nudo 注释不参与：comment-only 编辑命中 evaluator。
    // 同 source 引用时 stable 快路径返回原串 → 下方 === 为 O(1)。
    const stable = stableAnalyzeKeySource(source);
    // 指纹截断/异常 → 禁止读写 memo（fail-closed）；0 = 关闭：读路径也 miss
    //（与 BoundedLruMap max<=0 口径一致）
    const depKey = opts.depKey !== undefined ? opts.depKey : evalDepKey(source, filePath, opts.loadModule);
    const canCache = depKey !== null;
    /** fresh 路径复用 memo 里的组图（依赖状态共享，根模块状态独立） */
    let cachedComposed: ComposedEvalModules | undefined;
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
        if (!fresh) {
          // memo 里的实例可能被调用污染过（模块级状态）→ 调用面不得复用
          if (cached.value) return cached.value;
        } else {
          cachedComposed = cached.composed;
        }
      }
    }
    let out: EvalRunResult | null = null;
    /** 本轮实际使用的组图（写 memo 时带上——fresh 路径据此复用） */
    let usedComposed: ComposedEvalModules | undefined;
    try {
      const memberDiags: EvalMemberDiag[] = [];
      const truncated = new Set<string>();
      const topCalls: EvalCallRecord[] = [];
      // collector 先于模块图：import 函数体在 evalAbsModuleGraph 内的 method-missing 也要收
      const prevMember = setMemberDiagCollector((d) => memberDiags.push(d));
      const prevTrunc = setAbsTruncationCollector((label, reason) => {
        truncated.add(label);
        // BUG-099：**链式**转发。collector 是单槽，装自己的就把外层的截断观察
        // 面（analyzer 的诊断映射、宿主回调）静默掐断——`nudo test` / `--json`
        // 面因此看不到任何递归/预算截断。setter 只存槽不回调，故闭包内引用
        // `prevTrunc` 时它已初始化。
        prevTrunc?.(label, reason);
      });
      const prevCall = setEvalCallCollector((r) => topCalls.push(r));
      try {
        // 单一组装入口（与 analyzer 共用）；宿主已组装时直接复用；
        // fresh 路径复用 memo 里的组图（依赖状态共享、根模块状态独立）
        const composed =
          opts.composed ??
          cachedComposed ??
          composeEvalModules(source, filePath, {
            envNames: opts.envNames,
            loadModule: opts.loadModule,
          });
        usedComposed = composed;
        const modules = composed.modules;
        // 一次 parse 两用：行内指令注入表（@nudo:as / @nudo:replace）
        // + 纯函数名（@nudo:pure）——同源同次，避免重复 parse。
        const ast = parse(source);
        const { targets, values, asTargets, asValues } = collectEvalReplacementsFromProgram(
          ast.program,
          source,
        );
        const pureFns = pureFnNamesOfAst(ast);
        // Bug 274（service 侧剩余半边）：mock 与 env **分表传**。
        //
        // 此前 mock 被并进 `envGlobals` 一张表 ⇒ core 收到时**分不清哪些是
        // mock** ⇒ core 注入面的「不遮蔽宿主内建」跳过表（ENV_SHADOW_SKIP，
        // 只该作用于 env 全局）把名单内的 mock 一并吞掉 ⇒
        // `@nudo:mock Math` / `JSON` / `Date` 静默 no-op（跑的是宿主内建）。
        //
        // 口径：env 全局只装 env；mock 走 `mocks` 形参（core 按两张表分别
        // 过滤）。**优先级不变**——core 的 `__nudoEnv` 读面是
        // `{ ...(opts.envGlobals ?? {}), ...(opts.mocks ?? {}) }` ⇒ 同名时
        // mock 覆盖 env（与此前「合并表里 mock 在后」逐字等价）。
        const envGlobals = collectEnvGlobals(opts.envNames ?? []);
        const mocks = opts.mocks ?? {};
        const exports = runTranspiled(source, {
          modules: modules as never,
          maxLoopIters: opts.maxLoopIters,
          mode,
          replacementTargets: targets.length ? targets : undefined,
          replacements: targets.length ? values : undefined,
          asOverrideTargets: asTargets.length ? asTargets : undefined,
          asOverrides: asTargets.length ? asValues : undefined,
          envGlobals: Object.keys(envGlobals).length ? envGlobals : undefined,
          mocks: Object.keys(mocks).length ? mocks : undefined,
          lenientGlobals: opts.lenientGlobals,
        });
        // 纯度标记落在**刚诞生的这个实例**上（Bug 462 + 分片 J 的 fresh
        // 语义）：memo 实例与 fresh 实例都带标记 ⇒ 标记与调用点解析到
        // 同一对象身份（memo 以对象身份为键）。
        applyPureMarkers(exports, pureFns);
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
      //
      // **装载期**失败 ⇒ 该文件的模块装载失败（导出全丢）⇒ 闸门看不到任何
      // 入口 ⇒ 假绿（BUG-072）⇒ 标 loadFailure：可见性（fail-closed）与
      // 标签（BUG-073：用户代码的原生异常 ⇒ module-throw）**分列两维**。
      noteEvalFallback(e, "module", { loadFailure: true });
      out = null;
    }
    if (out !== null && canCache) {
      const cacheKey = evalCacheSlotKey(filePath, mode);
      const prev = evalRunByFile.get(cacheKey);
      const sameSlot =
        prev !== undefined &&
        prev.stableSource === stable &&
        prev.envKey === envKey &&
        prev.mockKey === mockKey &&
        prev.depKey === depKey &&
        prev.lenientKey === lenientKey &&
        prev.itersKey === itersKey;
      if (fresh) {
        // fresh 实例会被调用污染 → **不入 memo 的 value**；只补齐组图
        // （memo 里的干净实例保持不变，供分析面复用）
        evalCacheSet(filePath, mode, {
          stableSource: stable,
          envKey,
          mockKey,
          depKey: depKey!,
          lenientKey,
          itersKey,
          composed: usedComposed,
          value: sameSlot ? prev?.value : undefined,
        });
      } else {
        evalCacheSet(filePath, mode, {
          stableSource: stable,
          envKey,
          mockKey,
          depKey: depKey!,
          lenientKey,
          itersKey,
          composed: usedComposed,
          value: out,
        });
      }
    }
    return out ?? undefined;
  });
}

/**
 * CJS 对象字面量导出（`module.exports = { h(){} }`）的成员派发接收者（BUG-045）。
 *
 * 只在**导出表里没有同名槽**时调用（具名槽优先，既有解析口径不变）。AST 判据
 * 与普查同源（{@link cjsObjectExportMemberNames}）：只有普查登记过的成员键才允许
 * 从 `default` 槽派发——`export default { … }` 的成员不在此列（它没有 CJS 导出槽
 * 语义，按名求值不该命中）。接收者必须是 `obj` Abs（`$invoke` 的通用槽位面）。
 */
function cjsMemberReceiverOf(
  source: string,
  exports: Record<string, unknown>,
  fnName: string,
): Abs | undefined {
  const recv = exports["default"];
  if (!isAbsVal(recv) || recv.shape.k !== "obj") return undefined;
  try {
    return cjsObjectExportMemberNames(parse(source)).has(fnName) ? recv : undefined;
  } catch {
    /* 解析失败 ⇒ 不猜（与普查同源的前提不成立） */
    return undefined;
  }
}

/**
 * CJS 成员调用：接收者 = `module.exports` 对象 ⇒ 方法体内的 `this` 绑定正确
 * （对象字面量方法可能读写 `this`，按裸值 apply 会丢绑定）。
 *
 * 异常口径与 `callTranspiledExportFull` 的调用骨架一致：`NudoThrow` ⇒
 * `result = never` + `throws = 载荷`；其它原生异常属引擎缺陷 ⇒ 记回落
 * （`noteEvalFallback`，不静默吞）并 fail-closed（`undefined`）。
 */
function invokeCjsMember(
  recv: Abs,
  member: string,
  args: Abs[],
  phi: Phi | undefined,
): TranspiledCallResult | undefined {
  try {
    const call = () => $invoke(recv, member, args);
    const result = phi ? withExecPhi(phi, call) : call();
    return isAbsVal(result) ? { result, throws: never } : undefined;
  } catch (e) {
    if (isNudoThrow(e)) return { result: never, throws: e.absValue };
    noteEvalFallback(e);
    return undefined;
  }
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
      // mock 表按**被求值的函数作用域**选（Bug 455）：同名 `@nudo:mock`
      // 各归各函数——不分作用域则先声明的函数被后声明的同名 mock 改写成
      // 错误类型（产物面 dts / case 值都受影响）。
      mocks: opts.mocks ? mockScopeSelected(opts.mocks, fnName) : undefined,
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      ...(opts.depKey !== undefined ? { depKey: opts.depKey } : {}),
      // fresh：每次调用一个独立模块实例——调用会改写模块级状态（`n++` 等），
      // 复用同一实例会让后一个用例看到前一个用例的残留（Bug 472）。
      fresh: true,
    });
    if (!run) return undefined;
    // own-property：`in` 走原型链，toString/constructor 等继承名会被当模块导出调用
    const namedSlot = Object.hasOwn(run.exports, fnName);
    // BUG-045：CJS 对象字面量导出的成员（`module.exports = { h(){} }`）既不是模块
    // 作用域绑定、也不是顶层导出槽 ⇒ 按名取落空。导出面（dts / schema / guard）与
    // `nudo check` 必须同源 ⇒ 按 core 的导出槽口径（export-slot.ts 的 cjs-member）
    // 从 `default` 槽派发成员调用；否则三方言一起退化成 unknown / z.unknown() /
    // `return true`（校验器变空操作 = 假绿）。
    const cjsReceiver = namedSlot ? undefined : cjsMemberReceiverOf(source, run.exports, fnName);
    if (!namedSlot && cjsReceiver === undefined) return undefined;
    const collected: EvalCallRecord[] = [];
    const memberDiags: EvalMemberDiag[] = [];
    // CJS 成员派发是**合成的入口调用**（源码里没有这个调用点）⇒ `$invoke` 打的
    // 那条调用点记录（无 `callLoc`）不是见证证据：滤掉。否则它会凭空合成一条
    // `call@L<成员定义行>`（`callsiteCaseName` 的 fallbackLine 兜底）——冻结与
    // `contract --emit` 会把一个不存在的调用点写进源码，且真实调用点域名被
    // 这条假记录支撑（假绿方向）。
    const skipSyntheticEntryRecord = cjsReceiver !== undefined;
    // undefined = 本次未安装（finally 不动全局）；null = 之前就是空
    const prevCall:
      | ((r: EvalCallRecord) => void)
      | null
      | undefined = opts.collectCalls
        ? setEvalCallCollector((r) => {
            if (skipSyntheticEntryRecord && r.callLoc === undefined && r.fnName === fnName) {
              return;
            }
            collected.push(r);
          })
        : undefined;
    const wantMember = opts.collectMemberDiags ?? true;
    const prevMember:
      | ((d: EvalMemberDiag) => void)
      | null
      | undefined = wantMember
        ? setMemberDiagCollector((d) => memberDiags.push(d))
        : undefined;
    try {
      // 按源码本地函数名分析（@nudo:case 见证 / symbolic 聚合）：同名
      // re-export / CJS 合并不得顶替本地私有函数 ⇒ preferLocal。
      const full =
        cjsReceiver !== undefined
          ? invokeCjsMember(cjsReceiver, fnName, args, opts.phi)
          : callTranspiledExportFull(run.exports, fnName, args, {
              preferLocal: true,
              ...(opts.phi ? { phi: opts.phi } : {}),
            });
      if (!full) return undefined;
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
      // **引擎自身违约**（producer 产出了非 Abs 值）⇒ 不是用户代码抛 ⇒ 标签
      // 仍是 internal（BUG-073 的 module-throw 只归用户代码求值时的原生异常）
      // ⇒ 闸门必须红（引擎缺陷）。
      noteEvalFallback(
        new Error(
          `tryEvalCall: '${fnName}' result is not an Abs value (producer contract violation)`,
        ),
        "engine",
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
