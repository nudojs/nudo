/**
 * B 路径能力判定 + 进程内 transpile 执行（service 入口）。
 *
 * 分析默认 mode="analyze"：不执行顶层副作用，只保留函数定义。
 * throws 经 callTranspiledExportFull 捕获 $throw。
 */

import {
  runTranspiled,
  callTranspiledExport,
  callTranspiledExportFull,
  setBCallCollector,
  setMemberDiagCollector,
  setAbsTruncationCollector,
  typeValueToAbs,
  createEnvironment,
  type BCallRecord,
  type BMemberDiag,
  type TranspiledCallResult,
  type Abs,
  type AbsModuleExports,
  stableAnalyzeKeySource,
  formatAbs,
  hashSource,
  getFnImpl,
} from "@nudojs/core";
import { parse, extractInlineDirectives } from "@nudojs/parser";
import { loadEnvs } from "./evaluator/evaluator-api.ts";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";
import { clearAnalysisFileCache } from "./analysis-file-cache.ts";
import { clearFnAnalysisCache } from "./fn-analysis-cache.ts";

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
  } catch {
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
  } catch {
    return {};
  }
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(mods)) {
    out[spec] = { named: { ...named } };
  }
  return out;
}

/** 收集 @nudo:replace + @nudo:as → transpile 注入表 */
export function collectBPathReplacements(source: string): {
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
  } catch {
    /* ignore */
  }
  return { targets, values, asTargets, asValues };
}

/** 可走 transpile+exec：env 经 loadEnvs（内置 + 已 preload 的路径型） */
export function isBPathCapable(source: string, envNames: string[] = []): boolean {
  void envNames;
  // 顶层 this. 仍不支持（方法内 this 由 transpile 处理）
  if (/(^|[^.\w$])this\s*\./.test(source) && !/\bclass\s+/.test(source)) return false;
  return true;
}

export type BPathRunResult = {
  exports: Record<string, unknown>;
  modules: Record<string, AbsModuleExports>;
  /** 顶层执行期 method-missing */
  memberDiags?: BMemberDiag[];
  /** 模块图 cycle/depth/missing（B 权威） */
  moduleIssues?: import("./abs-modules-graph.ts").AbsModuleLoadIssue[];
  /** Abs 求值递归截断的函数标签 */
  truncatedFns?: string[];
  /** 顶层 $callNamed 调用点（call@ 合成；不经 TypeValue collector） */
  calls?: BCallRecord[];
};

/** 按入口文件键控：同文件同源 O(1) 身份比较（case 循环 400 次不再重哈希） */
type BCacheEntry = {
  stableSource: string;
  mode: string;
  envKey: string;
  mockKey: string;
  value: BPathRunResult | null;
};
const bRunByFile = new Map<string, BCacheEntry>();
const MAX_B_RUN_CACHE = 32;

export function clearBPathCache(): void {
  bRunByFile.clear();
  // 测试/宿主习惯：清 B-path 时一并丢掉整文件/函数级分析缓存
  clearAnalysisFileCache();
  clearFnAnalysisCache();
}

/** 依赖文件变更后：逐出以这些文件为入口的 B-path 缓存 */
export function evictBPathCacheForFiles(files: string[]): number {
  let n = 0;
  for (const f of files) {
    if (bRunByFile.delete(f)) n++;
  }
  return n;
}

function bPathCacheSet(
  filePath: string,
  stableSource: string,
  mode: string,
  envKey: string,
  mockKey: string,
  value: BPathRunResult | null,
): void {
  if (bRunByFile.size >= MAX_B_RUN_CACHE && !bRunByFile.has(filePath)) {
    const oldest = bRunByFile.keys().next().value;
    if (oldest !== undefined) bRunByFile.delete(oldest);
  }
  bRunByFile.set(filePath, { stableSource, mode, envKey, mockKey, value });
}

