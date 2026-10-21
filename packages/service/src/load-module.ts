/**
 * 相对/绝对 specifier → 模块源码。
 *
 * 候选表按**加载形态**分表（Node 的两条解析算法，不再合成一张）：
 * - CJS（require）：LOAD_AS_FILE —— 猜扩展名（.js/.cjs/.mjs/.json/.ts）+ index 入口；
 * - ESM（import）：ESM_RESOLVE —— **不猜扩展名**（必须写全）+ 不做目录 import。
 *
 * 同一**形态**在各 loader（CLI / LSP / vite / check）间共用同一张表，避免门禁
 * 结果分叉；**跨形态**共用一张表是错的（Bug 505：`require("./data")` 找不到同
 * 目录的 `data.json`（假红 error），`import "./data"` 却把 `data.js` 解析成功
 * （假绿）——两条算法合成一张表 ⇒ 两个方向都错）。
 */

import { statSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { BoundedLruMap } from "./lru-map.ts";

export type LoadModule = (spec: string, fromFile: string) => string | undefined;

/** 加载形态：ESM import / CJS require（决定用 Node 的哪条解析算法）。 */
export type ModuleLoadMode = "import" | "require";

/** 合并表（形态未知时用）：文件后缀与 index 入口同序展开。 */
export const MODULE_RESOLVE_EXTS = [".js", ".mjs", ".ts"] as const;

/**
 * CJS（require）候选表：Node 的 LOAD_AS_FILE。
 * Node 的扩展名是 .js/.json/.node —— .node 是原生插件（nudo 不求值）故不入表；
 * nudo 另支持 .cjs/.mjs/.ts（ESM 源与 TS 源）。
 */
export const CJS_RESOLVE_EXTS = [".js", ".cjs", ".mjs", ".json", ".ts"] as const;

/**
 * ESM（import）候选表：Node 的 ESM_RESOLVE —— **不猜扩展名**（必须写全），
 * 且不做目录 import（Node 的 ESM 解析器不支持 index 入口）。
 */
export const ESM_RESOLVE_EXTS = [] as const;

/** 候选表种类：cjs / esm / 合并表（形态未知）。 */
type ResolveTable = "cjs" | "esm" | "merged";

/** package scope 的 type 字段缓存（读盘代价；进程内有界驻留）。 */
const scopeTypeCache = new BoundedLruMap<"module" | "commonjs">(256);

/**
 * 最近 package.json 的 type 字段（Node 的模块格式判定依据）。
 * 找不到 package.json ⇒ "commonjs"（Node 的缺省）。
 * 缓存按「起始目录」键——同目录的多个文件共享一次查找。
 */
function packageScopeType(startDir: string): "module" | "commonjs" {
  const hit = scopeTypeCache.get(startDir);
  if (hit !== undefined) return hit;
  let dir = resolve(startDir);
  const root = resolve("/");
  let result: "module" | "commonjs" = "commonjs";
  for (;;) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      try {
        const pkg = JSON.parse(readFileSync(pj, "utf-8")) as { type?: unknown };
        result = pkg.type === "module" ? "module" : "commonjs";
      } catch {
        /* package.json 读/解析失败 ⇒ 按 commonjs（读不到 scope 就当 CJS） */
      }
      break;
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  scopeTypeCache.set(startDir, result);
  return result;
}

/**
 * 引用方文件的加载形态（Node 的模块格式判定）：
 * - .mjs/.mts ⇒ ESM；.cjs/.cts ⇒ CJS；
 * - .js/.jsx ⇒ 最近 package.json 的 type（"module" ⇒ ESM，否则 CJS）；
 * - .ts/.tsx ⇒ 形态未知（import / require 皆可）⇒ 合并表（保持既有行为：
 *   TS 生态的解析口径是 legacy-node（tsc / bundler），不是 Node 的 ESM 严格表）。
 *
 * 局限：形态是**文件级**近似——CJS 文件里的动态 import() / ESM 文件里的
 * createRequire().require() 会被判反（说明符级的形态需由调用方按 AST 传入）。
 */
function resolveTableOf(fromFile: string): ResolveTable {
  const ext = extname(fromFile).toLowerCase();
  if (ext === ".mjs" || ext === ".mts") return "esm";
  if (ext === ".cjs" || ext === ".cts") return "cjs";
  if (ext === ".ts" || ext === ".tsx") return "merged";
  return packageScopeType(dirname(resolve(fromFile))) === "module" ? "esm" : "cjs";
}

/**
 * 统一候选表：spec + 引用方文件 → 依次尝试的路径。
 * 所有相对 import/require 解析（load / 模块图 / 脏图边 / env 装载）必须走这里。
 *
 * mode 省略 ⇒ 按引用方文件的模块格式自动选表（见 resolveTableOf）；
 * 显式给出 ⇒ 用该形态的表（调用方知道说明符来源形态时用）。
 */
export function moduleResolveCandidates(
  spec: string,
  fromFile: string,
  mode?: ModuleLoadMode,
): string[] {
  const p = resolve(dirname(resolve(fromFile)), spec);
  const table: ResolveTable = mode ? (mode === "import" ? "esm" : "cjs") : resolveTableOf(fromFile);
  if (table === "esm") {
    // ESM_RESOLVE：不猜扩展名、不做目录 import（Node 的 ESM 解析器口径）
    return [p, ...ESM_RESOLVE_EXTS.map((e) => `${p}${e}`)];
  }
  const exts = table === "cjs" ? CJS_RESOLVE_EXTS : MODULE_RESOLVE_EXTS;
  return [
    p,
    ...exts.map((e) => `${p}${e}`),
    ...exts.map((e) => join(p, `index${e}`)),
  ];
}

/**
 * 首个真实文件候选（跳过目录）；无命中返回 undefined。
 *
 * fs 错误分类（#135）：单次 statSync（顺带消灭 existsSync+statSync 的
 * TOCTOU 双调用）——「路径不存在」类按该候选 miss 继续；其余
 * （EACCES / EIO / ESTALE / EMFILE / EROFS…）是真实读故障，抛
 * ModuleReadError 上抛。此前 existsSync 吞掉一切错误 + 外层 catch 吞
 * statSync 抛错，瞬态故障被折叠成「无此文件」，再被上游缓存钉死整场。
 *
 * 性能（OSS bench 回退根因，b6495c6e 引入）：裸 statSync 对不存在的
 * 候选路径**抛异常**——模块解析的扩展名/index 候选探测大多 miss，
 * 每次都付异常构造+栈捕获成本（semver 49 文件 × 129 条边实测 +50%）。
 * `throwIfNoEntry: false`（Node ≥14.17）让 ENOENT/ENOTDIR 零异常返回
 * undefined，真实故障照抛——#135 语义不变，miss 成本回到 existsSync 量级。
 */
export function resolveModuleFile(
  spec: string,
  fromFile: string,
  mode?: ModuleLoadMode,
): string | undefined {
  for (const cand of moduleResolveCandidates(spec, fromFile, mode)) {
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(cand, { throwIfNoEntry: false });
    } catch (e) {
      throw new ModuleReadError(cand, e);
    }
    if (st !== undefined && !st.isDirectory()) return cand;
  }
  return undefined;
}

