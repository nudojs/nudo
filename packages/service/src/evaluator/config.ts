import { readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { setSessionCacheFromProject } from "../session-cache-limits.ts";
import { setEvalForkBudgetLimit, getEvalForkBudgetLimit, MAX_EVAL_TOTAL_FORKS } from "@nudojs/core/internal";

export type NudoConfig = {
  env?: string[];
  mocks?: Record<string, string>;
  contract?: {
    /** 侧车 ambient 绑定总开关（check/LSP 执法与 contract 打印共用） */
    autoBind?: boolean;
    /**
     * emit 白名单（Phase 3，§7.3）：glob 数组，相对 projectDir。
     * 省略/空 = 不按路径过滤（仍受 --fn/--all 与「默认只刷已有生成段」约束）。
     */
    emit?: string[] | string;
  };
  /** 分析范围与噪声档（design-cli-semantics.md §7） */
  analysis?: {
    include?: string[] | string;
    exclude?: string[] | string;
    /** directives | exports（默认）| all */
    mode?: string;
    /** off | errors | default | verbose */
    diagnostics?: string;
    /** polyvariant：保留的精确调用点 case 上限（默认 3）；超出进 symbolic #widened */
    callSiteBudget?: number;
    /** C0.5：求值命中闭对象缺字段 → nudo:missing-slot；默认 off */
    evalMissingSlot?: "off" | "warning";
    /**
     * B $fork 总次数上限（默认 5000）。env `NUDO_MAX_FORKS` 优先。
     * n≥1 有限整数；非法值回默认。启动时 set 进 core（setEvalForkBudgetLimit）。
     */
    maxForks?: number;
  };
  /** 磁盘缓存（B3）：true → `.nudo/cache`；字符串 → 自定义根；false/省略 → 关 */
  cache?: boolean | string;
  /** IDE 展示面（inlay hints） */
  inlayHints?: {
    /**
     * 参数约束 inlay（形参后 `where …`）。默认 **false**（关）：
     * 契约判别联合（如递归 AST 节点）外延展开可达数万字符。
     * 宿主设置（VS Code `nudo.inlayHints.parameters`）只在项目
     * 未显式设置该键时作默认（项目显式值优先）。
     */
    parameters?: boolean;
  };
  /**
   * 进程内会话 LRU 上限（内存/速度权衡）。多项目开 IDE 时调低封顶；
   * 单大仓 warm 命中可调高。0 = 关闭该层。
   * 优先级：显式 setSessionCacheLimits > env `NUDO_CACHE_MAX_*` > 此键。
   */
  sessionCache?: {
    maxFiles?: number;
    maxFns?: number;
    maxEvalRuns?: number;
  };
  /** check 门禁（design-cli-semantics §3） */
  check?: {
    /** L2 预设：adoption → entryThrows=warning，strict → error（显式 entryThrows 优先） */
    profile?: "adoption" | "strict";
    /** L2 入口 may-throw：error | warning | off（默认 error） */
    entryThrows?: "error" | "warning" | "off";
    /** L2 --ignore-throws 类型名列表 */
    ignoreThrows?: string[];
  };
};

export type InterfaceConfig = {
  autoBind: boolean;
  /** emit 路径白名单（已归一化；空数组 = 不限制） */
  emit: string[];
};

export type AnalysisMode = "directives" | "exports" | "all";
export type DiagnosticsLevel = "off" | "errors" | "default" | "verbose";

export type AnalysisConfig = {
  include: string[];
  exclude: string[];
  mode: AnalysisMode;
  diagnostics: DiagnosticsLevel;
  /** polyvariant 精确调用点上限（B4） */
  callSiteBudget: number;
  /** C0.5 evaluation-driven missing-slot；默认 off */
  evalMissingSlot: "off" | "warning";
  /** B $fork 总次数上限（已归一化；非法值回 core 默认） */
  maxForks: number;
};

export type CheckConfig = {
  /** L2 入口 may-throw 执法档；默认 error */
  entryThrows: "error" | "warning" | "off";
  /** L2 ignoreThrows 类型名；默认空 */
  ignoreThrows: string[];
};

/** package.json#nudo.check → 执法选项 */
export function checkConfig(config: NudoConfig | null | undefined): CheckConfig {
  const raw = config?.check;
  const rawEntry = raw?.entryThrows;
  const rawProfile = raw?.profile;
  let entryThrows: CheckConfig["entryThrows"] = "error";
  const entryValid = rawEntry === "off" || rawEntry === "warning" || rawEntry === "error";
  if (entryValid) {
    // 显式 entryThrows 优先于 profile 预设（与 CLI resolveEntryThrows 同优先级）
    entryThrows = rawEntry;
  } else {
    // 非法 entryThrows 始终告警——不得因 profile 合法而被吞掉
    if (rawEntry !== undefined) {
      process.stderr?.write?.(
        `nudo.check.entryThrows: invalid value ${JSON.stringify(rawEntry)} (expected error|warning|off); using error\n`,
      );
    }
    if (rawProfile === "adoption" || rawProfile === "strict") {
      // profile 预设（design-cli-semantics §1.4）：CLI 与 LSP 必须同口径，
      // 否则 IDE 把 CLI 已降级的 L2 显示为 error
      entryThrows = rawProfile === "adoption" ? "warning" : "error";
    }
  }
  const ignore = Array.isArray(raw?.ignoreThrows)
    ? raw.ignoreThrows.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  return { entryThrows, ignoreThrows: ignore };
}

const DEFAULT_ANALYSIS_INCLUDE: string[] = [];
const DEFAULT_ANALYSIS_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
];
/** A1 产品默认：exports — 普通带导出的 .js 进 IDE；directives/all 需显式 */
export const DEFAULT_ANALYSIS_MODE: AnalysisMode = "exports";

