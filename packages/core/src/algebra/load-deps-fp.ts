/**
 * loadModule 可达依赖的内容指纹（check 整文件 memo + generalize L0 共用）。
 * 覆盖 @nudo:import / ESM from / require / dynamic import；对每条 spec 做
 * 传递 BFS（seen 防环），直到节点上限。截断时 truncated=true——调用方必须
 * fail-open（不得写入/读取 memo）。
 */
import { extractNudoImports } from "./refine.ts";
import { hashSource } from "./hash-source.ts";
import { normPath, resolveDepPath, sidecarPathOf } from "./sidecar-path.ts";

// 单一定义在 sidecar-path.ts（leaf）；此处 re-export 维持公共导出面稳定
export { normPath, resolveDepPath };

export type LoadDepsFingerprint = {
  fp: string;
  paths: string[];
  /** BFS 撞到节点上限：剩余 dep 未进指纹，键不可信 */
  truncated: boolean;
};

/** 防病态图；seen 已防环，此上限只限制遍历量 */
const MAX_LOAD_DEP_NODES = 64;

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
 * 闭包（`sidecar:` 前缀条目）。
 *
 * 侧车吸收范围 = fromFile 自身 **与每一个成功加载的依赖文件**的旁路侧车及其
 * 递归 .nudo 依赖：跨文件被调（scan.ts checkExternalCall）会按定义文件路径
 * ambient 绑定其侧车，依赖侧车内容影响调用方报告——不进指纹则编辑后 memo
 * 陈旧命中（错诊断）。侧车 loadModule miss（无侧车文件）→ 不加任何条目。
 *
 * 注意：本扩展对 autoBind=false 与 /node_modules/ 均**不** gate（刻意过近似，
 * 只过度失效、绝不陈旧命中——安全方向）；ambient 生效边界由
 * interface.ts 的 sidecarClosureFingerprint 负责，两者职责不同。
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
  let truncated = false;

  const finish = (): LoadDepsFingerprint => {
    parts.sort();
    return truncated
      ? { fp: `trunc:${parts.join(",")}`, paths, truncated: true }
      : { fp: parts.join(","), paths, truncated: false };
  };

  /** 入口文件的 ambient 侧车 + 递归 .nudo 闭包（fromFile 与各 dep 共用） */
  const absorbSidecarClosure = (entryFile: string): void => {
    const sidecarPath = sidecarPathOf(entryFile);
    if (seen.has(sidecarPath)) return;
    const sidecarSpec = `./${sidecarPath.slice(sidecarPath.lastIndexOf("/") + 1)}`;
    const sidecarSrc = loadModule(sidecarSpec, entryFile);
    if (sidecarSrc === undefined) return; // 无侧车文件：零回归
    if (n >= MAX_LOAD_DEP_NODES) {
      truncated = true;
      return;
    }
    seen.add(sidecarPath);
    n++;
    parts.push(`sidecar:${sidecarPath}=${hashSource(sidecarSrc)}`);
    paths.push(sidecarPath);
    const sidecarQueue: Array<{ spec: string; from: string }> = sidecarSpecsOf(
      sidecarSrc,
    ).map((spec) => ({ spec, from: sidecarPath }));
    while (sidecarQueue.length > 0) {
      if (n >= MAX_LOAD_DEP_NODES) {
        truncated = true;
        return;
      }
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
  };

  while (queue.length > 0) {
    if (n >= MAX_LOAD_DEP_NODES) {
      truncated = true;
      break;
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
    // 依赖文件的 ambient 侧车也进指纹与逐出索引（跨文件被调会绑定它）
    absorbSidecarClosure(path);
  }
  // fromFile 自身的侧车闭包（侧车被显式 import 时主 BFS 已覆盖，seen 命中跳过）
  absorbSidecarClosure(fromFile);
  return finish();
}