/**
 * 路径 stat 或文件读失败（EACCES / EMFILE / ESTALE / EIO …）。
 * 与「无此文件」（loadModule 返回 undefined）必须区分：侧车 auto-bind 在
 * 读失败时静默失效会让约束回落 any，且没有任何 nudo:interface-load。
 */
export class ModuleReadError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(path: string, cause: unknown) {
    const code = (cause as { code?: string } | undefined)?.code ?? "EREAD";
    super(`cannot read module '${path}': ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ModuleReadError";
    this.code = code;
    this.path = path;
  }
}

/**
 * 默认 loadModule：相对/绝对说明符 → 源码。
 * 候选表按加载形态分（见 moduleResolveCandidates）：CJS 面 .js/.cjs/.mjs/.json/.ts
 * + index 入口；ESM 面只认精确路径。
 * 契约：无候选文件 → undefined；stat/read 级真实 fs 错误 → 抛
 * ModuleReadError（调用方可据此区分「无侧车」与「侧车不可读」）。
 *
 * mode：省略 ⇒ 按 fromFile 的模块格式自动选候选表；显式给出 ⇒ 该形态的表。
 */
export function defaultLoadModule(
  spec: string,
  fromFile: string,
  mode?: ModuleLoadMode,
): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  // stat 级真实 fs 故障以 ModuleReadError 上抛（不得折叠成「无此文件」）
  const cand = resolveModuleFile(spec, fromFile, mode);
  if (!cand) return undefined;
  try {
    return readFileSync(cand, "utf-8");
  } catch (e) {
    // ENOENT：resolve 与 read 之间的竞态删文件，按「无此文件」处理
    if ((e as { code?: string } | undefined)?.code === "ENOENT") return undefined;
    throw new ModuleReadError(cand, e);
  }
}

/**
 * 依赖装载的三态结果：**区分「无此文件」与「存在但不可读」**。
 * 「不可读」（EACCES/EIO/EMFILE…）不得折叠成「不存在」——那会让诊断与事实
 * 相反（文件就在那儿，只是读不了）。
 */
export type ModuleLoadOutcome =
  | { kind: "ok"; path: string; content: string }
  | { kind: "missing" }
  | { kind: "unreadable"; path: string; code: string; message: string };

function unreadableOutcome(path: string, e: unknown): ModuleLoadOutcome {
  const code = (e as { code?: string } | undefined)?.code ?? "EREAD";
  const message = e instanceof Error ? e.message : String(e);
  return { kind: "unreadable", path, code, message };
}

/**
 * 相对说明符 → 源码 / 三态结果（与 defaultLoadModule 同一候选表口径）。
 * 命中顺序同 Node 的 LOAD_AS_FILE：**第一个存在的文件候选**即被采用，
 * 读失败即报「不可读」（不再试下一个候选把故障折叠成「不存在」）。
 */
export function loadModuleOutcome(
  spec: string,
  fromFile: string,
  mode?: ModuleLoadMode,
): ModuleLoadOutcome {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return { kind: "missing" };
  for (const cand of moduleResolveCandidates(spec, fromFile, mode)) {
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(cand, { throwIfNoEntry: false });
    } catch (e) {
      return unreadableOutcome(cand, e);
    }
    if (st === undefined || st.isDirectory()) continue;
    try {
      return { kind: "ok", path: cand, content: readFileSync(cand, "utf-8") };
    } catch (e) {
      // ENOENT：resolve 与 read 之间的竞态删文件 → 试下一个候选
      if ((e as { code?: string } | undefined)?.code === "ENOENT") continue;
      return unreadableOutcome(cand, e);
    }
  }
  return { kind: "missing" };
}

/** safeLoadModule 已告警路径（一次性，防刷屏）。 */
const safeLoadWarned = new Set<string>();

/**
 * loadModule 容错包装：读失败当 miss，避免 I/O 错误炸穿指纹/图遍历。
 * 容错 ≠ 不可观测：非 ENOENT 的真实 fs 故障（EACCES/EIO…）按路径一次性
 * console.error 告警——静默吞掉会让「模块面缺失」伪装成「无此模块」。
 */
export function safeLoadModule(
  loadModule: (spec: string, fromFile: string) => string | undefined,
  spec: string,
  fromFile: string,
): string | undefined {
  try {
    return loadModule(spec, fromFile);
  } catch (e) {
    const err = e as { code?: string; path?: string } | undefined;
    if (err?.code !== undefined && err.code !== "ENOENT") {
      const at = err.path ?? spec;
      if (!safeLoadWarned.has(at)) {
        safeLoadWarned.add(at);
        console.error(`[nudo] module load failed (${at}): ${err.code}`);
      }
    }
    return undefined;
  }
}

/**
 * 宿主 loader 的容错包装（Bug 499）：读失败（EACCES/EIO/EMFILE…）**不得穿透
 * 到 CLI 顶层**——一个不可读的依赖会把整轮分析带走（stdout 0 字节、无报告）。
 * 这里退化为「该依赖不可用」+ 一次性可见告警（带 errno 与路径）。
 *
 * onFailure：可选回调——把失败转成结构化诊断（如 nudo:module-unreadable），
 * 供模块图 / 调用图侧上报；不传则只留 stderr 可见性。
 */
export function guardedLoadModule(
  loadModule: LoadModule,
  onFailure?: (failure: { path: string; code: string; message: string }) => void,
): LoadModule {
  return (spec, fromFile) => {
    try {
      return loadModule(spec, fromFile);
    } catch (e) {
      const err = e as { code?: string; path?: string; message?: string } | undefined;
      const code = err?.code ?? "EREAD";
      if (code === "ENOENT") return undefined;
      const path = err?.path ?? spec;
      const message = err?.message ?? (e instanceof Error ? e.message : String(e));
      if (!safeLoadWarned.has(path)) {
        safeLoadWarned.add(path);
        console.error(`[nudo] module load failed (${path}): ${code}`);
      }
      onFailure?.({ path, code, message });
      return undefined;
    }
  };
}
