/**
 * loadModule 可达依赖的内容指纹（check 整文件 memo + generalize L0 共用）。
 * 覆盖 @nudo:import / ESM from / require / dynamic import；对每条 spec 做
 * 传递 BFS（seen 防环），直到节点上限。截断时 truncated=true——调用方必须
 * fail-open（不得写入/读取 memo）。
 */
import { extractNudoImports } from "./refine.ts";
import { hashSource } from "./hash-source.ts";

export type LoadDepsFingerprint = {
  fp: string;
  paths: string[];
  /** BFS 撞到节点上限：剩余 dep 未进指纹，键不可信 */
  truncated: boolean;
};

/** 防病态图；seen 已防环，此上限只限制遍历量 */
const MAX_LOAD_DEP_NODES = 64;

export function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** core 不引 path：相对 spec 纯字符串拼接（与 LSP resolve 对齐时双方 norm） */
export function resolveDepPath(fromFile: string, spec: string): string {
  const s = normPath(spec);
  if (!s.startsWith(".")) return s;
  const from = normPath(fromFile);
  const i = from.lastIndexOf("/");
  const base = i >= 0 ? from.slice(0, i) : "";
  const parts = base ? base.split("/") : [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * All string module specs that analysis may resolve through loadModule.
 * Regex over-approximates (may hit comments) — extra dep fingerprint is safe
 * (more misses, never a stale hit).
 */
export function extractAllLoadSpecs(source: string): string[] {
  const specs = new Set<string>();
  for (const imp of extractNudoImports(source)) specs.add(imp.spec);
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) specs.add(m[1]!);
  }
  return [...specs];
}

/**
 * Fingerprint every loadModule-reachable dep (not only `*.nudo.js`), including
 * one hop of transitive specs from each dep source.
 */
export function loadModuleDepsFingerprint(
  source: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
  fromFile: string,
): LoadDepsFingerprint {
  const parts: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ spec: string; from: string }> = extractAllLoadSpecs(source).map(
    (spec) => ({ spec, from: fromFile }),
  );
  let n = 0;
  while (queue.length > 0) {
    if (n >= MAX_LOAD_DEP_NODES) {
      parts.sort();
      return { fp: `trunc:${parts.join(",")}`, paths, truncated: true };
    }
    const cur = queue.shift()!;
    const path = resolveDepPath(cur.from, cur.spec);
    if (seen.has(path)) continue;
    seen.add(path);
    n++;
    const src = loadModule(cur.spec, cur.from);
    parts.push(`${path}=${src === undefined ? "miss" : hashSource(src)}`);
    paths.push(path);
    if (src === undefined) continue;
    for (const next of extractAllLoadSpecs(src)) {
      const nextPath = resolveDepPath(path, next);
      if (!seen.has(nextPath)) queue.push({ spec: next, from: path });
    }
  }
  parts.sort();
  return { fp: parts.join(","), paths, truncated: false };
}
