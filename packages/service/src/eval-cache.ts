/**
 * evaluator run 缓存 + 缓存键指纹（eval-run 拆叶，ServiceReviewer S2）。
 *
 * 职责：evalRunByFile（按「入口文件 × mode」槽键的 BoundedLruMap）、
 * evalCacheSet / trimEvalCache / evict / clear、evalDepKey（disk dep 指纹
 * fail-closed）、pathEnvContentFingerprint（Bug 501 项目级 path env 内容
 * 维度）、mockSeedFingerprint（@nudo:mock seeds 键）。
 *
 * 运行时叶子：对 eval-run 仅 types-only 导入（ComposedEvalModules——emit 后
 * 消失，不环入 eval-run；与 fn-analysis-cache 的叶子纪律同款）。
 */
import { formatAbs, getFnImpl, type Abs } from "@nudojs/core";
import {
  BoundedLruMap,
  hashSource,
  loadModuleDepsFingerprint,
  stablePathKey,
} from "@nudojs/core/internal";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { clearAnalysisFileCache } from "./analysis-file-cache.ts";
import type { ComposedEvalModules, EvalRunResult } from "./eval-run.ts";
import { clearFnAnalysisCache } from "./fn-analysis-cache.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { getSessionCacheLimits } from "./session-cache-limits.ts";

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

/**
 * Content part for one Abs mock seed.
 *
 * 读侧只消费 `impl.fingerprint`（写侧唯一工厂 = mock-abs 的
 * `mockFingerprint`，ServiceReviewer S5）：fn mock 无指纹 = 写侧未盖章的
 * 旁路（宿主自造 Abs 函数）⇒ 单一显式标记 `"nofp"`，不逐格式重建
 * （`ret=` / `dispatch=` 重建曾与写侧格式漂移）。非 fn 值 mock 无指纹可言
 * ⇒ `formatAbs` 做内容键（值变 ⇒ 键变）。
 */
function absSeedPart(a: Abs): string {
  const impl = getFnImpl(a);
  if (impl?.fingerprint) return impl.fingerprint;
  if (a.shape.k === "fn") return "nofp";
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

/** 缓存键维度：lenientGlobals / maxLoopIters 透传 runTranspiled，必须参与命中判定 */
export type EvalCacheEntry = {
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

const evalRunByFile = new BoundedLruMap<EvalCacheEntry>(getSessionCacheLimits().maxEvalRuns);

/** 读缓存（BoundedLruMap.get：命中刷新 MRU；0 = 关闭：读路径也 miss） */
export function evalCacheGet(filePath: string, mode: string): EvalCacheEntry | undefined {
  if (getSessionCacheLimits().maxEvalRuns <= 0) return undefined;
  return evalRunByFile.get(evalCacheSlotKey(filePath, mode));
}

/** 纯读探测（不刷新 MRU、不看上限）——写回前查同槽旧值 */
export function evalCachePeek(filePath: string, mode: string): EvalCacheEntry | undefined {
  return evalRunByFile.peek(evalCacheSlotKey(filePath, mode));
}

/** disk dep fingerprint — null = fail-closed（截断/异常时禁止 evaluator memo） */
export function evalDepKey(source: string, filePath: string, loadModule?: LoadModule): string | null {
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

export function evalCacheSet(
  filePath: string,
  mode: string,
  entry: EvalCacheEntry,
): void {
  const max = getSessionCacheLimits().maxEvalRuns;
  if (max <= 0) return;
  // 上限动态（env / 显式层随时可变）：写前对齐（setMax 幂等，顺带压超限）
  evalRunByFile.setMax(max);
  evalRunByFile.set(evalCacheSlotKey(filePath, mode), entry);
}

/** 立刻压到当前 maxEvalRuns（调低上限时收内存） */
export function trimEvalCache(): void {
  evalRunByFile.setMax(getSessionCacheLimits().maxEvalRuns);
}