function toStringArray(raw: string[] | string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = arr.filter((s): s is string => typeof s === "string" && s.length > 0);
  return out.length > 0 ? out : fallback;
}

/**
 * 归一化 `nudo.analysis`。默认 mode=exports（A1：无指令但有 export/侧车的文件
 * 进 IDE 分析；`all` / `directives` 需显式配置）。
 * diagnostics：directives→errors，exports/all→default。
 * include 空 = 不按路径过滤（isNudoTargetPath 已管扩展名）。
 */
export function analysisConfig(config: NudoConfig | null | undefined): AnalysisConfig {
  const raw = config?.analysis;
  const modeRaw = raw?.mode;
  const mode: AnalysisMode =
    modeRaw === "exports" || modeRaw === "all" || modeRaw === "directives"
      ? modeRaw
      : DEFAULT_ANALYSIS_MODE;
  const diagRaw = raw?.diagnostics;
  const diagnostics: DiagnosticsLevel =
    diagRaw === "off" || diagRaw === "errors" || diagRaw === "default" || diagRaw === "verbose"
      ? diagRaw
      : mode === "directives"
        ? "errors"
        : "default";
  const budgetRaw = raw?.callSiteBudget;
  const callSiteBudget =
    typeof budgetRaw === "number" && Number.isFinite(budgetRaw) && budgetRaw >= 1
      ? Math.min(Math.floor(budgetRaw), 64)
      : 3;
  return {
    // include 空数组 = 不过滤（与「省略」同义）
    include: toStringArray(raw?.include, []),
    // exclude 空数组回落默认安全列表，避免误关 node_modules 保护
    exclude: toStringArray(raw?.exclude, DEFAULT_ANALYSIS_EXCLUDE),
    mode,
    diagnostics,
    callSiteBudget,
    evalMissingSlot: raw?.evalMissingSlot === "warning" ? "warning" : "off",
    maxForks: parseMaxForks(raw?.maxForks) ?? MAX_EVAL_TOTAL_FORKS,
  };
}

/** n≥1 有限整数才生效（向下取整）；非法/缺省 → undefined（由上层回默认） */
function parseMaxForks(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) return undefined;
  return Math.floor(raw);
}

/**
 * 把 fork 预算写进 core（core 保持无 IO）。
 * 优先级：env `NUDO_MAX_FORKS` > `package.json#nudo.analysis.maxForks` > 默认 5000。
 * 约定：n≥1 有限整数；非法值回默认。返回实际生效值。
 * 由 findProjectConfig / 宿主启动时调用（与 setSessionCacheFromProject 同时机）。
 */
export function applyBForkBudgetFromConfig(
  config: NudoConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const fromEnv = parseMaxForks(
    env.NUDO_MAX_FORKS === undefined ? undefined : Number(env.NUDO_MAX_FORKS),
  );
  const fromCfg = parseMaxForks(config?.analysis?.maxForks);
  return setEvalForkBudgetLimit(fromEnv ?? fromCfg ?? MAX_EVAL_TOTAL_FORKS);
}

/** 当前生效 fork 上限（调试/测试；与 core getEvalForkBudgetLimit 同源） */
export function currentBForkBudgetLimit(): number {
  return getEvalForkBudgetLimit();
}

