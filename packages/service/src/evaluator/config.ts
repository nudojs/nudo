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
};

export type InterfaceConfig = {
  autoBind: boolean;
  /** emit 路径白名单（已归一化；空数组 = 不限制） */
  emit: string[];
};

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
 * 极简 glob（`**` / `*` / `?`）：相对 projectDir 匹配绝对路径。
 * 无白名单 → true。路径分隔符归一为 `/`。
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
