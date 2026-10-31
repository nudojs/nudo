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
 * 宿主运行时**生效**的条件键集合（按消费形态分表）。
 * 注意：这里是**集合**不是优先级表——条件对象的键按 package.json 的声明顺序
 * 取首个命中（Node `PACKAGE_TARGET_RESOLVE` 语义，Bug 239）。把 `default`
 * 写进表里只是为了「它总是生效」，不是「它最后才生效」：`{ default, import }`
 * 的声明顺序决定 default 先命中，与宿主一致。
 *
 * `browser` **不在**集合里：它不是 Node 运行时条件，只在没有任何宿主条件命中
 * 时兜底（见 `FALLBACK_CONDITIONS`，browser-only 包的分析面入口）。
 * `types` 不在此表——见 pickExport 兜底（且不作为可执行入口）。
 */
const JS_CONDITIONS: Record<NpmLoadMode, readonly string[]> = {
  import: ["node", "import", "default"],
  require: ["node", "require", "default"],
};

/** 非宿主条件：仅当没有任何宿主条件命中时兜底（不是 Node 语义，是分析兜底）。 */
const FALLBACK_CONDITIONS: readonly string[] = ["browser"];

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
 * Node `PACKAGE_TARGET_RESOLVE` 的两条独立判据：目标**合法性**（`..` 逃逸 /
 * 非包内相对路径 ⇒ `ERR_INVALID_PACKAGE_TARGET`）与**文件是否存在**。
 * 数组回退只看前者（Bug 270）；`index.*` 候选只在 legacy `main` 语境参与
 * （Bug 273：ESM 的 exports / 旧式子路径不做 `LOAD_AS_DIRECTORY`）。
 */
type TargetTester = {
  /** 目标字符串是否合法（与「文件是否存在」无关）。 */
  isValid: (rel: string) => boolean;
  /** 合法目标的落地文件（不存在 ⇒ null）。 */
  tryFile: (rel: string) => string | null;
};

/** `pickExport` 的「目标非法」哨兵（Node 里对应 `undefined` ⇒ 数组可回退）。 */
const TARGET_INVALID = Symbol("invalid-package-target");
type PickedTarget = string | null | typeof TARGET_INVALID;

/**
 * 递归展开 exports 目标树。
 *
 * Node 口径（Bug 239 / 270）：
 * - 字符串 ⇒ 合法则返回落地文件（**缺失也是终局**，不回退），非法 ⇒ TARGET_INVALID；
 * - 数组 ⇒ 只有**非法**项才继续下一项；首个合法项（含缺失 ⇒ null）即终局；
 * - 对象 ⇒ 按 package.json **声明顺序**取首个命中条件；命中即终局（null 也终局），
 *   未命中项（TARGET_INVALID）才继续；
 * - `browser` 是分析面兜底条件，宿主条件全未命中后再试；
 * - `types` 仅在最后兜底，且 `.d.ts` 不作为可执行入口。
 */
function pickExport(
  entry: unknown,
  conditions: readonly string[],
  tgt: TargetTester,
): PickedTarget {
  if (typeof entry === "string") {
    if (!tgt.isValid(entry)) return TARGET_INVALID;
    return tgt.tryFile(entry);
  }
  if (Array.isArray(entry)) {
    if (entry.length === 0) return null;
    for (const item of entry) {
      const r = pickExport(item, conditions, tgt);
      if (r === TARGET_INVALID) continue; // 仅「目标非法」才回退（Node 不看存在性）
      return r;
    }
    return null;
  }
  if (entry === null) return null;
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    const declared = Object.keys(o);
    const active = new Set(conditions);
    // 声明顺序取首个命中的**宿主**条件（不得按优先级表重排）。
    for (const k of declared) {
      if (!active.has(k)) continue;
      const r = pickExport(o[k], conditions, tgt);
      if (r === TARGET_INVALID) continue;
      return r;
    }
    // 宿主条件全未命中 ⇒ browser-only 兜底（browser 不是宿主条件，目标缺失不算终局）
    for (const k of declared) {
      if (!FALLBACK_CONDITIONS.includes(k)) continue;
      const r = pickExport(o[k], conditions, tgt);
      if (typeof r === "string") return r;
    }
    // types 仅兜底：主条件键全部 miss 后才尝试。
    // .d.ts 不是可执行入口——不返回给 eval 路径（声明文件求值必失败）。
    if ("types" in o) {
      const r = pickExport(o["types"], conditions, tgt);
      if (typeof r === "string" && !/\.(d\.[cm]?ts)$/.test(r)) return r;
    }
    return TARGET_INVALID;
  }
  return TARGET_INVALID;
}

