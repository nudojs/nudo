import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";

export type NudoConfig = {
  env?: string[];
  mocks?: Record<string, string>;
  interface?: {
    /** 侧车 ambient 绑定总开关（check/LSP 执法与 interface 打印共用） */
    autoBind?: boolean;
    /**
     * emit 白名单（Phase 3，§7.3）：glob 数组，相对 projectDir。
     * 省略/空 = 不按路径过滤（仍受 --fn/--all 与「默认只刷已有生成段」约束）。
     */
    emit?: string[] | string;
  };
  /** 分析范围与噪声档（design-analysis-scope.md / A2） */
  analysis?: {
    include?: string[] | string;
    exclude?: string[] | string;
    /** directives（默认，今日行为）| exports | all */
    mode?: string;
    /** off | errors | default | verbose */
    diagnostics?: string;
    /** polyvariant：保留的精确调用点 case 上限（默认 3）；超出进 symbolic #widened */
    callSiteBudget?: number;
    /** C0.5：求值命中闭对象缺字段 → nudo:missing-slot；默认 off */
    evalMissingSlot?: "off" | "warning";
  };
  /** 磁盘缓存（B3）：true → `.nudo/cache`；字符串 → 自定义根；false/省略 → 关 */
  cache?: boolean | string;
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
};

const DEFAULT_ANALYSIS_INCLUDE: string[] = [];
const DEFAULT_ANALYSIS_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
];

function toStringArray(raw: string[] | string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = arr.filter((s): s is string => typeof s === "string" && s.length > 0);
  return out.length > 0 ? out : fallback;
}

/**
 * 归一化 `nudo.analysis`。默认 mode=directives（A1 前不改 IDE 行为）；
 * diagnostics：directives→errors，all/exports→default。
 * include 空 = 不按路径过滤（isNudoTargetPath 已管扩展名）。
 */
export function analysisConfig(config: NudoConfig | null | undefined): AnalysisConfig {
  const raw = config?.analysis;
  const modeRaw = raw?.mode;
  const mode: AnalysisMode =
    modeRaw === "exports" || modeRaw === "all" ? modeRaw : "directives";
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
  };
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
 * 归一化 `nudo.interface` 配置段。
 * - autoBind 默认 true
 * - emit：string | string[] → string[]（空 = 不限制路径）
 */
export function interfaceConfig(config: NudoConfig | null | undefined): InterfaceConfig {
  const raw = config?.interface?.emit;
  const emit =
    raw === undefined
      ? []
      : Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === "string" && s.length > 0)
        : typeof raw === "string" && raw.length > 0
          ? [raw]
          : [];
  return {
    autoBind: config?.interface?.autoBind ?? true,
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

export function findProjectConfig(
  startDir: string,
): { config: NudoConfig; projectDir: string } | null {
  let dir = resolve(startDir);
  const root = resolve("/");

  // 向上查找带 `nudo` 键的 package.json。子包自有 package.json（monorepo
  // packages/*）时**不**在此停步——否则仓库根的 nudo.interface.autoBind
  // 对该子包完全不可见。
  while (dir !== root) {
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.nudo) {
          return { config: pkg.nudo as NudoConfig, projectDir: dir };
        }
      } catch {
        // ignore parse errors
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
