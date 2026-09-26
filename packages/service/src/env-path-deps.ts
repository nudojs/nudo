/**
 * path-based `@nudo:env` / `@nudo:mock-module` 反向依赖（watch 失效）。
 * named env（es/node/web）不进此表——它们不随工作区文件变更。
 */
import { existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { extractAllLoadSpecs } from "@nudojs/core/internal";
import { BoundedLruMap } from "./lru-map.ts";

/**
 * env 模板绝对路径 → 引用它的分析源文件集合。
 *
 * 上限 ENV_DEPENDENTS_MAX（256 个 env 模板键）+ LRU + 每键依赖集上限
 * ENV_DEPENDENTS_PER_KEY_MAX（512）。evict 语义不变（watch 失效仍按键查找）；
 * 只是超限时最旧的 env 模板反向边会被丢弃——丢弃后该模板变更只能靠
 * clearEnvPathDeps / 全量重分析兜底，属可接受的内存换正确性权衡。
 */
const ENV_DEPENDENTS_MAX = 256;
const ENV_DEPENDENTS_PER_KEY_MAX = 512;
const envDependents = new BoundedLruMap<Set<string>>(ENV_DEPENDENTS_MAX);

/** 测试/诊断：反向依赖驻留规模 */
export function getEnvPathDepsSize(): number {
  return envDependents.size;
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 相对/绝对 spec → 磁盘绝对路径（与 defaultLoadModule 同扩展名表） */
export function resolveLoadSpecPath(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  try {
    const base = dirname(resolve(fromFile));
    const p = resolve(base, spec);
    for (const cand of [
      p,
      `${p}.js`,
      `${p}.mjs`,
      `${p}.ts`,
      join(p, "index.js"),
      join(p, "index.mjs"),
      join(p, "index.ts"),
    ]) {
      if (existsSync(cand) && !statSync(cand).isDirectory()) return cand;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 源码里的 path-based load specs 解析为绝对路径后登记反向边 */
export function noteEnvPathDeps(sourcePath: string, source: string): void {
  const src = norm(sourcePath);
  // 先清掉该源文件旧登记，避免 stale reverse edges
  for (const set of envDependents.values()) set.delete(src);
  let specs: string[] = [];
  try {
    specs = extractAllLoadSpecs(source);
  } catch {
    return;
  }
  for (const spec of specs) {
    if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
    const abs = resolveLoadSpecPath(spec, sourcePath);
    if (!abs) continue;
    const key = norm(abs);
    let set = envDependents.get(key);
    if (!set) {
      set = new Set();
      envDependents.set(key, set);
    }
    // per-key 上限：超限删最旧登记（Set 插入序 = LRU）
    if (!set.has(src) && set.size >= ENV_DEPENDENTS_PER_KEY_MAX) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    set.add(src);
  }
}

/** 依赖该 env 模板的源文件列表 */
export function envPathDependents(envPath: string): string[] {
  return [...(envDependents.peek(norm(envPath)) ?? [])];
}

export function clearEnvPathDeps(): void {
  envDependents.clear();
}

/** watch 门禁：env 模板变更必须可被接收（即便扩展名不进 isNudoTargetPath） */
export function isEnvTemplatePath(path: string): boolean {
  const lower = norm(path).toLowerCase();
  return (
    lower.endsWith(".env.js") ||
    lower.endsWith(".env.mjs") ||
    lower.endsWith(".env.ts") ||
    lower.endsWith(".env.cjs") ||
    lower.endsWith(".env.cts") ||
    lower.endsWith(".env.mts") ||
    /\/mock-[^/]+\.(js|mjs|ts)$/.test(lower) ||
    /\.mock\.(js|mjs|ts)$/.test(lower)
  );
}
