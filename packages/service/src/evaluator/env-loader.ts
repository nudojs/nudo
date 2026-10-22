import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve as resolvePath, join as joinPath } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { type Abs, type Environment } from "@nudojs/core";
import { createScopedSlot, registerCollectorScopeParticipant } from "@nudojs/core/internal";
import { defineEnv as defineEsEnv } from "@nudojs/env/es";
import { defineEnv as defineWebEnv } from "@nudojs/env/web";
import { defineEnv as defineNodeEnv } from "@nudojs/env/node";
import { BoundedLruMap } from "../lru-map.ts";

/** Abs 原生 env 定义（内置 es/web/node 与 harvest 产物） */
type EnvDefinition = {
  globals: Record<string, Abs>;
  modules?: Record<string, Record<string, Abs>>;
};

const envFactories: Record<string, () => EnvDefinition> = {
  es: defineEsEnv,
  web: defineWebEnv,
  node: defineNodeEnv,
};

const impliedDeps: Record<string, string[]> = {
  web: ["es"],
  node: ["es"],
};

/**
 * 表项自有取：裸 `table[key]` 会命中 Object.prototype 的 constructor /
 * toString 等键——env 名来自用户配置（`package.json#nudo.env`）与指令载荷，
 * 键空间不受控 ⇒ 必须走自有取，否则 "constructor" 这类名会取到 Object 构造器
 * 并在工厂调用处炸掉。
 */
function ownEnvEntry<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * 当前 env 基目录（相对 path env 说明符的解析基准）。
 *
 * 不变量：相对说明符（`./env.ts` / `../env.ts`）只按**发起方文件的目录**
 * 解析——进程级 baseDir 注册表「逐个尝试」会让先预载的那个 `./env.ts`
 * 赢下所有同名拼写（别的目录拿到别人的 env ⇒ 错值 + 零诊断）。
 *
 * 作用域化（core scoped slot）：并发分析各开各的 store，互不串台；
 * 槽未设（作用域外）时回落模块级的最近一次 preload 基目录。
 */
let lastEnvBaseDir = process.cwd();
const envBaseDirSlot = createScopedSlot<string | null>(() => null);
registerCollectorScopeParticipant((body) => envBaseDirSlot.runScoped(body));

function setEnvBaseDir(baseDir: string): void {
  lastEnvBaseDir = baseDir;
  envBaseDirSlot.set(baseDir);
}

function currentEnvBaseDir(): string {
  return envBaseDirSlot.get() ?? lastEnvBaseDir;
}

function resolveEnvNames(names: readonly unknown[]): string[] {
  const resolved = new Set<string>();
  const visit = (name: string) => {
    if (resolved.has(name)) return;
    const deps = ownEnvEntry(impliedDeps, name);
    if (deps) deps.forEach(visit);
    resolved.add(name);
  };
  for (const name of names) {
    // 元素级校验：配置里的 env 项类型不受控（非字符串元素不得裸崩）
    if (typeof name !== "string") continue;
    visit(name);
  }
  return [...resolved];
}

export type LoadedEnv = {
  /** Abs 原生模块导出（求值引擎 / Abs 模块图） */
  modules: Record<string, Record<string, Abs>>;
  globals: Record<string, Abs>;
};

// Path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) are imported
// asynchronously and cached here; the sync loadEnvs() below consults this map
// so sync consumers (analyzeFile & friends) see them after a preload pass.
//
// 上限 PATH_ENV_CACHE_MAX / PATH_ENV_BY_PATH_MAX / PATH_ENV_BASE_DIRS_MAX + LRU：
// 命中/写入移到队尾，超限删最旧。条目是 defineEnv 工厂（闭包持 HarvestedEnv
// 级 globals/modules），故必须有界；clearPathEnvCaches 语义不变。
const PATH_ENV_CACHE_MAX = 64;
const PATH_ENV_BY_PATH_MAX = 64;
const PATH_ENV_BASE_DIRS_MAX = 64;
const pathEnvCache = new BoundedLruMap<() => EnvDefinition>(PATH_ENV_CACHE_MAX);
// resolvedPath → factory; looked up by the directive spelling resolved against
// the **initiating file's own directory**（`./env.ts` / `../env.ts` 唯一候选，
// 裸拼写 `env.ts` 先当前目录再回落历史 baseDir）——相对说明符不得按进程级
// baseDir 注册表「逐个尝试」，否则先预载者赢下所有同名拼写。
const pathEnvByPath = new BoundedLruMap<{
  factory: () => EnvDefinition;
  mtimeMs: number;
  size: number;
}>(PATH_ENV_BY_PATH_MAX);
// Set 保持插入序；超上限时删最旧 baseDir（LRU 等价——最近 preload 的排到尾）。
const pathEnvBaseDirs = new Set<string>();