/** 磁盘缓存根（B3）：config.cache / NUDO_CACHE_DIR / 默认关 */
export function diskCacheRoot(
  config: NudoConfig | null | undefined,
  projectDir: string | undefined,
): string | undefined {
  const raw = config?.cache;
  if (raw === false) return undefined;
  if (typeof raw === "string" && raw.length > 0) {
    return projectDir ? resolve(projectDir, raw) : raw;
  }
  if (raw === true) {
    return projectDir ? resolve(projectDir, ".nudo/cache") : undefined;
  }
  const env = process.env.NUDO_CACHE_DIR;
  if (env === "off" || env === "0") return undefined;
  if (env && env.length > 0) return env;
  return undefined;
}

/**
 * 归一化 `nudo.contract` 配置段。
 * - autoBind 默认 true
 * - emit：string | string[] → string[]（空 = 不限制路径）
 */
export function interfaceConfig(config: NudoConfig | null | undefined): InterfaceConfig {
  const raw = config?.contract?.emit;
  const emit =
    raw === undefined
      ? []
      : Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === "string" && s.length > 0)
        : typeof raw === "string" && raw.length > 0
          ? [raw]
          : [];
  return {
    autoBind: config?.contract?.autoBind ?? true,
    emit,
  };
}

/**
 * 极简 glob（`**` / `*` / `?`）：相对 projectDir 匹配**源文件**绝对路径
 * （不是侧车路径；侧车随源文件同目录写出）。无白名单 → true。
 * 路径分隔符归一为 `/`。
 */