/** 模块图 + runTranspiled（默认 analyze 模式） */
export function tryRunBPath(
  source: string,
  filePath: string,
  opts: {
    maxLoopIters?: number;
    mode?: "exec" | "analyze";
    envNames?: string[];
    /** @nudo:mock → Abs，注入为全局绑定（防止顶层调用真 fetch 等） */
    mocks?: Record<string, Abs>;
  } = {},
): BPathRunResult | undefined {
  if (!isBPathCapable(source, opts.envNames ?? [])) return undefined;
  const mode = opts.mode ?? "analyze";
  const envKey = (opts.envNames ?? []).join(",");
  const mockKey = mockSeedFingerprint(opts.mocks);
  // 尾部无 @nudo 注释不参与：comment-only 编辑命中 B-path。
  // 同 source 引用时 stable 快路径返回原串 → 下方 === 为 O(1)。
  const stable = stableAnalyzeKeySource(source);
  const cached = bRunByFile.get(filePath);
  if (
    cached &&
    cached.stableSource === stable &&
    cached.mode === mode &&
    cached.envKey === envKey &&
    cached.mockKey === mockKey
  ) {
    // LRU：命中移到队尾
    bRunByFile.delete(filePath);
    bRunByFile.set(filePath, cached);
    return cached.value ?? undefined;
  }
  let out: BPathRunResult | null = null;
  try {
    const memberDiags: BMemberDiag[] = [];
    const truncated = new Set<string>();
    const topCalls: BCallRecord[] = [];
    // collector 先于模块图：import 函数体在 evalProgramAbs 内的 method-missing 也要收
    setMemberDiagCollector((d) => memberDiags.push(d));
    setAbsTruncationCollector((label) => truncated.add(label));
    setBCallCollector((r) => topCalls.push(r));
    try {
      const { modules: graphMods, issues } = evalAbsModuleGraph(source, filePath);
      const envMods = collectEnvModules(opts.envNames ?? []);
      const modules = { ...envMods, ...graphMods };
      const { targets, values, asTargets, asValues } = collectBPathReplacements(source);
      const envGlobals = {
        ...collectEnvGlobals(opts.envNames ?? []),
        ...(opts.mocks ?? {}),
      };
      const exports = runTranspiled(source, {
        modules: modules as never,
        maxLoopIters: opts.maxLoopIters,
        mode: opts.mode ?? "analyze",
        replacementTargets: targets.length ? targets : undefined,
        replacements: targets.length ? values : undefined,
        asOverrideTargets: asTargets.length ? asTargets : undefined,
        asOverrides: asTargets.length ? asValues : undefined,
        envGlobals: Object.keys(envGlobals).length ? envGlobals : undefined,
      });
      out = {
        exports,
        modules,
        memberDiags: memberDiags.length ? memberDiags : undefined,
        moduleIssues: issues.length ? issues : undefined,
        truncatedFns: truncated.size ? [...truncated] : undefined,
        calls: topCalls.length ? topCalls : undefined,
      };
    } finally {
      setMemberDiagCollector(null);
      setAbsTruncationCollector(null);
      setBCallCollector(null);
    }
  } catch {
    out = null;
  }
  bPathCacheSet(filePath, stable, mode, envKey, mockKey, out);
  return out ?? undefined;
}

/**
 * B 路径求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录。
 *
 * `calls` 只含**本次具名调用期间**（callTranspiledExportFull 内）发生的
 * 调用点——不含模块级顶层调用（run.calls）。模块级记录由主分析流程
 * 另行收集（analyzer 的 bTopCallRecords / absCallRecords）；在此重复返回
 * 会把 B 路径结果（常为 unknown）当第二组记录推给 analyzer，dedupe 因
 * 结果形态不同而保留，污染被调函数的 case 列表（多余 call@L 重复 +
 * call@symbolic 聚合 case，见 analyzer directive-case 分支）。
 */
export function tryBPathCallFull(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: {
    collectCalls?: boolean;
    collectMemberDiags?: boolean;
    envNames?: string[];
    mocks?: Record<string, Abs>;
  } = {},
): (TranspiledCallResult & {
  calls?: BCallRecord[];
  memberDiags?: BMemberDiag[];
  moduleIssues?: import("./abs-modules-graph.ts").AbsModuleLoadIssue[];
  truncatedFns?: string[];
}) | undefined {
  const run = tryRunBPath(source, filePath, { envNames: opts.envNames, mocks: opts.mocks });
  if (!run) return undefined;
  if (!(fnName in run.exports)) return undefined;
  const collected: BCallRecord[] = [];
  const memberDiags: BMemberDiag[] = [];
  if (opts.collectCalls) {
    setBCallCollector((r) => collected.push(r));
  }
  if (opts.collectMemberDiags ?? true) {
    setMemberDiagCollector((d) => memberDiags.push(d));
  }
  try {
    const full = callTranspiledExportFull(run.exports, fnName, args);
    const all = [...(run.memberDiags ?? []), ...memberDiags];
    return {
      ...full,
      calls: opts.collectCalls ? collected : undefined,
      memberDiags: all.length ? all : undefined,
      moduleIssues: run.moduleIssues,
      truncatedFns: run.truncatedFns,
    };
  } finally {
    if (opts.collectCalls) setBCallCollector(null);
    setMemberDiagCollector(null);
  }
}

/** B 路径求值具名导出（仅成功结果） */
export function tryBPathCall(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: { envNames?: string[]; mocks?: Record<string, Abs> } = {},
): Abs | undefined {
  const full = tryBPathCallFull(source, filePath, fnName, args, opts);
  if (!full) return undefined;
  const r = full.result;
  if (!r) return undefined;
  if (r.shape.k === "never" && full.throws.shape.k !== "never") {
    return undefined;
  }
  if (r.shape.k === "unknown" && !r.term) return undefined;
  return r;
}

export { callTranspiledExport, callTranspiledExportFull };