/**
 * 在 exports 目标树中专找 `nudo` 条件（可嵌套于数组/条件对象深处）。
 * 找到 nudo 子树后用 JS 条件键继续解析（处理 nudo: { import, default } 等嵌套）。
 * 非 nudo 字符串不匹配——那是普通 JS 入口，不属于 sidecar。
 */
function pickNudoExport(
  entry: unknown,
  tgt: TargetTester,
  mode?: NpmLoadMode,
): string | null {
  if (typeof entry === "string") return null;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const r = pickNudoExport(item, tgt, mode);
      if (r) return r;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    if ("nudo" in o) {
      for (const m of modeOrder(mode)) {
        const r = pickExport(o["nudo"], JS_CONDITIONS[m], tgt);
        if (typeof r === "string") return r;
      }
    }
    for (const v of Object.values(o)) {
      const r = pickNudoExport(v, tgt, mode);
      if (r) return r;
    }
  }
  return null;
}

type ExportsEntry = { target: unknown; substitution: string | null };

/**
 * 模式键挑选（Node `PATTERN_KEY_COMPARE`，Bug 267）：先比 `*` 之前的**前缀长度**
 * （更长者胜），平手时比**整键长度**（更长者胜）。旧实现只比前缀且用严格大于
 * ⇒ 平手保留先声明者，宿主却取更长的键 ⇒ 解析到另一个文件。
 */
function bestPatternMatch(
  map: Record<string, unknown>,
  key: string,
): { target: unknown; substitution: string; prefixLen: number; keyLen: number } | null {
  let best: { target: unknown; substitution: string; prefixLen: number; keyLen: number } | null =
    null;
  for (const [patternKey, target] of Object.entries(map)) {
    const starIdx = patternKey.indexOf("*");
    if (starIdx === -1) continue;
    if (patternKey.indexOf("*", starIdx + 1) !== -1) continue; // 仅支持单 *

    const prefix = patternKey.slice(0, starIdx);
    const suffix = patternKey.slice(starIdx + 1);
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    if (key.length < prefix.length + suffix.length) continue;

    const prefixLen = prefix.length;
    const keyLen = patternKey.length;
    const better =
      best === null ||
      prefixLen > best.prefixLen ||
      (prefixLen === best.prefixLen && keyLen > best.keyLen);
    if (better) {
      best = { target, substitution: key.slice(prefixLen, key.length - suffix.length), prefixLen, keyLen };
    }
  }
  return best;
}

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
    const best = bestPatternMatch(map, key);
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

