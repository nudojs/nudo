/**
 * 磁盘内容寻址缓存（B3，design-persistent-cache.md L1 骨架）。
 * - 键：sha256(analysisAbi + relative paths + content hashes + import deps)
 * - fail-open：读写失败/版本不符 → miss，绝不 throw
 * - 不存 Abs；只存可 JSON 再执行投影（如 CheckJson）
 * - 缓存根解析见 `evaluator/config.ts` 的 `diskCacheRoot`（唯一入口）
 *
 * 内存上界：本层不持有进程内 map——每次 get/set 直读/直写磁盘，retained
 * heap O(1)。磁盘容量不在本层封顶（由宿主/CI 清理 `diskCacheRoot`）。
 * 进程内 LRU 上界见 session-cache-limits / @nudojs/core/internal 的
 * BoundedLruMap（analysis/fn/eval/harvest/abs-module/path-env）。
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, dirname, relative, sep, isAbsolute } from "node:path";
import { stablePathKey } from "@nudojs/core/internal";
import { writeFileAtomic } from "./write-atomic.ts";
import {
  diskCacheRoot,
  diskCacheSignState,
  effectiveMaxForks,
  type NudoConfig,
} from "./evaluator/config.ts";

/** 分析 ABI：语义变更时抬版本，整层 miss（含缓存键维度扩展） */
function readServiceVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // dist/ 与 src/ 两种布局都能解析到 package.json
    for (const p of ["../package.json", "./package.json", "../../package.json"]) {
      try {
        const pkg = require(p) as { name?: string; version?: string };
        if (pkg?.name === "@nudojs/service" && pkg.version) return pkg.version;
        if (pkg?.version && p.includes("service")) return pkg.version;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  return "0";
}

/**
 * 带包版本：升级 @nudojs/* 后旧 CheckJson 不得继续命中。
 * 语义大改仍可手工再抬 major（`nudo-check-cache-v3`）。
 */
export const ANALYSIS_ABI = `nudo-check-cache-v3+${readServiceVersion()}`;

export type DiskCacheOptions = {
  /** 缓存根目录；undefined = 禁用 */
  root?: string | undefined;
  /** 命名空间子目录（check / interface …） */
  namespace: string;
  /**
   * 条目签名密钥材料（`nudo.cache.sign: true` + env `NUDO_CACHE_KEY`）。
   * 设置 ⇒ 每条落盘附 HMAC-SHA256（`sig` 字段），读回验签失败 = miss
   * （fail-open 重算，不 throw）。键空间同时分离（签名/未签名条目互不
   * 互撞）——伪造「结构合法」的 CheckJson 不再可信，persistent-cache.md
   * 的 L1 关闭理由由签名解除。
   */
  signKey?: string;
};

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ─── 条目签名（B3 信任面） ─────────────────────────────────────────────
// 威胁模型：`.nudo/cache` 是**跨构建共享**的磁盘状态（CI cache restore、共享
// 卷）。攻击者能写缓存目录 ⇒ 能放进「结构合法」的 CheckJson ⇒ 假绿/假红。
// 签名把「结构合法」升级为「本密钥签发」；密钥只来自 env `NUDO_CACHE_KEY`
// （CI masked secret），**绝不**进仓库或缓存目录（否则签发者=验证者）。

/** 签名域分离常量（HMAC key 派生与签名串共用，防跨用途密钥重放） */
const SIGN_DOMAIN = "nudo-disk-cache-sign-v1";
/** 签名键空间前缀（见 DiskCache.storageKey——签名/未签名条目不互撞） */
const SIGN_KEY_PREFIX = "nudo-cache-sign";

/**
 * HMAC 密钥派生：`NUDO_CACHE_KEY` 原值不直接作 HMAC key（域分离的
 * sha256 派生材料）——密钥形状不受用户输入影响，跨长度恒定。
 */
function deriveSignKeyMat(secret: string): Buffer {
  return createHash("sha256").update(`${SIGN_DOMAIN}\0${secret}`).digest();
}

/** 条目签名：覆盖 `abi` 与 value 的规范化 JSON（不含 sig 自身） */
function entrySig(keyMat: Buffer, abi: string, valueJson: string): string {
  return createHmac("sha256", keyMat).update(`${SIGN_DOMAIN}\0${abi}\0${valueJson}`).digest("hex");
}

/** 常时比较（长度不等直接 false——hex 定长，正常路径恒等长） */
function sigEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** 路径段归一为 `/`（仅键构造；不触盘） */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * `node_modules/<pkg>/…` 逻辑段。取**最后一个**有效包位：
 * 跳过 `.pnpm` / `.bin` 等隐藏目录；scoped 包吃两段（`@scope/name`）。
 * pnpm 虚拟树 `node_modules/.pnpm/foo@1/node_modules/foo/x.js` 归一为
 * `node_modules/foo/x.js` —— 跨 store/checkout 稳定。
 */
function nodeModulesLogicalPath(posixPath: string): string | undefined {
  const parts = posixPath.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== "node_modules") continue;
    const next = parts[i + 1];
    if (!next || next.startsWith(".")) continue;
    if (next.startsWith("@")) {
      const name = parts[i + 2];
      if (!name || name.startsWith(".")) continue;
    }
    return parts.slice(i).join("/");
  }
  return undefined;
}

