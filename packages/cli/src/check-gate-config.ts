/**
 * check 门禁配置解析（纯）：profile / entryThrows / ignoreThrows。
 * CLI 配置层组合；不改 service checkConfig。
 */

export type GateProfile = "adoption" | "strict";
export type EntryThrowsMode = "error" | "warning" | "off";

export function parseIgnoreThrows(raw?: string | string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = parts
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

export function isGateProfile(raw: string | undefined): raw is GateProfile {
  return raw === "adoption" || raw === "strict";
}

export function isEntryThrowsMode(raw: string | undefined): raw is EntryThrowsMode {
  return raw === "error" || raw === "warning" || raw === "off";
}

/** profile 是 L2 预设；不吞 L1 */
export function profileEntryThrows(profile: GateProfile): EntryThrowsMode {
  return profile === "adoption" ? "warning" : "error";
}

/**
 * package.json#nudo.check.profile / entryThrows 原始读取（区分「未设置」）。
 */
export function checkGateFromConfig(config: { check?: unknown } | null | undefined): {
  profile?: GateProfile;
  entryThrows?: EntryThrowsMode;
} {
  const raw = config?.check as { profile?: unknown; entryThrows?: unknown } | undefined;
  const rawProfile = typeof raw?.profile === "string" ? raw.profile : undefined;
  const rawEntry = typeof raw?.entryThrows === "string" ? raw.entryThrows : undefined;
  const profile = isGateProfile(rawProfile) ? rawProfile : undefined;
  const entryThrows = isEntryThrowsMode(rawEntry) ? rawEntry : undefined;
  return {
    ...(profile ? { profile } : {}),
    ...(entryThrows ? { entryThrows } : {}),
  };
}

/**
 * L2 entryThrows 解析顺序（design-cli-semantics §1.4）：
 * 1. CLI `--entry-throws`（显式，压过 profile）
 * 2. CLI `--profile` 预设（adoption→warning / strict→error）
 * 3. `package.json#nudo.check.entryThrows`
 * 4. `package.json#nudo.check.profile` 预设
 * 5. 默认 strict（error）
 * L1 契约违例不受 profile 影响，始终 error。
 */
export function resolveEntryThrows(
  opts: { entryThrows?: EntryThrowsMode; profile?: GateProfile },
  pkg: { profile?: GateProfile; entryThrows?: EntryThrowsMode },
  pkgEntryNormalized: EntryThrowsMode,
): EntryThrowsMode {
  return (
    opts.entryThrows ??
    (opts.profile ? profileEntryThrows(opts.profile) : undefined) ??
    pkg.entryThrows ??
    (pkg.profile ? profileEntryThrows(pkg.profile) : undefined) ??
    pkgEntryNormalized
  );
}

/** CLI 列表与 package.json 合并（加法）；避免 CLI 覆盖导致无法在项目配置上收紧/扩展 */
export function mergeIgnoreThrows(
  cliList: string[] | undefined,
  pkgList: string[],
): string[] {
  return cliList && cliList.length > 0
    ? [...new Set([...pkgList, ...cliList])]
    : pkgList;
}

/** 门禁 flag 校验；合法返回 null，否则返回错误文案 */
export function validateGateFlags(opts: {
  entryThrows?: string;
  profile?: string;
}): string | null {
  if (opts.entryThrows !== undefined && !isEntryThrowsMode(opts.entryThrows)) {
    return `Invalid --entry-throws value: ${opts.entryThrows} (expected: error | warning | off)`;
  }
  if (opts.profile !== undefined && !isGateProfile(opts.profile)) {
    return `Invalid --profile value: ${opts.profile} (expected: adoption | strict)`;
  }
  return null;
}

/** `--what-if name:type` 绑定解析（无 type = any） */
export function parseWhatIfBindings(
  whatIf: string[],
): Array<{ name: string; type: string }> {
  return whatIf.map((w) => {
    const i = w.indexOf(":");
    return i < 0
      ? { name: w, type: "any" }
      : { name: w.slice(0, i), type: w.slice(i + 1) };
  });
}
