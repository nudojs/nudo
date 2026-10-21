import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname, relative, isAbsolute, sep } from "node:path";

/** target 必须落在 dir 内（禁止 `..` 逃逸出包目录）。 */
function isInsideDir(dir: string, target: string): boolean {
  const rel = relative(dir, target);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/** 路径段含 `..`（或绝对路径）→ 不是包内相对目标。 */
function escapesPackageRoot(rel: string): boolean {
  if (isAbsolute(rel)) return true;
  return rel.split(/[/\\]/).some((seg) => seg === "..");
}

/**
 * 逐级向上的 node_modules 候选目录（Node 语义：**每层都试一遍**，包不在本层
 * 就继续往上——不是「第一个存在的 node_modules 目录」，Bug 500）。
 */
function nodeModulesCandidates(startDir: string): string[] {
  const out: string[] = [];
  let dir = resolve(startDir);
  const root = resolve("/");
  for (;;) {
    out.push(join(dir, "node_modules"));
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/**
 * 逐级向上找包目录（每层重算候选，与 harvester 的 resolvePackageRoot 同口径：
 * 本层没有该包就继续往上——同一个包因此不会因安装层级不同给出相反结论）。
 */
function findPackageDirs(fromDir: string, pkgName: string): string[] {
  const out: string[] = [];
  for (const nm of nodeModulesCandidates(fromDir)) {
    const dir = join(nm, pkgName);
    if (existsSync(dir)) out.push(dir);
  }
  return out;
}

/**
 * 候选入口 stat（#135 口径 + 可见化）：单次 statSync——不存在按 miss；
 * EACCES/EIO/EMFILE 等真实读故障不得静默折叠成「入口不存在」（整包导出
 * 面静默 unknown 无迹可查），console.error 可见后按 miss 继续（不炸模块
 * 解析——入口解析的容错优先，但容错 ≠ 不可观测）。
 */
function statEntryVisible(p: string): boolean {
  try {
    return statSync(p, { throwIfNoEntry: false })?.isFile() === true;
  } catch (e) {
    console.error(`[nudo] module entry stat failed (${p}): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * package.json 读失败分流：fs 级 errno——ENOENT（未安装 / 竞态删除）是
 * 安静 miss；其余（EACCES/EIO…）console.error 可见（整包判 miss = 导出面
 * 静默 unknown）。非 fs 错误（JSON 语法错）维持既有安静 miss。
 */
function warnPkgJsonReadError(pkgJsonPath: string, e: unknown): void {
  const code = (e as { code?: string } | undefined)?.code;
  if (code !== undefined && code !== "ENOENT") {
    console.error(`[nudo] package.json read failed (${pkgJsonPath}): ${code}`);
  }
}

/**
 * 消费形态：ESM `import` / CJS `require`。
 * Node 的 dual package（同一包发 .mjs 与 .cjs 两套构建）**存在的全部理由**
 * 就是区分消费方——`exports` 的条件键必须按形态选，不能用一张固定顺序的表
 * （Bug 477：固定表把 "require" 排在 "import" 前 ⇒ ESM import 解析到 CJS 构建）。
 */
export type NpmLoadMode = "import" | "require";

/**
 * JS 入口条件键优先级（**按消费形态分表**）。
 * import 面：node → import → default → browser；require 面：node → require → default → browser。
 * `browser` 排在 `default` 之后：有 default 时取 Node 面，仅 browser-only 包才落到 browser。
 * `types` 不在此表——见 pickExport 兜底（且不作为可执行入口）。
 */
const JS_CONDITIONS: Record<NpmLoadMode, readonly string[]> = {
  import: ["node", "import", "default", "browser"],
  require: ["node", "require", "default", "browser"],
};

/**
 * 形态未给出时的尝试顺序：先 import 面再 require 面。
 * 理由：Node 的 ESM 解析器是现代 JS 的默认入口（dual package 的 "import"
 * 构建即主构建）；require 面兜底保证「只有 require 条件」的包不被误判 miss。
 * 说明符级的形态一旦可得（调用方按 AST 知道），必须显式传入 mode。
 */
const AUTO_MODE_ORDER: readonly NpmLoadMode[] = ["import", "require"];

/** 实际尝试的形态序列（显式 mode ⇒ 只有该形态）。 */
function modeOrder(mode?: NpmLoadMode): readonly NpmLoadMode[] {
  return mode ? [mode] : AUTO_MODE_ORDER;
}

/**
 * 递归展开 exports 目标树：字符串直出；数组按序首个命中（Node fallback 语义，
 * tryTarget 判存在性）；对象按条件键递归。types 仅在所有条件键都未命中时兜底。
 */
function pickExport(
  entry: unknown,
  conditions: readonly string[],
  tryTarget: (rel: string) => string | null,
): string | null {
  if (typeof entry === "string") return tryTarget(entry);
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const r = pickExport(item, conditions, tryTarget);
      if (r) return r;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    for (const k of conditions) {
      if (k in o) {
        const r = pickExport(o[k], conditions, tryTarget);
        if (r) return r;
      }
    }
    // types 仅兜底：主条件键全部 miss 后才尝试。
    // .d.ts 不是可执行入口——不返回给 eval 路径（声明文件求值必失败）。
    if ("types" in o) {
      const r = pickExport(o["types"], conditions, tryTarget);
      if (r && !/\.(d\.[cm]?ts)$/.test(r)) return r;
    }
  }
  return null;
}

/**
 * 在 exports 目标树中专找 `nudo` 条件（可嵌套于数组/条件对象深处）。
 * 找到 nudo 子树后用 JS 条件键继续解析（处理 nudo: { import, default } 等嵌套）。
 * 非 nudo 字符串不匹配——那是普通 JS 入口，不属于 sidecar。
 */
function pickNudoExport(
  entry: unknown,
  tryTarget: (rel: string) => string | null,
  mode?: NpmLoadMode,
): string | null {
  if (typeof entry === "string") return null;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const r = pickNudoExport(item, tryTarget, mode);
      if (r) return r;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    if ("nudo" in o) {
      for (const m of modeOrder(mode)) {
        const r = pickExport(o["nudo"], JS_CONDITIONS[m], tryTarget);
        if (r) return r;
      }
    }
    for (const v of Object.values(o)) {
      const r = pickNudoExport(v, tryTarget, mode);
      if (r) return r;
    }
  }
  return null;
}

type ExportsEntry = { target: unknown; substitution: string | null };

/**
 * 在 exports map 中定位 subpath 的原始目标（精确键优先，其次模式键 `./x/*`）。
 * 模式键返回 * 捕获段（substitution），供目标字符串替换。
 */
function findExportsEntry(exportsField: unknown, subpath: string): ExportsEntry | null {
  const key = subpath === "." ? "." : `./${subpath}`;

  if (typeof exportsField === "string") {
    return subpath === "." ? { target: exportsField, substitution: null } : null;
  }
  if (!exportsField || typeof exportsField !== "object") return null;

  const map = exportsField as Record<string, unknown>;

  // 精确键
  if (key in map) {
    return { target: map[key], substitution: null };
  }

  // 模式键：`./x/*` → 目标 `*` 替换（单 `*`，Node subpath patterns 同向）
  if (subpath !== ".") {
    let best: { target: unknown; substitution: string; prefixLen: number } | null = null;
    for (const [patternKey, target] of Object.entries(map)) {
      const starIdx = patternKey.indexOf("*");
      if (starIdx === -1) continue;
      if (patternKey.indexOf("*", starIdx + 1) !== -1) continue; // 仅支持单 *

      const prefix = patternKey.slice(0, starIdx);
      const suffix = patternKey.slice(starIdx + 1);
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      if (key.length < prefix.length + suffix.length) continue;

      const substitution = key.slice(prefix.length, key.length - suffix.length);
      if (!best || prefix.length > best.prefixLen) {
        best = { target, substitution, prefixLen: prefix.length };
      }
    }
    if (best) return { target: best.target, substitution: best.substitution };
  }

  // 顶层条件对象（无 ./ 键）：exports: { "require": ..., "default": ... } 糖式主入口
  if (subpath === "." && !("." in map)) {
    const keys = Object.keys(map);
    if (keys.length > 0 && keys.every((k) => !k.startsWith("."))) {
      return { target: map, substitution: null };
    }
  }

  return null;
}

/** 基于 substitution 生成 tryTarget：先替换 *，再检查存在性；结果必须在 pkgDir 内。 */
function makeTryTarget(
  pkgDir: string,
  substitution: string | null,
  tryFile: (p: string) => string | null,
): (rel: string) => string | null {
  return (rel: string) => {
    const substituted = substitution !== null ? rel.replace("*", substitution) : rel;
    return tryInsidePkg(pkgDir, substituted, tryFile);
  };
}

/** pkgDir 内解析相对目标；`..` / 绝对路径逃逸返回 null。 */
function tryInsidePkg(
  pkgDir: string,
  rel: string,
  tryFile: (p: string) => string | null,
): string | null {
  if (escapesPackageRoot(rel)) return null;
  const abs = resolve(pkgDir, rel);
  if (!isInsideDir(pkgDir, abs)) return null;
  return tryFile(abs);
}

/** resolveNpmJsEntry 详细结果：路径 + exports 声明未命中标志。 */
export type ResolveNpmJsEntryResult = {
  path: string | null;
  /** package.json 确有 exports 声明但当前 subpath 未命中（或目标文件缺失）。 */
  exportsUnresolved: boolean;
};

/** 包内文件候选（精确路径 + 扩展名 + index 入口）。 */
function pkgFileCandidates(p: string): string[] {
  return [p, `${p}.js`, `${p}.cjs`, `${p}.mjs`, join(p, "index.js"), join(p, "index.cjs")];
}

/** 包内文件候选 → 首个存在者（stat 故障可见后按 miss）。 */
function tryPkgFile(p: string): string | null {
  for (const c of pkgFileCandidates(p)) {
    if (statEntryVisible(c)) return c;
  }
  return null;
}

/** 最近的 package.json（导入方的包作用域）：目录 + 内容。 */
function findPackageScope(fromDir: string): { dir: string; pkg: Record<string, unknown> } | null {
  let dir = resolve(fromDir);
  const root = resolve("/");
  for (;;) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      try {
        const pkg = JSON.parse(readFileSync(pj, "utf-8")) as Record<string, unknown>;
        return { dir, pkg };
      } catch (e) {
        warnPkgJsonReadError(pj, e);
        return null;
      }
    }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 在 `imports` 映射里定位说明符（精确键优先，其次模式键 `#x/*`）。
 * 与 exports 的模式键同向：单 `*`，返回 * 捕获段。
 */
function findImportsEntry(importsField: unknown, spec: string): ExportsEntry | null {
  if (!importsField || typeof importsField !== "object" || Array.isArray(importsField)) return null;
  const map = importsField as Record<string, unknown>;
  if (Object.hasOwn(map, spec)) return { target: map[spec], substitution: null };

  let best: { target: unknown; substitution: string; prefixLen: number } | null = null;
  for (const [patternKey, target] of Object.entries(map)) {
    const starIdx = patternKey.indexOf("*");
    if (starIdx === -1) continue;
    if (patternKey.indexOf("*", starIdx + 1) !== -1) continue; // 仅支持单 *
    const prefix = patternKey.slice(0, starIdx);
    const suffix = patternKey.slice(starIdx + 1);
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    if (spec.length < prefix.length + suffix.length) continue;
    const substitution = spec.slice(prefix.length, spec.length - suffix.length);
    if (!best || prefix.length > best.prefixLen) {
      best = { target, substitution, prefixLen: prefix.length };
    }
  }
  return best ? { target: best.target, substitution: best.substitution } : null;
}

/**
 * Node 的 `#imports`（包内子路径映射，Bug 498）。
 * 说明符以 `#` 开头 ⇒ 查**导入方**最近 package.json 的 `imports` 字段
 * （不是包名——`node_modules/#helper` 必 miss）。
 * 目标可以是包内相对路径，也可以是外部裸包（后者转裸包解析）。
 *
 * 解析不到 ⇒ exportsUnresolved=true（`#` 说明符语义上确定可解析，
 * 解析失败是真缺失，不得静默塌成 unknown）。
 */
function resolveHashImport(
  spec: string,
  fromDir: string,
  mode?: NpmLoadMode,
): ResolveNpmJsEntryResult {
  const none: ResolveNpmJsEntryResult = { path: null, exportsUnresolved: false };
  const scope = findPackageScope(fromDir);
  if (!scope) return { path: null, exportsUnresolved: true };

  const entry = findImportsEntry(scope.pkg.imports, spec);
  if (!entry) return { path: null, exportsUnresolved: true };

  const resolveTarget = (target: unknown): string | null => {
    if (target === null || target === undefined) return null; // 被显式屏蔽
    if (typeof target === "string") {
      const substituted = entry.substitution !== null ? target.replace("*", entry.substitution) : target;
      if (substituted.startsWith("./") || substituted.startsWith("../")) {
        return tryInsidePkg(scope.dir, substituted, tryPkgFile);
      }
      // 外部包目标（"dep" / "dep/sub"）⇒ 转裸包解析（从导入方包目录起）
      if (substituted.startsWith("#")) return null; // 禁止自引用（否则无限递归）
      return resolveNpmJsEntryDetailed(substituted, scope.dir, mode).path;
    }
    if (Array.isArray(target)) {
      for (const item of target) {
        const r = resolveTarget(item);
        if (r) return r;
      }
      return null;
    }
    if (target && typeof target === "object") {
      const o = target as Record<string, unknown>;
      for (const m of modeOrder(mode)) {
        for (const k of JS_CONDITIONS[m]) {
          if (!Object.hasOwn(o, k)) continue;
          const r = resolveTarget(o[k]);
          if (r) return r;
        }
      }
      return null;
    }
    return null;
  };

  const path = resolveTarget(entry.target);
  if (path) return { path, exportsUnresolved: false };
  return { path: null, exportsUnresolved: true };
}

/**
 * A3：裸包可执行入口（.js/.cjs/.mjs）。有源码就走 eval 执行，而不是 harvest stub
 * （ms/debug 等纯 JS 包的返回面由此从 unknown 变成真实折叠）。
 *
 * mode：消费形态（ESM import / CJS require）——决定 `exports` 的条件键集合；
 * 省略 ⇒ 形态未知，按 import → require 顺序尝试（见 AUTO_MODE_ORDER）。
 */
export function resolveNpmJsEntryDetailed(
  source: string,
  fromDir: string,
  mode?: NpmLoadMode,
): ResolveNpmJsEntryResult {
  const none: ResolveNpmJsEntryResult = { path: null, exportsUnresolved: false };
  if (!source || source.startsWith(".") || source.startsWith("/") || source.startsWith("node:")) {
    return none;
  }
  // Node 的 #imports（包内子路径映射）——不是包名，走导入方的 imports 字段
  if (source.startsWith("#")) {
    return resolveHashImport(source, fromDir, mode);
  }
  const parts = source.startsWith("@")
    ? source.split("/").slice(0, 2)
    : source.split("/").slice(0, 1);
  const pkgName = parts.join("/");
  const subpath = source.slice(pkgName.length).replace(/^\//, "") || ".";

  // 逐级向上找包（Node 语义：每层 node_modules 都试；本层没有就继续往上）
  let exportsUnresolved = false;
  for (const pkgDir of findPackageDirs(fromDir, pkgName)) {
    const r = resolveInPkgDir(pkgDir, pkgName, subpath, mode);
    if (r.path) return { path: r.path, exportsUnresolved: false };
    if (r.exportsUnresolved) exportsUnresolved = true;
  }
  return { path: null, exportsUnresolved };
}

/** 包目录内的入口解析（exports → legacy main → 直接子路径）。 */
function resolveInPkgDir(
  pkgDir: string,
  pkgName: string,
  subpath: string,
  mode?: NpmLoadMode,
): ResolveNpmJsEntryResult {
  const none: ResolveNpmJsEntryResult = { path: null, exportsUnresolved: false };
  const pkgJsonPath = join(pkgDir, "package.json");
  const tryFile = tryPkgFile;

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    // 读失败分流：ENOENT（未安装）安静 miss；EACCES/EIO 可见后按 miss
    warnPkgJsonReadError(pkgJsonPath, e);
    return none;
  }

  const exportsField = pkg.exports;

  // Node 语义：exports 一旦表态就只走 exports——未命中不得回落 main/直接路径。
  if (exportsField !== undefined && exportsField !== null) {
    const entry = findExportsEntry(exportsField, subpath);
    if (entry) {
      const tryTarget = makeTryTarget(pkgDir, entry.substitution, tryFile);
      for (const m of modeOrder(mode)) {
        const rel = pickExport(entry.target, JS_CONDITIONS[m], tryTarget);
        if (rel) return { path: rel, exportsUnresolved: false };
      }
    }
    // exports 声明了但键不匹配 / 目标缺失 / 目标逃出包目录
    return { path: null, exportsUnresolved: true };
  }

  // 无 exports：legacy main / module / 直接子路径（仍限制在包目录内）
  if (subpath === ".") {
    const main = typeof pkg.main === "string" ? pkg.main : undefined;
    const hit = tryInsidePkg(pkgDir, main ?? ".", tryFile);
    if (hit) return { path: hit, exportsUnresolved: false };
    const mod = typeof pkg.module === "string" ? pkg.module : undefined;
    if (mod) {
      const hitMod = tryInsidePkg(pkgDir, mod, tryFile);
      if (hitMod) return { path: hitMod, exportsUnresolved: false };
    }
    return none;
  }
  return { path: tryInsidePkg(pkgDir, subpath, tryFile), exportsUnresolved: false };
}

/** 兼容包装：只取路径。 */
export function resolveNpmJsEntry(
  source: string,
  fromDir: string,
  mode?: NpmLoadMode,
): string | null {
  return resolveNpmJsEntryDetailed(source, fromDir, mode).path;
}

export function resolveNpmNudo(
  source: string,
  fromDir: string,
  mode?: NpmLoadMode,
): string | null {
  const isRelative = source.startsWith(".") || source.startsWith("/");
  if (isRelative) return null;

  const parts = source.startsWith("@")
    ? source.split("/").slice(0, 2)
    : source.split("/").slice(0, 1);
  const pkgName = parts.join("/");
  // exports 键是 "./sub" / "."，不是 "/sub"（与 resolveNpmJsEntry 同口径）
  const subpath = source.slice(pkgName.length).replace(/^\//, "") || ".";

  // 逐级向上找包（与 resolveNpmJsEntryDetailed 同口径）
  for (const pkgDir of findPackageDirs(fromDir, pkgName)) {
    const hit = resolveNudoInPkgDir(pkgDir, subpath, mode);
    if (hit) return hit;
  }
  return null;
}

/** 包目录内的 nudo 侧车条件解析。 */
function resolveNudoInPkgDir(
  pkgDir: string,
  subpath: string,
  mode?: NpmLoadMode,
): string | null {
  const pkgJsonPath = join(pkgDir, "package.json");
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    // 读失败分流：ENOENT（未安装）安静 miss；EACCES/EIO 可见后按 miss
    warnPkgJsonReadError(pkgJsonPath, e);
    return null;
  }

  try {
    const exportsField = pkg.exports;
    if (exportsField === undefined || exportsField === null) return null;

    const entry = findExportsEntry(exportsField, subpath);
    if (!entry) return null;

    const tryFile = (p: string): string | null => (statEntryVisible(p) ? p : null);
    const tryTarget = makeTryTarget(pkgDir, entry.substitution, tryFile);
    return pickNudoExport(entry.target, tryTarget, mode);
  } catch {
    // ignore parse errors
  }

  return null;
}