export function matchesEmitAllowlist(
  absPath: string,
  projectDir: string | undefined,
  patterns: string[],
): boolean {
  if (patterns.length === 0) return true;
  if (!projectDir) return false;
  const rel = relative(projectDir, absPath).split(sep).join("/");
  if (rel.startsWith("..")) return false;
  return patterns.some((p) =>
    globMatch(
      p
        .split(sep)
        .join("/")
        .replace(/^\.\//, ""),
      rel,
    ),
  );
}

/** `**` 跨目录、`*` 不跨 `/`、`?` 单字符 */
function globMatch(pattern: string, path: string): boolean {
  let rx = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      // `**/` 或结尾 `**`
      if (pattern[i + 2] === "/") {
        rx += "(?:.*/)?";
        i += 2;
      } else {
        rx += ".*";
        i += 1;
      }
      continue;
    }
    if (ch === "*") {
      rx += "[^/]*";
      continue;
    }
    if (ch === "?") {
      rx += "[^/]";
      continue;
    }
    rx += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${rx}$`).test(path);
}

/**
 * findProjectConfig 的目录链 memo：key 为 resolve 后的 startDir，条目记录
 * 本次向上查找访问过的每个 package.json 的 mtimeMs+size（无文件记 absent；
 * stat 失败记 STAT_ERROR_FP 哨兵——pkgStatFp 永不产出该值，恢复后必
 * miss 重走，不把 null 钉死成稳定错值）。
 * 命中时只做链上 stat 比对（不 readFileSync/JSON.parse）；链上任何
 * package.json 新建/改写/删除（mtime 或 size 翻转，含 absent↔存在）都 miss
 * 重算——自校验，不依赖 watcher。LSP/宿主侧的显式失效走
 * evictProjectConfigMemo（clearAnalysisSessionCaches / isProjectConfigPath
 * 通道），覆盖「同 size+同 mtime」极端写入。
 */
type ProjectConfigMemoEntry = {
  chain: Array<{ pkgPath: string; fp: string | undefined }>;
  result: { config: NudoConfig; projectDir: string } | null;
};
const projectConfigMemo = new Map<string, ProjectConfigMemoEntry>();
/** 上限同 analysis-file-cache 的量级：per-目录条目很小，防病态深目录树 */
const MAX_PROJECT_CONFIG_MEMO = 128;
let projectConfigDiskReads = 0;

/** 链上 stat 失败的哨兵指纹：真实指纹是 `${mtimeMs}:${size}`，永不等于此值 */
const STAT_ERROR_FP = "\u0000stat-error";

/**
 * stat 指纹：ENOENT → undefined（真缺席）；其他 stat 错误（EACCES/EIO/
 * ESTALE/EMFILE…）**抛出**——不得静默折叠成「无 package.json」，否则瞬时
 * fs 故障会让整棵子树的项目配置（adoption profile / env 名单 /
 * sessionCache / maxForks）静默漂移（#135：existsSync/statSync 吞错族）。
 */
function pkgStatFp(pkgPath: string): string | undefined {
  try {
    const st = statSync(pkgPath);
    return `${st.mtimeMs}:${st.size}`;
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

function projectConfigMemoHit(entry: ProjectConfigMemoEntry): boolean {
  for (const { pkgPath, fp } of entry.chain) {
    let current: string | undefined;
    try {
      current = pkgStatFp(pkgPath);
    } catch {
      // 非 ENOENT stat 抛错 → 按「已变化」处理：miss 重走 findProjectConfig
      // 主循环 → 走响亮的 fail-closed 路径，不得让异常炸穿校验入口
      return false;
    }
    if (current !== fp) return false;
  }
  return true;
}

/** 清空 findProjectConfig 目录链 memo（项目配置 watch 通道 / 测试隔离） */
export function evictProjectConfigMemo(): void {
  projectConfigMemo.clear();
}

/** 诊断/测试：memo 条目数 + 实际读盘（readFileSync+JSON.parse）次数 */
export function projectConfigMemoStats(): { entries: number; diskReads: number } {
  return { entries: projectConfigMemo.size, diskReads: projectConfigDiskReads };
}

export function findProjectConfig(
  startDir: string,
): { config: NudoConfig; projectDir: string } | null {
  let dir = resolve(startDir);
  const root = resolve("/");
  const memoKey = resolve(startDir);
  const memoEntry: ProjectConfigMemoEntry = { chain: [], result: null };
  const memoize = (result: { config: NudoConfig; projectDir: string } | null) => {
    memoEntry.result = result;
    if (projectConfigMemo.size >= MAX_PROJECT_CONFIG_MEMO && !projectConfigMemo.has(memoKey)) {
      const oldest = projectConfigMemo.keys().next().value;
      if (oldest !== undefined) projectConfigMemo.delete(oldest);
    }
    projectConfigMemo.set(memoKey, memoEntry);
    return result;
  };

  const hit = projectConfigMemo.get(memoKey);
  if (hit && projectConfigMemoHit(hit)) return hit.result;

  // 向上查找带 `nudo` 键的 package.json。子包自有 package.json（monorepo
  // packages/*）时**不**在此停步——否则仓库根的 nudo.contract.autoBind
  // 对该子包完全不可见。
  while (dir !== root) {
    const pkgPath = resolve(dir, "package.json");
    let statFp: string | undefined;
    try {
      statFp = pkgStatFp(pkgPath);
    } catch (err) {
      // 非 ENOENT stat 错误（EACCES/EIO/…）：不得静默当缺席继续向上——
      // 否则子树 stat 故障会静默继承 monorepo 根配置（或无配置）。
      // 链上记哨兵：故障持续时每次校验都 throw→miss→重走→再告警
      // （fail-closed 保持响亮）；瞬态故障恢复后哨兵↔真实指纹必不匹配
      // →miss→重走自愈（不会把 null 钉死成稳定错值，#135）。
      memoEntry.chain.push({ pkgPath, fp: STAT_ERROR_FP });
      process.stderr?.write?.(
        `nudo: package.json stat failed at ${pkgPath} (${err instanceof Error ? err.message : String(err)}); project config disabled for this subtree (defaults + env apply)\n`,
      );
      applyBForkBudgetFromConfig(null);
      return memoize(null);
    }
    memoEntry.chain.push({ pkgPath, fp: statFp });
    if (statFp !== undefined) {
      // BUG-027：区分「无 nudo 键（继续向上）」与
      // 「读 / 解析失败」——旧实现 catch 吞掉后继续
      // 向上，子包 package.json 损坏 / 写入中时静默
      // 继承 monorepo 根配置（或无配置），per-package
      // 策略（entryThrows / maxForks / sessionCache）
      // 静默失效，IDE 与 CLI 口径漂移。解析失败 →
      // 诊断 + 停（fail-closed：无项目配置走默认 +
      // env 层，不猜根配置）。
      let pkg: unknown;
      try {
        projectConfigDiskReads++;
        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch (err) {
        process.stderr?.write?.(
          `nudo: package.json parse failed at ${pkgPath} (${err instanceof Error ? err.message : String(err)}); project config disabled for this subtree (defaults + env apply)\n`,
        );
        applyBForkBudgetFromConfig(null);
        return memoize(null);
      }
      const nudo =
        pkg && typeof pkg === "object"
          ? (pkg as { nudo?: NudoConfig }).nudo
          : undefined;
      if (nudo) {
        // 会话 LRU 上限随项目配置接线（显式 set > env > 此层；见 session-cache-limits）
        setSessionCacheFromProject(nudo.sessionCache);
        // fork 总次数预算：env NUDO_MAX_FORKS > nudo.analysis.maxForks > 默认
        applyBForkBudgetFromConfig(nudo);
        return memoize({ config: nudo, projectDir: dir });
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 无项目 nudo 配置：仍应用 env 层（NUDO_MAX_FORKS）
  applyBForkBudgetFromConfig(null);
  return memoize(null);
}