/**
 * 自文件所在目录向上找 monorepo 根。
 * 优先**最近**的确定性标记（`pnpm-workspace.yaml` / `lerna.json`）——
 * 即 clone 根，相对段不含 checkout 目录名，跨机稳定。
 * 无确定性标记时退回最近的 `package.json#workspaces`。
 */
function monorepoLogicalPath(posixPath: string): string | undefined {
  let dir = dirname(posixPath);
  let workspacesRoot: string | undefined;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "lerna.json"))) {
      return toPosix(relative(dir, posixPath)) || undefined;
    }
    if (!workspacesRoot) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          workspaces?: unknown;
        };
        if (pkg?.workspaces != null) workspacesRoot = dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!workspacesRoot) return undefined;
  const r = toPosix(relative(workspacesRoot, posixPath));
  if (!r || r.startsWith("..") || isAbsolute(r)) return undefined;
  return r;
}

/**
 * pnpm store 内容寻址布局（`~/.pnpm-store/vN/files/xx/hash`、
 * `~/Library/pnpm/store/vN/files/…`、`~/.local/share/pnpm/store/…`）。
 * realpath 穿出 `node_modules` 后没有包名段，但文件名本身就是内容哈希——
 * 取该哈希做逻辑段，跨 store 根/机器稳定（内容寻址，不是路径身份）。
 */
function pnpmStoreLogicalPath(posixPath: string): string | undefined {
  const m =
    /(?:^|\/)(?:\.pnpm-store|pnpm\/store)\/v\d+\/files\/([0-9a-f]{2})\/([0-9a-f]+)$/i.exec(
      posixPath,
    ) ?? /(?:^|\/)(?:\.pnpm-store|pnpm\/store)\/v\d+\/files\/([0-9a-f]+)$/i.exec(posixPath);
  if (!m) return undefined;
  const hash = m.length === 3 ? `${m[1]}${m[2]}` : m[1]!;
  return `pnpm-store:${hash}`;
}

/**
 * 稳定逻辑根相对化（磁盘缓存路径维）：树内相对 `root`，树外取
 * `node_modules/<pkg>` 段、monorepo root 或 pnpm store 内容哈希；
 * 绝对路径明文绝不进 key。
 *
 * 同一逻辑文件在不同 checkout / 机器 / CI runner 上必须得到**同一**键段；
 * 无 `root` 时同样禁止绝对路径明文。
 *
 * 解析序：
 * 1. 落在 `root` 内 → 相对 `root`（同包布局下已稳定）
 * 2. `node_modules/<pkg>` 逻辑段（含 pnpm 虚拟树归一）
 * 3. monorepo root 相对化（`pnpm-workspace.yaml` / `lerna.json` / `package.json#workspaces`）
 * 4. pnpm store 内容寻址段（realpath 穿出 node_modules 的典型落点）
 * 5. 仍无稳定根 → `ext:` + 路径 sha（只保证不明文；跨机仍可能 miss，不产生错命中）
 *
 * 入参先过 `stablePathKey`：`/c:/x` 与 `c:/x` 同键段（FIX-RESIDUAL-4）。
 */