function addPathEnvBaseDir(baseDir: string): void {
  pathEnvBaseDirs.delete(baseDir);
  pathEnvBaseDirs.add(baseDir);
  while (pathEnvBaseDirs.size > PATH_ENV_BASE_DIRS_MAX) {
    const oldest = pathEnvBaseDirs.values().next().value;
    if (oldest === undefined) break;
    pathEnvBaseDirs.delete(oldest);
  }
}

/** 测试/诊断：path-env 驻留规模（均 ≤ 对应上限） */
export function getPathEnvCacheSizes(): { byKey: number; byPath: number; baseDirs: number } {
  return {
    byKey: pathEnvCache.size,
    byPath: pathEnvByPath.size,
    baseDirs: pathEnvBaseDirs.size,
  };
}

function isPathEnvName(name: string, baseDir: string): boolean {
  // 元素级校验：非字符串元素（配置 `nudo.env: [42]` 之类）不得裸崩
  if (typeof name !== "string") return false;
  // 内建名走自有取：`name in envFactories` 会命中 Object.prototype 的键
  if (ownEnvEntry(envFactories, name)) return false;
  if (name.includes("/") || name.startsWith("./") || name.startsWith("../")) return true;
  const resolved = resolvePath(baseDir, name);
  return resolved.endsWith(".ts") && existsSync(resolved);
}

