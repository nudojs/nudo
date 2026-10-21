/**
 * check 门禁配置解析（纯）：profile / entryThrows / ignoreThrows。
 * CLI 配置层组合；不改 service checkConfig。
 */

export type GateProfile = "adoption" | "strict";
export type EntryThrowsMode = "error" | "warning" | "off";

/**
 * `--ignore-throws` / `package.json#nudo.check.ignoreThrows` 的**统一**解析。
 *
 * 两条路径曾各写一套：CLI 切逗号（`TypeError,RangeError`），配置面只认严格
 * `string[]`（service checkConfig 的 `Array.isArray` 过滤）⇒ 同一语义键两种
 * 写法行为不同：配置写 `"TypeError"` 或 `["TypeError,RangeError"]` 都被静默
 * 丢成空表 ⇒ 门禁假红（用户以为忽略了 TypeError，实际没忽略）。
 * 现在两边共用本函数：裸字符串 / 字符串数组都接受，数组元素内部**也**按逗号
 * 切分，trim 后丢空；非字符串元素忽略；全空 ⇒ undefined（=「没设」，回落默认）。
 */
export function parseIgnoreThrows(raw?: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = parts
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * package.json#nudo.check.ignoreThrows 的**原始**值 → 与 CLI 同口径的列表
 * （679：配置面复用 CLI 解析器，不再走 service 的严格 `string[]` 过滤）。
 */
export function configIgnoreThrows(
  config: { check?: unknown } | null | undefined,
): string[] {
  const raw = config?.check as { ignoreThrows?: unknown } | undefined;
  return parseIgnoreThrows(raw?.ignoreThrows) ?? [];
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
 * 配置面非法值检测（typo 静默回落警示源）：值存在但
 * isGateProfile / isEntryThrowsMode 落空 → 返回原始值（供上层 stderr
 * warning；不改变解析结果，CLI 旗标已有 validateGateFlags 校验而配置面没有）。
 */
export function invalidGateConfig(config: { check?: unknown } | null | undefined): {
  profile?: string;
  entryThrows?: string;
} {
  const raw = config?.check as { profile?: unknown; entryThrows?: unknown } | undefined;
  const bad = (v: unknown, ok: (s: string | undefined) => boolean): string | undefined =>
    v === undefined || v === null || ok(v as string)
      ? undefined
      : typeof v === "string"
        ? v
        : JSON.stringify(v);
  const profile = bad(raw?.profile, isGateProfile);
  const entryThrows = bad(raw?.entryThrows, isEntryThrowsMode);
  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(entryThrows !== undefined ? { entryThrows } : {}),
  };
}

/**
 * 配置面 ignoreThrows 的**非法形状**（供 stderr 告警；同 entryThrows 先例：
 * 非法值回落默认 + 一行告警，不让门禁静默假红）。
 * 裸字符串 / 字符串数组都合法（统一解析器接受）；数字 / 布尔 / 对象 /
 * 数组里的非字符串元素 ⇒ 非法。
 */
export function invalidIgnoreThrowsConfig(
  config: { check?: unknown } | null | undefined,
): string | undefined {
  const raw = config?.check as { ignoreThrows?: unknown } | undefined;
  const v = raw?.ignoreThrows;
  if (v === undefined || v === null) return undefined;
  const show = (x: unknown): string => {
    if (typeof x === "string") return x;
    const s = JSON.stringify(x);
    return s === undefined ? String(x) : s;
  };
  if (typeof v === "string") return undefined;
  if (Array.isArray(v)) {
    const bad = v.filter((x) => typeof x !== "string");
    return bad.length > 0 ? bad.map(show).join(", ") : undefined;
  }
  return show(v);
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

/**
 * `--what-if` 绑定解析（无 type = any）。
 *
 * 分隔符**两种都认**：`name:type` 与 `name=type`（673）。旧实现只认冒号，
 * 而文档给的可复制命令（ai-native-dx.md / reference/agents.md）用的是**等号**
 * ⇒ 等号写法整串被当成绑定名 ⇒ 假设静默不生效（"Bindings not applied" +
 * exit 0），用户以为假设生效了。分隔符取**最先出现**的那个（`:` 与 `=`
 * 都认）；无分隔符 ⇒ name=整串 / type=any（旧口径不变）。
 */
export function parseWhatIfBindings(
  whatIf: string[],
): Array<{ name: string; type: string }> {
  return whatIf.map((w) => {
    const iColon = w.indexOf(":");
    const iEq = w.indexOf("=");
    const i =
      iColon < 0 ? iEq : iEq < 0 ? iColon : Math.min(iColon, iEq);
    return i < 0
      ? { name: w, type: "any" }
      : { name: w.slice(0, i), type: w.slice(i + 1) };
  });
}
