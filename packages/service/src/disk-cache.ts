/**
 * 磁盘内容寻址缓存（B3，design-persistent-cache.md L1 骨架）。
 * - 键：sha256(analysisAbi + relative paths + content hashes + import deps)
 * - fail-open：读写失败/版本不符 → miss，绝不 throw
 * - 不存 Abs；只存可 JSON 再执行投影（如 CheckJson）
 * - 缓存根解析见 `evaluator/config.ts` 的 `diskCacheRoot`（唯一入口）
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { diskCacheRoot } from "./evaluator/config.ts";

/** 分析 ABI：语义变更时抬版本，整层 miss（含缓存键维度扩展） */
export const ANALYSIS_ABI = "nudo-check-cache-v2";

export type DiskCacheOptions = {
  /** 缓存根目录；undefined = 禁用 */
  root?: string | undefined;
  /** 命名空间子目录（check / interface …） */
  namespace: string;
};

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 相对化路径，避免绝对路径进磁盘键 */
export function relativizePath(p: string, root?: string): string {
  const norm = p.split(sep).join("/");
  if (!root) return norm;
  const r = relative(root, p).split(sep).join("/");
  return r.startsWith("..") ? norm : r;
}

/**
 * namespace 子目录名消毒：只允许 `[a-z0-9_-]`（大小写不敏感）。
 * 点号/斜杠等路径字符一律替换，避免 `..` / 子路径穿越。
 */
export function sanitizeCacheNamespace(ns: string): string {
  return ns.replace(/[^a-z0-9_-]/gi, "_").replace(/^_+|_+$/g, "") || "cache";
}

export class DiskCache {
  private readonly root: string | undefined;
  private readonly ns: string;
  enabled = false;

  constructor(opts: DiskCacheOptions) {
    this.root = opts.root;
    this.ns = sanitizeCacheNamespace(opts.namespace);
    this.enabled = !!opts.root;
  }

  private pathFor(key: string): string {
    // 两级前缀摊平目录；key 必须是 hex sha，拒绝路径穿越
    if (!/^[a-f0-9]{16,128}$/i.test(key)) {
      throw new Error("DiskCache key must be a hex digest");
    }
    return join(this.root!, this.ns, key.slice(0, 2), `${key}.json`);
  }

  get<T>(key: string): T | undefined {
    if (!this.enabled || !this.root) return undefined;
    try {
      const p = this.pathFor(key);
      if (!existsSync(p)) return undefined;
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as { abi?: string; value?: T };
      if (parsed?.abi !== ANALYSIS_ABI) return undefined;
      return parsed.value as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    if (!this.enabled || !this.root) return;
    try {
      const p = this.pathFor(key);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ abi: ANALYSIS_ABI, value }), "utf8");
    } catch {
      // fail-open：写失败不影响分析
    }
  }

  clearNamespace(): void {
    if (!this.enabled || !this.root) return;
    try {
      rmSync(join(this.root, this.ns), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * check 报告键：abi + 相对路径 + 源码 sha + autoBind + **侧车 sha** +
 * **@nudo:import / 传递契约依赖内容 sha**（依赖变更必须 miss）。
 * dep 路径同样相对化（`relativizePath`）：绝对路径进键会让同内容在不同
 * 机器/checkout 上键不同，缓存无法跨环境复用。
 */
export function checkCacheKey(
  filePath: string,
  source: string,
  opts: {
    autoBind: boolean;
    projectDir?: string;
    sidecarContent?: string | null;
    depContents?: Array<{ path: string; content: string | null }>;
  },
): string {
  const rel = relativizePath(filePath, opts.projectDir);
  const sidecarSha = opts.sidecarContent != null ? sha256Hex(opts.sidecarContent) : "nosidecar";
  const depSeg = (opts.depContents ?? [])
    .map(
      (d) =>
        `${relativizePath(d.path, opts.projectDir)}\0${d.content != null ? sha256Hex(d.content) : "miss"}`,
    )
    .join("\n");
  return sha256Hex(
    [
      ANALYSIS_ABI,
      rel,
      opts.autoBind ? "ab1" : "ab0",
      sha256Hex(source),
      sidecarSha,
      depSeg,
    ].join("\0"),
  );
}

/**
 * effectiveInterface 表键（L1 Phase B，design-persistent-cache）。
 * 维度：相对路径 + 源码 sha256 + autoBind + 侧车内容 sha256 + import 依赖
 * （dep 路径相对化，与 checkCacheKey 同口径）。
 * **不含** emit allowlist（白名单不影响契约读取）。
 */
export function ifaceCacheKey(
  filePath: string,
  source: string,
  opts: {
    autoBind: boolean;
    projectDir?: string;
    /** 侧车源码（已读入）；undefined = 无侧车或 autoBind 关 */
    sidecarSource?: string | undefined;
    depContents?: Array<{ path: string; content: string | null }>;
  },
): string {
  const rel = relativizePath(filePath, opts.projectDir);
  const sidecarSeg =
    opts.autoBind && opts.sidecarSource !== undefined
      ? `sc:${sha256Hex(opts.sidecarSource)}`
      : "sc0";
  const depSeg = (opts.depContents ?? [])
    .map(
      (d) =>
        `${relativizePath(d.path, opts.projectDir)}\0${d.content != null ? sha256Hex(d.content) : "miss"}`,
    )
    .join("\n");
  return sha256Hex(
    [
      ANALYSIS_ABI,
      "iface",
      rel,
      opts.autoBind ? "ab1" : "ab0",
      sha256Hex(source),
      sidecarSeg,
      depSeg,
    ].join("\0"),
  );
}

/** 从源码提取 `@nudo:import` / `@nudo:import * as` 的 specifier */
export function extractNudoImportSpecs(source: string): string[] {
  const specs = new Set<string>();
  const named = /@nudo:import\s*\{[^}]*\}\s*from\s*["']([^"']+)["']/g;
  const ns = /@nudo:import\s+\*\s+as\s+\w+\s+from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(source))) specs.add(m[1]!);
  while ((m = ns.exec(source))) specs.add(m[1]!);
  return [...specs];
}