export function relativizePath(p: string, root?: string): string {
  const key = stablePathKey(p);
  const norm = toPosix(key);
  if (root) {
    const r = toPosix(relative(stablePathKey(root), key));
    if (!r.startsWith("..") && !isAbsolute(r)) return r;
  }
  const logical =
    nodeModulesLogicalPath(norm) ?? monorepoLogicalPath(norm) ?? pnpmStoreLogicalPath(norm);
  if (logical) return logical;
  return `ext:${createHash("sha256").update(norm).digest("hex").slice(0, 16)}`;
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
  /** 派生 HMAC 密钥材料；undefined = 未签名模式（旧未签名行为原样） */
  private readonly keyMat: Buffer | undefined;
  enabled = false;

  constructor(opts: DiskCacheOptions) {
    this.root = opts.root;
    this.ns = sanitizeCacheNamespace(opts.namespace);
    this.enabled = !!opts.root;
    this.keyMat = opts.signKey !== undefined ? deriveSignKeyMat(opts.signKey) : undefined;
  }

  /**
   * 存储键：签名模式在键上再套一层域分离 sha——签名/未签名条目**互不互撞**
   * （切换模式 = 整层 miss，不出现「旧未签名条目被签名模式读到」或反之）。
   */
  private storageKey(key: string): string {
    return this.keyMat !== undefined ? sha256Hex(`${SIGN_KEY_PREFIX}\0${key}`) : key;
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
      const p = this.pathFor(this.storageKey(key));
      if (!existsSync(p)) return undefined;
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as { abi?: string; value?: T; sig?: unknown };
      if (parsed?.abi !== ANALYSIS_ABI) return undefined;
      if (this.keyMat !== undefined) {
        // 验签失败 / sig 缺席 = miss（fail-open 重算，不 throw）：
        // 被篡改的条目与密钥轮换后的旧条目走同一条「不可信 ⇒ 重算」路径。
        // value 重序列化与本工具写盘口径一致（自写自读，插入序/转义稳定）。
        if (typeof parsed.sig !== "string") return undefined;
        if (!sigEquals(entrySig(this.keyMat, parsed.abi, JSON.stringify(parsed.value)), parsed.sig)) {
          return undefined;
        }
      }
      return parsed.value as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    if (!this.enabled || !this.root) return;
    try {
      const p = this.pathFor(this.storageKey(key));
      mkdirSync(dirname(p), { recursive: true });
      // 同目录 temp + rename 原子写（writeFileAtomic）：崩溃/磁盘满时缓存
      // 条目不会变成半截 JSON；孤儿 tmp 由其内部清理后 rethrow。
      // 签名覆盖 `abi\0JSON(value)`——对象内嵌序列化与独立序列化同串。
      if (this.keyMat !== undefined) {
        const valueJson = JSON.stringify(value);
        writeFileAtomic(
          p,
          JSON.stringify({
            abi: ANALYSIS_ABI,
            value,
            sig: entrySig(this.keyMat, ANALYSIS_ABI, valueJson),
          }),
        );
      } else {
        writeFileAtomic(p, JSON.stringify({ abi: ANALYSIS_ABI, value }));
      }
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
 * `nudo.cache.sign` 配置错误（`sign: true` 但 `NUDO_CACHE_KEY` 缺席/空，
 * 或 sign 取值形状非法）。签名是安全旋钮 ⇒ **拒绝运行**（CLI 面显式报错
 * 退出），不静默降级到未签名缓存。
 */
export class DiskCacheSignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiskCacheSignError";
  }
}

/**
 * 单源 DiskCache 构造：根目录（`diskCacheRoot`）+ 签名状态
 * （`diskCacheSignState`）一并解析。配置错误时 throw `DiskCacheSignError`
 * （消费面：CLI check/contract/health 在 action 层预检给分面错误形态；
 * 本函数是库面/漏检路径的 fail-closed 兜底）。
 */
export function openDiskCache(opts: {
  config: NudoConfig | null | undefined;
  projectDir: string | undefined;
  namespace: string;
  /** 密钥 env（默认 process.env；测试可注入） */
  env?: NodeJS.ProcessEnv;
}): DiskCache {
  const sign = diskCacheSignState(opts.config, opts.env);
  if (sign.kind === "error") throw new DiskCacheSignError(sign.message);
  return new DiskCache({
    root: diskCacheRoot(opts.config, opts.projectDir),
    namespace: opts.namespace,
    ...(sign.kind === "on" ? { signKey: sign.key } : {}),
  });
}

/**
 * 缓存键路径维：优先稳定逻辑段；无逻辑根且内容已知时用**内容指纹**
 * （`cnt:<sha>`）替代 `ext:` 路径 sha——路径 sha 绑机器绝对路径，跨机 miss-only。
 * 内容未知仍回落 `ext:`（只保证不明文、不脏命中）。
 *
 * **项目身份**（Bug 241）：项目根**内**的**入口**文件只取根相对路径是不够的——
 * 共享 `NUDO_CACHE_DIR` 下两个 checkout 的 `src/a.js` 会得到同一个键 ⇒ 互相
 * 污染（命中另一份 checkout 的报告，`file` 字段还指向那边的文件）。因此入口
 * 文件带根指纹前缀（`p:<sha(root)>`）。
 *
 * 依赖路径（`withProjectIdentity` 未开）**保持跨 checkout 复用**：依赖段另有
 * 内容 sha，键的复用性正是磁盘缓存的收益来源（F-6 的可移植性契约）。
 */
function cachePathIdentity(
  p: string,
  root: string | undefined,
  content?: string | null,
  withProjectIdentity = false,
): string {
  const rel = relativizePath(p, root);
  if (rel.startsWith("ext:") && content != null) {
    return `cnt:${sha256Hex(content).slice(0, 16)}`;
  }
  if (withProjectIdentity && root && !rel.startsWith("ext:") && isInsideRoot(p, root)) {
    return `p:${sha256Hex(stablePathKey(root)).slice(0, 16)}/${rel}`;
  }
  return rel;
}

/** p 是否落在 root 内（树内相对化的判据，与 relativizePath 的第一段同口径）。 */
function isInsideRoot(p: string, root: string): boolean {
  const r = toPosix(relative(stablePathKey(root), stablePathKey(p)));
  return !r.startsWith("..") && !isAbsolute(r);
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
    /** package.json#nudo.env 等项目维（named env 不在 path-dep 指纹里） */
    projectEnvNames?: string[];
    /** analysis knobs that can change check surface */
    analysisCfg?: {
      mode?: string;
      evalMissingSlot?: string;
      callSiteBudget?: number;
      entryThrows?: string;
      ignoreThrows?: string;
      /** fork 预算（NUDO_MAX_FORKS / nudo.analysis.maxForks）——截断会 widen 结果 */
      maxForks?: number;
    };
  },
): string {
  const rel = cachePathIdentity(filePath, opts.projectDir, source, true);
  const sidecarSha = opts.sidecarContent != null ? sha256Hex(opts.sidecarContent) : "nosidecar";
  const depSeg = (opts.depContents ?? [])
    .map(
      (d) =>
        `${cachePathIdentity(d.path, opts.projectDir, d.content)}\0${d.content != null ? sha256Hex(d.content) : "miss"}`,
    )
    .join("\n");
  const envSeg = (opts.projectEnvNames ?? []).length > 0
    ? [...(opts.projectEnvNames ?? [])].sort().join(",")
    : "-";
  // fork 预算维度 = **env 生效值**（Bug 636）：env `NUDO_MAX_FORKS` 优先于
  // `package.json#nudo.analysis.maxForks`（`effectiveMaxForks` 的同一优先级，
  // 与 `applyBForkBudgetFromConfig` 写进 core 的值同源 ⇒ 键与真正跑起来的
  // 预算永不打架）。
  //
  // 调用方通常已喂生效值（`analysisConfig()` ⇒ env 生效的 `maxForks`），但
  // **键自己**再兜一层 ⇒ 调用方漏喂 / 喂陈旧值时也不会命中**上一轮**的
  // 陈旧报告（缓存串味：改 env 后命中轮返回旧 budget，新预算根本没执行）。
  // 调用方与 env 都没给值 ⇒ 保持 "-"（不凭空引入维度，避免无谓全量 miss）。
  const rawMaxForks = opts.analysisCfg?.maxForks;
  const envRaw = process.env.NUDO_MAX_FORKS;
  const envSet = envRaw !== undefined && envRaw.trim() !== "";
  const maxForksDim =
    rawMaxForks === undefined && !envSet
      ? "-"
      : String(effectiveMaxForks({ analysis: { maxForks: rawMaxForks } }, process.env));
  const cfgSeg = opts.analysisCfg
    ? `${opts.analysisCfg.mode ?? "-"}|${opts.analysisCfg.evalMissingSlot ?? "-"}|${opts.analysisCfg.callSiteBudget ?? "-"}|${opts.analysisCfg.entryThrows ?? "-"}|${opts.analysisCfg.ignoreThrows ?? "-"}|${maxForksDim}`
    : "-";
  return sha256Hex(
    [
      ANALYSIS_ABI,
      rel,
      opts.autoBind ? "ab1" : "ab0",
      sha256Hex(source),
      sidecarSha,
      depSeg,
      envSeg,
      cfgSeg,
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
    projectEnvNames?: string[];
  },
): string {
  const rel = cachePathIdentity(filePath, opts.projectDir, source, true);
  const sidecarSeg =
    opts.autoBind && opts.sidecarSource !== undefined
      ? `sc:${sha256Hex(opts.sidecarSource)}`
      : "sc0";
  const depSeg = (opts.depContents ?? [])
    .map(
      (d) =>
        `${cachePathIdentity(d.path, opts.projectDir, d.content)}\0${d.content != null ? sha256Hex(d.content) : "miss"}`,
    )
    .join("\n");
  const envSeg = (opts.projectEnvNames ?? []).length > 0
    ? [...(opts.projectEnvNames ?? [])].sort().join(",")
    : "-";
  return sha256Hex(
    [
      ANALYSIS_ABI,
      "iface",
      rel,
      opts.autoBind ? "ab1" : "ab0",
      sha256Hex(source),
      sidecarSeg,
      depSeg,
      envSeg,
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
