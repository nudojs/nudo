/**
 * 会话级内存 LRU 上限（进程内，非磁盘 cache）。
 * 多项目开 LSP 时用 env 封顶内存；单大仓可调高换 warm 命中。
 *
 * 优先级：setSessionCacheLimits（显式）> env > package.json#nudo.sessionCache > 默认
 *
 * 覆盖面：analysis-file-cache（maxFiles）/ fn-analysis-cache（maxFns）/
 * bpath-run（maxBRuns）。其余驻留结构（harvest-auto / harvest-node /
 * abs-modules-graph / env-loader path-env / env-path-deps）用各自的硬上限常量，
 * 见各文件与 lru-map.ts。所有上限加起来给出大仓分析后 retained 内存的上界。
 */
export type SessionCacheLimits = {
  /** 整文件 AnalysisResult LRU；0 = 关闭 */
  maxFiles: number;
  /** per-fn FunctionAnalysis LRU；0 = 关闭 */
  maxFns: number;
  /** B-path run LRU；0 = 关闭 */
  maxBRuns: number;
};

/** 保守默认：多项目共存时不悄悄吃内存（大仓请显式调高） */
export const DEFAULT_SESSION_CACHE_LIMITS: SessionCacheLimits = {
  maxFiles: 64,
  maxFns: 1024,
  maxBRuns: 32,
};

const HARD_CAP = 65_536;

function clampEntries(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(HARD_CAP, Math.floor(n)));
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "off" || raw === "0") return 0;
  const n = Number(raw);
  return clampEntries(n, fallback);
}

type PartialLimits = Partial<SessionCacheLimits>;

let explicit: PartialLimits = {};
let fromProject: PartialLimits = {};
let envCache: PartialLimits | null = null;

function envLimits(env: NodeJS.ProcessEnv): PartialLimits {
  return {
    maxFiles: parseLimit(env.NUDO_CACHE_MAX_FILES, NaN),
    maxFns: parseLimit(env.NUDO_CACHE_MAX_FNS, NaN),
    maxBRuns: parseLimit(env.NUDO_CACHE_MAX_BRUNS, NaN),
  };
}

function pick(
  key: keyof SessionCacheLimits,
  env: PartialLimits,
  fallback: number,
): number {
  const e = env[key];
  if (typeof e === "number" && Number.isFinite(e)) return e;
  const x = explicit[key];
  if (typeof x === "number" && Number.isFinite(x)) return clampEntries(x, fallback);
  const p = fromProject[key];
  if (typeof p === "number" && Number.isFinite(p)) return clampEntries(p, fallback);
  return fallback;
}

export function getSessionCacheLimits(
  env: NodeJS.ProcessEnv = process.env,
): SessionCacheLimits {
  if (envCache === null) envCache = envLimits(env);
  return {
    maxFiles: pick("maxFiles", envCache, DEFAULT_SESSION_CACHE_LIMITS.maxFiles),
    maxFns: pick("maxFns", envCache, DEFAULT_SESSION_CACHE_LIMITS.maxFns),
    maxBRuns: pick("maxBRuns", envCache, DEFAULT_SESSION_CACHE_LIMITS.maxBRuns),
  };
}

/** 显式覆盖（宿主 / 测试）。传 null 清除显式层 */
export function setSessionCacheLimits(partial: PartialLimits | null): SessionCacheLimits {
  explicit = partial ? { ...partial } : {};
  return getSessionCacheLimits();
}

/** package.json#nudo.sessionCache 层（findProjectConfig / 宿主接线） */
export function setSessionCacheFromProject(partial: PartialLimits | null | undefined): void {
  fromProject = partial ? { ...partial } : {};
}

/** 测试：丢弃 env 惰性缓存，重新读 process.env */
export function resetSessionCacheLimitState(): void {
  explicit = {};
  fromProject = {};
  envCache = null;
}