// A harvested env file lives anywhere on disk (e.g. /tmp) and imports
// "@nudojs/core" — a bare specifier that only resolves from inside the repo's
// packages. When the direct import fails, rewrite those specifiers to absolute
// file URLs (resolved from this package, which depends on them) and import a
// cached copy under the OS tmpdir.
function rewriteBareImports(text: string): string | null {
  const require = createRequire(import.meta.url);
  let rewrote = false;
  // 子路径 specifier（`@nudojs/env/es`、`@nudojs/core/xyz`）也须重写；
  // 原正则只认裸包名，子路径无法匹配 → env 文件被静默丢弃（issue #88）。
  const out = text.replace(/(["'])(@nudojs\/[a-z0-9-]+(?:\/[^"']+)*)\1/g, (_m, quote: string, spec: string) => {
    try {
      const entry = require.resolve(spec);
      const url = pathToFileURL(entry).href;
      rewrote = true;
      return `${quote}${url}${quote}`;
    } catch {
      return `${quote}${spec}${quote}`;
    }
  });
  return rewrote ? out : null;
}

async function importPathEnv(resolvedPath: string, mtimeMs: number, size: number, baseDir: string): Promise<void> {
  // 键与校验双值（mtimeMs+size，stat 一次两值都拿）：粗 mtime 粒度文件系统上
  // 「同秒编辑」若只看 mtime，旧 defineEnv 工厂陈旧命中且 recordPathEnvFile
  // 重登记旧值会自我续命——size 变化必须击穿缓存（全仓 mtimeMs+size 严格相等口径）。
  const cacheKey = `${resolvedPath}:${mtimeMs}:${size}`;
  // get 触发 LRU 触摸（命中仍返回同一 factory）；命中也是「已成功加载」，
  // 必须补记本次 baseDir 归属（同一 env 文件可被多个 baseDir 的 preload 命中）
  if (pathEnvCache.get(cacheKey)) {
    recordPathEnvFile(resolvedPath, mtimeMs, baseDir);
    clearPathEnvError(resolvedPath);
    return;
  }

  let mod: { defineEnv?: unknown } | null = null;
  let directErr: unknown = null;
  try {
    // URL query 同样带 size：同 mtime 不同 size 的编辑必须换 URL，否则
    // Node/vite ESM 模块缓存按地址命中旧内容。
    const url = pathToFileURL(resolvedPath).href + `?mtime=${mtimeMs}&size=${size}`;
    mod = (await import(url)) as { defineEnv?: unknown };
  } catch (e) {
    // Fall through to the rewritten-copy fallback below.
    directErr = e;
    mod = null;
  }

  if (!mod) {
    try {
      const text = readFileSync(resolvedPath, "utf-8");
      const rewritten = rewriteBareImports(text);
      if (rewritten === null) {
        recordPathEnvError(resolvedPath, baseDir, directErr); // 无可重写 → import 失败原因上报
        return;
      }
      const cacheDir = joinPath(tmpdir(), "nudo-env");
      mkdirSync(cacheDir, { recursive: true });
      // 副本文件名用 rewritten 内容指纹：键若只含 path:mtime，内容变而 mtime
      // 不变时 Node ESM 按同一 URL 命中旧模块，新内容永不生效。内容变 → 文件
      // 名变 → URL 变 → ESM 缓存自然失效。旧副本留在 tmpdir 由 OS 清理，不另扫。
      const hash = createHash("md5").update(rewritten).digest("hex").slice(0, 16);
      const copyPath = joinPath(cacheDir, `${hash}.ts`);
      writeFileSync(copyPath, rewritten, "utf-8");
      mod = (await import(pathToFileURL(copyPath).href)) as { defineEnv?: unknown };
    } catch (e) {
      recordPathEnvError(resolvedPath, baseDir, e);
      return;
    }
  }

  if (mod && typeof mod.defineEnv === "function") {
    pathEnvCache.set(cacheKey, mod.defineEnv as () => EnvDefinition);
    pathEnvByPath.set(resolvedPath, {
      factory: mod.defineEnv as () => EnvDefinition,
      mtimeMs,
      size,
    });
    recordPathEnvFile(resolvedPath, mtimeMs, baseDir);
    clearPathEnvError(resolvedPath);
  } else {
    // 工厂契约不合规（不导出 defineEnv / 不是函数）⇒ 失败必须进通道：
    // 此前此处无 else 分支 ⇒ 零 env 诊断 ⇒ env 静默失效 ⇒ 用户代码被误判
    // 「必然抛 ReferenceError」（假红），而同目录里**语法错**的 env 文件
    // 反而有 nudo:env-unresolved 警告（口径分裂）。
    const got = mod ? typeof mod.defineEnv : "no module";
    recordPathEnvError(
      resolvedPath,
      baseDir,
      new Error(`env file must export a defineEnv() function (got ${got})`),
    );
  }
}

/** path env 注册表命中项：工厂 + 命中路径（诊断要点名 env 文件） */
type PathEnvHit = { factory: () => EnvDefinition; path: string };

/**
 * 相对说明符的候选路径。
 *
 * 不变量：`./x.ts` / `../x.ts` 这类**相对说明符只按发起方文件的目录解析**
 * （唯一候选）——进程级 baseDir 注册表「逐个尝试 + 先命中者胜出」会让先预载的
 * 那个 `./env.ts` 赢下所有同名拼写（别的目录拿到别人的 env ⇒ 错值 + 零诊断）。
 * 裸拼写（`env.ts`，无目录语义）先按当前基目录，再回落历史 baseDir（兼容旧行为）。
 */
function pathEnvCandidates(name: string, baseDir: string): string[] {
  if (name.startsWith("/")) return [name];
  if (name.startsWith("./") || name.startsWith("../")) return [resolvePath(baseDir, name)];
  const out = [resolvePath(baseDir, name)];
  for (const d of pathEnvBaseDirs) {
    if (d === baseDir) continue;
    out.push(resolvePath(d, name));
  }
  return out;
}

function lookupPathEnv(name: string, baseDir: string): PathEnvHit | undefined {
  if (pathEnvByPath.size === 0) return undefined;
  for (const candidate of pathEnvCandidates(name, baseDir)) {
    const hit = pathEnvByPath.get(candidate);
    if (!hit) continue;
    // mtime/size 任一变了 → 丢弃陈旧 factory（下次 preload 会重 import）
    try {
      const { mtimeMs, size } = statSync(candidate);
      if (mtimeMs !== hit.mtimeMs || size !== hit.size) {
        pathEnvByPath.delete(candidate);
        return undefined;
      }
    } catch {
      pathEnvByPath.delete(candidate);
      return undefined;
    }
    return { factory: hit.factory, path: candidate };
  }
  return undefined;
}

/** Host cache-clear hooks (CLI watch / vite / tests) must drop path-env modules too */
export function clearPathEnvCaches(): void {
  pathEnvCache.clear();
  pathEnvByPath.clear();
  pathEnvBaseDirs.clear();
  pathEnvFiles.clear();
  pathEnvLoadErrors.length = 0;
  // 基目录基准一并复位（相对说明符不得解析到上一轮的目录）
  lastEnvBaseDir = process.cwd();
  envBaseDirSlot.set(null);
}

// path env 文件级诊断（import 失败必须可见——issue #88）与缓存指纹。
// 两个注册表条目都携带「记录时的 baseDir」：批量 check 跨项目时按 preload
// 目录隔离——a 项目的 env 加载失败不得泄进 b 项目文件报告，b 的磁盘缓存键
// 不得折入 a 的 env 内容（同一 env 文件可被多个 baseDir 引用，逐个归属）。
const pathEnvFiles = new Map<string, { mtimeMs: number; baseDirs: Set<string> }>();
const pathEnvLoadErrors: Array<{ path: string; error: string; baseDir: string }> = [];

function recordPathEnvFile(path: string, mtimeMs: number, baseDir: string): void {
  const entry = pathEnvFiles.get(path);
  if (entry) {
    entry.mtimeMs = mtimeMs;
    entry.baseDirs.add(baseDir);
  } else {
    pathEnvFiles.set(path, { mtimeMs, baseDirs: new Set([baseDir]) });
  }
}

function recordPathEnvError(path: string, baseDir: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  // 去重补充：同一 path+baseDir 保留最新错误
  const i = pathEnvLoadErrors.findIndex((x) => x.path === path && x.baseDir === baseDir);
  if (i >= 0) pathEnvLoadErrors[i] = { path, error: msg, baseDir };
  else pathEnvLoadErrors.push({ path, error: msg, baseDir });
}

function clearPathEnvError(path: string): void {
  // 该文件现已成功加载 → 此前任意 baseDir 记录的错误均已过时，全部清除
  for (let i = pathEnvLoadErrors.length - 1; i >= 0; i--) {
    if (pathEnvLoadErrors[i].path === path) pathEnvLoadErrors.splice(i, 1);
  }
}

/**
 * 未知名 env（既非内建、也不是可解析的 path env）⇒ 必须可见。
 *
 * 此前 loadEnvs 对查不到的名字直接 `continue` ⇒ 零诊断、env 不生效、分析
 * 退化（`@nudo:env bogus` / `nodejs` / `Node` 全都静默）。诊断走既有的
 * path env 失败通道（nudo:env-unresolved 消费面：CLI check/test + LSP）。
 */
function recordUnknownEnvName(name: string, baseDir: string): void {
  const builtins = Object.keys(envFactories).join(", ");
  recordPathEnvError(
    name,
    baseDir,
    new Error(
      `unknown env name "${name}" (built-in envs: ${builtins}; a path env needs a ./ or ../ prefix)`,
    ),
  );
}

/** 非法 env 项（非字符串元素）⇒ 丢弃 + 可见告警（不得裸崩） */
function recordInvalidEnvEntry(entry: unknown, baseDir: string): void {
  let rendered: string;
  try {
    rendered = JSON.stringify(entry) ?? String(entry);
  } catch {
    rendered = String(entry);
  }
  const kind = entry === null ? "null" : typeof entry;
  recordPathEnvError(
    rendered,
    baseDir,
    new Error(`invalid env entry: expected a string, got ${kind} (${rendered})`),
  );
}

/**
 * defineEnv() 返回形状校验：契约是 `{ globals, modules? }`。
 * 缺失 / 非对象的 globals ⇒ 明确报错（此前 `Object.entries(undefined)` 抛出
 * 的 TypeError 被求值侧兜底 catch 吃掉 ⇒ 用户什么也看不到）。
 */
function envDefinitionShapeError(def: unknown): string | null {
  if (def === null || typeof def !== "object" || Array.isArray(def)) {
    return `defineEnv() must return { globals } (got ${def === null ? "null" : typeof def})`;
  }
  const globals = (def as { globals?: unknown }).globals;
  if (globals === null || typeof globals !== "object" || Array.isArray(globals)) {
    return `defineEnv() must return { globals } (globals is ${
      globals === null ? "null" : typeof globals
    })`;
  }
  const modules = (def as { modules?: unknown }).modules;
  if (modules !== undefined && (modules === null || typeof modules !== "object" || Array.isArray(modules))) {
    return `defineEnv() must return { globals, modules? } (modules is ${
      modules === null ? "null" : typeof modules
    })`;
  }
  return null;
}

/**
 * path env 加载失败诊断（check/test 打印 nudo:env-unresolved warning 用）。
 * 传入 baseDir 时按记录时的 preload 目录精确过滤（批量 check 跨项目不泄漏）；
 * 不传返回全量（兼容既有全量消费面）。
 */
export function getPathEnvLoadErrors(baseDir?: string): Array<{ path: string; error: string; baseDir: string }> {
  return baseDir === undefined
    ? [...pathEnvLoadErrors]
    : pathEnvLoadErrors.filter((x) => x.baseDir === baseDir);
}

/**
 * 已成功预载的 path env 文件（供 check 磁盘缓存指纹纳入 sha）。
 * 传入 baseDir 时只返回该 preload 目录引用的 env 文件；不传返回全量。
 */
export function getPathEnvDepContents(baseDir?: string): Array<{ path: string; content: string | null }> {
  const out: Array<{ path: string; content: string | null }> = [];
  for (const [p, entry] of pathEnvFiles) {
    if (baseDir !== undefined && !entry.baseDirs.has(baseDir)) continue;
    let content: string | null = null;
    try {
      content = readFileSync(p, "utf-8");
    } catch {
      content = null;
    }
    out.push({ path: p, content });
  }
  return out;
}

/**
 * **预载状态**指纹（已驻留的 path env 文件：路径 + mtimeMs）。
 *
 * Bug 993：path 型 env 只能**异步**装载（动态 import），同步 `analyzeFile`
 * 看不到 env 全局。于是同一份源码在「预载前 / 预载后」得到两份不同的
 * 分析结果，而整文件 memo 的键里只有 env 文件的**内容**（dep 指纹），
 * 没有**预载状态**——「先同步、后异步」时后者会命中前者那份「无 env」的
 * 陈旧结果（env 全局仍不可见 ⇒ never / unknown）。
 *
 * 把本指纹放进分析缓存键 ⇒ 预载前后的键不同 ⇒ 两份结果互不串台。
 */
export function pathEnvPreloadFingerprint(): string {
  if (pathEnvFiles.size === 0) return "";
  const parts: string[] = [];
  for (const [p, entry] of pathEnvFiles) parts.push(`${p}=${entry.mtimeMs}`);
  parts.sort();
  return parts.join("\u0001");
}

export async function preloadPathEnvs(envNames: string[], baseDir: string): Promise<void> {
  addPathEnvBaseDir(baseDir);
  // 相对说明符的解析基准 = 本次 preload 的目录（发起方文件所在目录）
  setEnvBaseDir(baseDir);
  for (const name of envNames) {
    // 元素级校验：配置里的 env 项类型不受控（非字符串元素不得裸崩）
    if (typeof name !== "string") {
      recordInvalidEnvEntry(name, baseDir);
      continue;
    }
    // 内建名（es/web/node）不是 path 形态
    if (ownEnvEntry(envFactories, name)) continue;
    if (!isPathEnvName(name, baseDir)) {
      // 未知名：既非内建、也不是可解析的 path env ⇒ 必须可见（不得静默忽略）
      recordUnknownEnvName(name, baseDir);
      continue;
    }
    const resolved = resolvePath(baseDir, name);
    if (!existsSync(resolved)) {
      // 缺失文件必须可见（此前静默跳过 → env-关降级无任何诊断）：与 import
      // 失败同表同码（nudo:env-unresolved，check/test/LSP 三面消费）。不进
      // pathEnvFiles 依赖表——缺失文件无内容可折入缓存指纹；文件后来被创建
      // 时成功 preload 会把它加入指纹表，缓存键随之变化自然失效（mtime 语义
      // 不变：缺失期间表里本就没有它的条目，不存在永不失效的陈旧 mtime）。
      recordPathEnvError(resolved, baseDir, new Error(`path env not found: ${resolved}`));
      continue;
    }
    try {
      const { mtimeMs, size } = statSync(resolved);
      await importPathEnv(resolved, mtimeMs, size, baseDir);
    } catch (e) {
      recordPathEnvError(resolved, baseDir, e);
    }
  }
}

export async function loadEnvsAsync(
  envNames: string[],
  globalEnv: Environment,
  baseDir: string = process.cwd(),
): Promise<LoadedEnv> {
  await preloadPathEnvs(envNames, baseDir);
  return loadEnvs(envNames, globalEnv, baseDir);
}

/**
 * env 名 → Abs 全局 / 模块表。
 *
 * 不变量：
 * - 名字表查项走**自有取**（`envFactories["constructor"]` 会取到 Object 构造器）；
 * - 元素级校验：非字符串元素丢弃 + 可见告警（不裸崩）；
 * - 查不到的名字**不得静默 `continue`**：未知名 → 可见告警；
 * - path env 工厂必须满足 `defineEnv()` 契约：抛异常 / 返回形状非法 ⇒
 *   可见告警（此前被求值侧兜底 catch 吃掉 ⇒ env 静默失效 ⇒ 假红）。
 */
export function loadEnvs(envNames: string[], globalEnv: Environment, baseDir?: string): LoadedEnv {
  const allModules: Record<string, Record<string, Abs>> = {};
  const allGlobals: Record<string, Abs> = {};
  const base = baseDir ?? currentEnvBaseDir();
  // 元素级校验：非法元素（非字符串）丢弃 + 可见告警——此前一路裸崩到
  // `name.includes is not a function`（进程顶层兜底只打印 message）。
  for (const raw of envNames) {
    if (typeof raw !== "string") recordInvalidEnvEntry(raw, base);
  }
  const resolved = resolveEnvNames(envNames);

  for (const name of resolved) {
    const builtin = ownEnvEntry(envFactories, name);
    if (builtin) {
      applyEnvDefinition(builtin(), allModules, allGlobals, globalEnv);
      continue;
    }
    const hit = lookupPathEnv(name, base);
    if (!hit) {
      // path 形态的失败由 preload 通道负责（缺失文件 / import 失败）；
      // 其余（未知名）在此可见化——静默跳过会让 env 不生效且零诊断。
      if (!isPathEnvName(name, base)) recordUnknownEnvName(name, base);
      continue;
    }
    let def: EnvDefinition;
    try {
      def = hit.factory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordPathEnvError(hit.path, base, new Error(`defineEnv() threw: ${msg}`));
      continue;
    }
    const shapeError = envDefinitionShapeError(def);
    if (shapeError) {
      recordPathEnvError(hit.path, base, new Error(shapeError));
      continue;
    }
    applyEnvDefinition(def, allModules, allGlobals, globalEnv);
  }

  return { modules: allModules, globals: allGlobals };
}

function applyEnvDefinition(
  def: EnvDefinition,
  allModules: Record<string, Record<string, Abs>>,
  allGlobals: Record<string, Abs>,
  globalEnv: Environment,
): void {
  for (const [key, value] of Object.entries(def.globals)) {
    allGlobals[key] = value;
    globalEnv.bind(key, value);
  }
  if (def.modules) {
    for (const [modName, exports] of Object.entries(def.modules)) {
      allModules[modName] = { ...allModules[modName], ...exports };
    }
  }
}
