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
 * 侧车路径（与 interface.ts 的 sidecarPathOf 同语义）。内联而非 import：
 * interface.ts → refine.ts → 本文件，反向 import 成环。语义改动需两处同步。
 */
function sidecarPathOfEntry(file: string): string {
  const f = normPath(file);
  if (f.endsWith(".mjs")) return f.slice(0, -4) + ".nudo.js";
  if (f.endsWith(".js")) return f.slice(0, -3) + ".nudo.js";
  if (f.endsWith(".mts")) return f.slice(0, -4) + ".nudo.ts";
  if (f.endsWith(".ts")) return f.slice(0, -3) + ".nudo.ts";
  return `${f}.nudo.js`;
}

/**
 * 源里指向其他侧车的相对 spec（`.nudo.js`/`.nudo.ts`）。regex 过近似安全：
 * 多算的 dep 只带来额外 miss，绝不产生陈旧命中。LSP 隐式依赖登记共用。
 */
export function sidecarSpecsOf(source: string): string[] {
  return extractAllLoadSpecs(source).filter(
    (spec) =>
      (spec.startsWith(".") || spec.startsWith("/")) &&
      (spec.endsWith(".nudo.js") || spec.endsWith(".nudo.ts")),
  );
}

/**
 * Fingerprint every loadModule-reachable dep (not only `*.nudo.js`), including
 * one hop of transitive specs from each dep source — plus the autoBind 侧车
 * 闭包（fromFile 的旁路 .nudo 文件与其递归 .nudo 依赖，条目加 `sidecar:`
 * 前缀）。侧车不被任何 spec 声明、主 BFS 覆盖不到；不并入指纹则侧车内容
 * 变更对 memo 是不可见失效源。侧车 loadModule miss（无侧车文件）→ 不加
 * 任何条目，指纹与扩展前逐字节一致。
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
  const finish = (truncated: boolean): LoadDepsFingerprint => {
    parts.sort();
    return truncated
      ? { fp: `trunc:${parts.join(",")}`, paths, truncated: true }
      : { fp: parts.join(","), paths, truncated: false };
  };
  while (queue.length > 0) {
    if (n >= MAX_LOAD_DEP_NODES) return finish(true);
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
  // autoBind 隐式侧车闭包：侧车可加载才并入（miss = 无侧车文件，零回归）。
  // 侧车被源码显式 import 时主 BFS 已覆盖（seen 命中，不重复计条目）。
  const sidecarPath = sidecarPathOfEntry(fromFile);
  if (!seen.has(sidecarPath)) {
    const sidecarSpec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
    const sidecarSrc = loadModule(sidecarSpec, fromFile);
    if (sidecarSrc !== undefined) {
      if (n >= MAX_LOAD_DEP_NODES) return finish(true);
      seen.add(sidecarPath);
      n++;
      parts.push(`sidecar:${sidecarPath}=${hashSource(sidecarSrc)}`);
      paths.push(sidecarPath);
      const sidecarQueue: Array<{ spec: string; from: string }> = sidecarSpecsOf(
        sidecarSrc,
      ).map((spec) => ({ spec, from: sidecarPath }));
      while (sidecarQueue.length > 0) {
        if (n >= MAX_LOAD_DEP_NODES) return finish(true);
        const cur = sidecarQueue.shift()!;
        const path = resolveDepPath(cur.from, cur.spec);
        if (seen.has(path)) continue;
        seen.add(path);
        n++;
        const src = loadModule(cur.spec, cur.from);
        parts.push(`sidecar:${path}=${src === undefined ? "miss" : hashSource(src)}`);
        paths.push(path);
        if (src === undefined) continue;
        for (const next of sidecarSpecsOf(src)) {
          const nextPath = resolveDepPath(path, next);
          if (!seen.has(nextPath)) sidecarQueue.push({ spec: next, from: path });
        }
      }
    }
  }
  return finish(false);
}
