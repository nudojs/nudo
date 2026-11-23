/**
 * 注解解析的**跨文件模块解析**：相对路径 / 包名 / tsconfig paths。
 *
 * 只读类型声明源码，不执行、不装载模块。返回 `undefined` = 无此文件
 * （解析 miss）；真实读故障照常上抛给调用方。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { nodeNextSpecRewrites } from "./module-specifier-rewrites.ts";

const TYPE_EXTS = [".ts", ".tsx", ".d.ts", ".mts", ".cts"];
const INDEX_NAMES = ["index.d.ts", "index.ts", "index.tsx"];

const sourceMemo = new Map<string, string | undefined>();
const MEMO_MAX = 256;

function readSource(path: string): string | undefined {
  const hit = sourceMemo.get(path);
  if (hit !== undefined || sourceMemo.has(path)) return hit;
  let text: string | undefined;
  try {
    if (statSync(path, { throwIfNoEntry: false })?.isFile()) text = readFileSync(path, "utf8");
  } catch {
    text = undefined;
  }
  if (sourceMemo.size >= MEMO_MAX) sourceMemo.delete(sourceMemo.keys().next().value!);
  sourceMemo.set(path, text);
  return text;
}

function fileWithExts(raw: string, fromFile?: string): string | undefined {
  // `import type { T } from "./types.js"` 是 NodeNext / bundler 的常见写法；
  // 与运行时加载共用同一份改写表（`module-specifier-rewrites.ts`），否则同一
  // specifier 可能在求值面与注解面解析到不同文件。
  const candidates = [raw, ...(fromFile ? nodeNextSpecRewrites(raw, fromFile) : [])];
  for (const ext of TYPE_EXTS) candidates.push(`${raw}${ext}`);
  for (const cand of candidates) {
    const text = readSource(cand);
    if (text !== undefined) return text;
  }
  for (const name of INDEX_NAMES) {
    const text = readSource(join(raw, name));
    if (text !== undefined) return text;
  }
  return undefined;
}

/** 去注释 / 尾逗号的 JSON（tsconfig 语法） */
function readJsonLoose(path: string): Record<string, unknown> | undefined {
  const text = readSource(path);
  if (text === undefined) return undefined;
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function findUp(startDir: string, name: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

type TsconfigJson = {
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
};

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * `extends` 目标解析：相对路径 / 绝对路径 / node_modules 包（含
 * `@tsconfig/*` 这类目录形态）。TS 允许省略 `.json`，也允许指向目录。
 */
function resolveExtendsPath(spec: string, fromDir: string): string | undefined {
  const variants = spec.endsWith(".json") ? [spec] : [spec, `${spec}.json`];
  if (spec.startsWith(".") || isAbsolute(spec)) {
    for (const v of variants) {
      const p = resolve(fromDir, v);
      if (isFile(p)) return p;
    }
    return undefined;
  }
  let dir = resolve(fromDir);
  for (;;) {
    for (const v of variants) {
      const p = join(dir, "node_modules", v);
      if (isFile(p)) return p;
      const pkgConfig = join(p, "tsconfig.json");
      if (isFile(pkgConfig)) return pkgConfig;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isPathsRecord(v: unknown): v is Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (targets) => Array.isArray(targets) && targets.every((t) => typeof t === "string"),
  );
}

/**
 * 读取 tsconfig 的**有效** `paths` / `baseUrl`（BUG-398）。
 *
 * 口径与 tsc 对齐：
 * - `extends` 链自底向上合并；子配置覆盖父配置的同名选项。
 * - `paths` 是整体替换（不是按键合并）：取链上**最近**一份声明。
 * - `baseUrl` 是标量合并：取链上**最近**一份声明；继承来的 paths 也按这个
 *   有效 baseUrl 解析（无 baseUrl 时相对声明 paths 的那份配置目录）。
 * - `extends` 支持字符串与数组（数组按顺序后者覆盖前者）。
 */
function tsconfigPathsOf(fromFile: string): {
  baseDir: string;
  paths: Record<string, string[]>;
} | undefined {
  const cfg = findUp(dirname(fromFile), "tsconfig.json");
  if (!cfg) return undefined;
  let effectiveBaseUrl: string | undefined;
  let paths: Record<string, string[]> | undefined;
  let pathsDir: string | undefined;
  const seen = new Set<string>();
  const visit = (file: string): void => {
    const abs = resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    const json = readJsonLoose(abs) as TsconfigJson | undefined;
    if (!json) return;
    const ext = json.extends;
    const bases = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext : [];
    for (const base of bases) {
      if (typeof base !== "string") continue;
      const p = resolveExtendsPath(base, dirname(abs));
      if (p) visit(p);
    }
    const opts = json.compilerOptions;
    if (typeof opts?.baseUrl === "string") {
      effectiveBaseUrl = resolve(dirname(abs), opts.baseUrl);
    }
    if (isPathsRecord(opts?.paths)) {
      paths = opts.paths;
      pathsDir = dirname(abs);
    }
  };
  visit(cfg);
  if (!paths) return undefined;
  return { baseDir: effectiveBaseUrl ?? pathsDir ?? dirname(cfg), paths };
}

function resolveTsconfigPath(spec: string, fromFile: string): string | undefined {
  const cfg = tsconfigPathsOf(fromFile);
  if (!cfg) return undefined;
  const exact = cfg.paths[spec];
  // TS 的通配选择：精确键优先；通配键按 `*` 前缀长度降序（最长前缀优先）。
  // 不能按对象插入序（BUG-399）——`*` 会抢走 `@app/*`。
  const wildcard = Object.keys(cfg.paths)
    .filter((k) => k.includes("*"))
    .filter((k) => {
      const [pre, post] = k.split("*");
      return spec.startsWith(pre ?? "") && spec.endsWith(post ?? "");
    })
    .sort((a, b) => {
      const pa = a.indexOf("*");
      const pb = b.indexOf("*");
      return pb - pa || b.length - a.length;
    })[0];
  const patterns = exact ?? (wildcard ? cfg.paths[wildcard] : undefined);
  if (!patterns) return undefined;
  for (const pat of patterns) {
    const target =
      pat.includes("*") && wildcard
        ? (() => {
            const [pre, post] = wildcard.split("*");
            const star = spec.slice((pre ?? "").length, spec.length - (post ?? "").length);
            return resolve(cfg.baseDir, pat.replace("*", star));
          })()
        : resolve(cfg.baseDir, pat);
    const text = fileWithExts(target);
    if (text !== undefined) return text;
  }
  return undefined;
}

function packageParts(spec: string): { pkg: string; sub: string } | undefined {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return undefined;
  const parts = spec.split("/");
  if (spec.startsWith("@")) {
    if (parts.length < 2) return undefined;
    return { pkg: `${parts[0]}/${parts[1]}`, sub: parts.slice(2).join("/") };
  }
  return { pkg: parts[0]!, sub: parts.slice(1).join("/") };
}

function packageTypeEntry(pkgDir: string, sub: string): string | undefined {
  const pj = readJsonLoose(join(pkgDir, "package.json"));
  const exportsField = pj?.exports as
    | string
    | Record<string, unknown>
    | undefined;
  const typeOf = (v: unknown): string | undefined => {
    if (typeof v === "string") return v.endsWith(".d.ts") || v.endsWith(".ts") ? v : undefined;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["types", "typings", "import", "require", "default"]) {
        const t = typeOf(o[k]);
        if (t) return t;
      }
    }
    return undefined;
  };
  const exportKey = sub === "" ? "." : `./${sub}`;
  if (exportsField && typeof exportsField === "object") {
    const t = typeOf((exportsField as Record<string, unknown>)[exportKey]);
    if (t) return t;
  }
  if (sub === "") {
    for (const field of ["types", "typings"]) {
      const v = pj?.[field];
      if (typeof v === "string") return v;
    }
    return undefined;
  }
  return undefined;
}

function resolvePackageType(spec: string, fromFile: string): string | undefined {
  const parts = packageParts(spec);
  if (!parts) return undefined;
  let dir = dirname(fromFile);
  for (;;) {
    const pkgDir = join(dir, "node_modules", parts.pkg);
    if (existsSync(pkgDir)) {
      const entry = packageTypeEntry(pkgDir, parts.sub);
      if (entry) {
        const text = fileWithExts(resolve(pkgDir, entry));
        if (text !== undefined) return text;
      }
      const direct = fileWithExts(parts.sub === "" ? pkgDir : join(pkgDir, parts.sub));
      if (direct !== undefined) return direct;
      const dist = fileWithExts(parts.sub === "" ? join(pkgDir, "dist", "index") : join(pkgDir, "dist", parts.sub));
      if (dist !== undefined) return dist;
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // `@types/*` 兜底（从 fromFile 逐级向上找 node_modules）
  const typesPkg = parts.pkg.startsWith("@")
    ? join("@types", parts.pkg.slice(1).replace("/", "__"))
    : join("@types", parts.pkg);
  let typesDir = dirname(fromFile);
  for (;;) {
    const cand = join(typesDir, "node_modules", typesPkg);
    if (existsSync(cand)) {
      return fileWithExts(parts.sub === "" ? cand : join(cand, parts.sub));
    }
    const parent = dirname(typesDir);
    if (parent === typesDir) return undefined;
    typesDir = parent;
  }
}

/**
 * 类型声明源码解析（相对 → tsconfig paths → 包名）。
 * 无命中 / 非类型目标 ⇒ undefined。
 */
export function typeAnnotationSourceOf(
  spec: string,
  fromFile: string,
): string | undefined {
  if (spec.startsWith(".")) {
    const p = isAbsolute(spec) ? spec : resolve(dirname(fromFile), spec);
    return fileWithExts(p, fromFile);
  }
  if (spec.startsWith("/")) return fileWithExts(spec, fromFile);
  return resolveTsconfigPath(spec, fromFile) ?? resolvePackageType(spec, fromFile);
}
