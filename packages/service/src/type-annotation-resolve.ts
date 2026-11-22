/**
 * 注解解析的**跨文件模块解析**：相对路径 / 包名 / tsconfig paths。
 *
 * 只读类型声明源码，不执行、不装载模块。返回 `undefined` = 无此文件
 * （解析 miss）；真实读故障照常上抛给调用方。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

function fileWithExts(raw: string): string | undefined {
  for (const cand of [raw, ...TYPE_EXTS.map((e) => `${raw}${e}`)]) {
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

function tsconfigPathsOf(fromFile: string): {
  baseDir: string;
  paths: Record<string, string[]>;
} | undefined {
  const cfg = findUp(dirname(fromFile), "tsconfig.json");
  if (!cfg) return undefined;
  const json = readJsonLoose(cfg);
  const opts = json?.compilerOptions as
    | { baseUrl?: string; paths?: Record<string, string[]> }
    | undefined;
  if (!opts?.paths) return undefined;
  const baseDir = resolve(dirname(cfg), opts.baseUrl ?? ".");
  return { baseDir, paths: opts.paths };
}

function resolveTsconfigPath(spec: string, fromFile: string): string | undefined {
  const cfg = tsconfigPathsOf(fromFile);
  if (!cfg) return undefined;
  const exact = cfg.paths[spec];
  const wildcard = Object.keys(cfg.paths)
    .filter((k) => k.includes("*"))
    .find((k) => {
      const [pre, post] = k.split("*");
      return spec.startsWith(pre ?? "") && spec.endsWith(post ?? "");
    });
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
    return fileWithExts(p);
  }
  if (spec.startsWith("/")) return fileWithExts(spec);
  return resolveTsconfigPath(spec, fromFile) ?? resolvePackageType(spec, fromFile);
}