/** 基于 substitution 生成 TargetTester：先替换 *，再分别判合法性与存在性。 */
function makeTryTarget(pkgDir: string, substitution: string | null): TargetTester {
  const substitute = (rel: string): string =>
    substitution !== null ? rel.replace("*", substitution) : rel;
  return {
    isValid: (rel: string): boolean => {
      const sub = substitute(rel);
      if (escapesPackageRoot(sub)) return false;
      return isInsideDir(pkgDir, resolve(pkgDir, sub));
    },
    tryFile: (rel: string): string | null => {
      const sub = substitute(rel);
      return tryInsidePkg(pkgDir, sub, tryPkgFileEsm);
    },
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

/**
 * 包内文件候选。
 *
 * `esm`（exports 目标 / 旧式子路径）：**不补** `index.*`——Node 的 ESM 装载器
 * 从不做 `LOAD_AS_DIRECTORY`，目录目标直接 `ERR_UNSUPPORTED_DIR_IMPORT`
 * （Bug 273）。
 * `legacy`（legacy `main`）：Node 在这里**允许** index 解析 ⇒ 保留候选。
 */
function pkgFileCandidates(p: string, ctx: "esm" | "legacy"): string[] {
  const base = [p, `${p}.js`, `${p}.cjs`, `${p}.mjs`];
  return ctx === "legacy" ? [...base, join(p, "index.js"), join(p, "index.cjs")] : base;
}

/** 包内文件候选 → 首个存在者（ESM 语境：无 index 解析）。 */
function tryPkgFileEsm(p: string): string | null {
  return firstExisting(pkgFileCandidates(p, "esm"));
}

/** legacy `main` 语境（Node 允许目录 / index 解析）。 */
function tryPkgFileLegacy(p: string): string | null {
  return firstExisting(pkgFileCandidates(p, "legacy"));
}

function firstExisting(candidates: readonly string[]): string | null {
  for (const c of candidates) {
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

  const hit = bestPatternMatch(map, spec);
  return hit ? { target: hit.target, substitution: hit.substitution } : null;
}

/**
 * `imports` 目标合法性（Node `ERR_INVALID_PACKAGE_TARGET` 口径，不看存在性）：
 * 包内相对目标不得逃出包目录；`#` 自引用非法；外部裸包目标合法。
 * 数组回退只用这条判据（Bug 270）。
 */
function importTargetIsValid(
  target: unknown,
  pkgDir: string,
  substitution: string | null,
): boolean {
  if (target === null) return true; // 显式屏蔽：终局（不是「非法」）
  if (typeof target === "string") {
    const substituted = substitution !== null ? target.replace("*", substitution) : target;
    if (substituted.startsWith("./") || substituted.startsWith("../")) {
      if (escapesPackageRoot(substituted)) return false;
      return isInsideDir(pkgDir, resolve(pkgDir, substituted));
    }
    if (substituted.startsWith("#")) return false; // 禁止自引用
    return true;
  }
  if (Array.isArray(target)) return target.some((t) => importTargetIsValid(t, pkgDir, substitution));
  return true; // 条件对象：至少有一个条件命中 ⇒ 交给 resolveTarget 判
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
        // imports 字段同样是 ESM 语境 ⇒ 不补 index 候选（Bug 273）
        return tryInsidePkg(scope.dir, substituted, tryPkgFileEsm);
      }
      // 外部包目标（"dep" / "dep/sub"）⇒ 转裸包解析（从导入方包目录起）
      if (substituted.startsWith("#")) return null; // 禁止自引用（否则无限递归）
      return resolveNpmJsEntryDetailed(substituted, scope.dir, mode).path;
    }
    if (Array.isArray(target)) {
      if (target.length === 0) return null;
      for (const item of target) {
        // 回退判据是「目标非法」，不是「文件不存在」（Bug 270，与 exports 同口径）
        if (!importTargetIsValid(item, scope.dir, entry.substitution)) continue;
        return resolveTarget(item);
      }
      return null;
    }
    if (target && typeof target === "object") {
      const o = target as Record<string, unknown>;
      const declared = Object.keys(o);
      for (const m of modeOrder(mode)) {
        // 声明顺序取首个命中条件（Bug 239，与 exports 同口径）
        for (const k of declared) {
          if (!JS_CONDITIONS[m].includes(k)) continue;
          const r = resolveTarget(o[k]);
          if (r) return r;
        }
      }
      for (const k of declared) {
        if (!FALLBACK_CONDITIONS.includes(k)) continue;
        const r = resolveTarget(o[k]);
        if (r) return r;
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

  // 逐级向上找包（Node `PACKAGE_RESOLVE`）：**本层没有该包**才继续往上；
  // 「本层有包但 exports / 目标不认这个子路径」必须**在此终结**（Bug 268）——否则
  // 会解析到父级的同名副本，那是运行时永远不会加载的文件。
  let exportsUnresolved = false;
  for (const pkgDir of findPackageDirs(fromDir, pkgName)) {
    const r = resolveInPkgDir(pkgDir, pkgName, subpath, mode);
    if (r.path) return { path: r.path, exportsUnresolved: false };
    if (r.exportsUnresolved) exportsUnresolved = true;
    if (r.present) break;
  }
  return { path: null, exportsUnresolved };
}

/** 包目录内解析结果（present = 本层确实存在该包 ⇒ 解析终结）。 */
type PkgDirResolution = ResolveNpmJsEntryResult & { present: boolean };

/** 包目录内的入口解析（exports → legacy main → 直接子路径）。 */
function resolveInPkgDir(
  pkgDir: string,
  pkgName: string,
  subpath: string,
  mode?: NpmLoadMode,
): PkgDirResolution {
  const none: PkgDirResolution = { path: null, exportsUnresolved: false, present: false };
  const pkgJsonPath = join(pkgDir, "package.json");

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
  } catch (e) {
    // 读失败分流：ENOENT（未安装）安静 miss；EACCES/EIO 可见后按 miss。
    // package.json 在但读不了 ⇒ 包**存在**（本层终结向上遍历）。
    warnPkgJsonReadError(pkgJsonPath, e);
    return { ...none, present: existsSync(pkgJsonPath) };
  }

  const exportsField = pkg.exports;

  // Node 语义：exports 一旦表态就只走 exports——未命中不得回落 main/直接路径。
  if (exportsField !== undefined && exportsField !== null) {
    const entry = findExportsEntry(exportsField, subpath);
    if (entry) {
      const tryTarget = makeTryTarget(pkgDir, entry.substitution);
      for (const m of modeOrder(mode)) {
        const rel = pickExport(entry.target, JS_CONDITIONS[m], tryTarget);
        if (typeof rel === "string") {
          return { path: rel, exportsUnresolved: false, present: true };
        }
        // 该形态**命中了条件键但目标缺失 / 被屏蔽** ⇒ 解析已终结（Node 不再换形态试）
        if (rel === null) return { path: null, exportsUnresolved: true, present: true };
        // TARGET_INVALID ⇒ 该形态没有可用条件键 ⇒ 才换下一个形态
      }
    }
    // exports 声明了但键不匹配 / 目标缺失 / 目标逃出包目录
    return { path: null, exportsUnresolved: true, present: true };
  }

  // 无 exports：legacy main / module / 直接子路径（仍限制在包目录内）
  if (subpath === ".") {
    const main = typeof pkg.main === "string" ? pkg.main : undefined;
    // legacy main 语境：Node 在这里**允许**目录 / index 解析（Bug 273 对照 D）
    const hit = tryInsidePkg(pkgDir, main ?? ".", tryPkgFileLegacy);
    if (hit) return { path: hit, exportsUnresolved: false, present: true };
    const mod = typeof pkg.module === "string" ? pkg.module : undefined;
    if (mod) {
      const hitMod = tryInsidePkg(pkgDir, mod, tryPkgFileLegacy);
      if (hitMod) return { path: hitMod, exportsUnresolved: false, present: true };
    }
    return { ...none, present: true };
  }
  // 旧式子路径：ESM 下禁止目录导入 ⇒ 不补 index 候选（Bug 273）
  return {
    path: tryInsidePkg(pkgDir, subpath, tryPkgFileEsm),
    exportsUnresolved: false,
    present: true,
  };
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

    const tryTarget = makeTryTarget(pkgDir, entry.substitution);
    return pickNudoExport(entry.target, tryTarget, mode);
  } catch {
    // ignore parse errors
  }

  return null;
}
