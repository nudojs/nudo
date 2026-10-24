/**
 * nudo migrate — 从 TypeScript 退役到 Nudo 的单向门。
 *
 * 产品约束（docs/design/cli-semantics.md）：
 * - 出口是 retire tsc（package.json / scripts / 标记）；双跑只允许出现在 verify。
 * - strip 必须保运行时语义（TS 剥除 ≠ 编译变换；enum 等见 strip-types 注释）。
 * - verify 必须可与 tsc 基线对照（迁移期信任来自 diff）。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { generate } from "@babel/generator";
import { parseSource, stripTypes, sidecarPathOf } from "@nudojs/core";
import { draftInterface, writeInterfaceDraft } from "@nudojs/service/emit";

export type MigrateStatusRow = {
  root: string;
  packageJson: boolean;
  /** package.json 存在但读不出（JSON 语法错 / 读失败）——「不知道」不得当成「没有」 */
  packageJsonError?: string;
  typescriptDep: boolean;
  tsconfig: boolean;
  tscScripts: string[];
  tsFiles: number;
  tsxFiles: number;
  nudoScripts: string[];
  nudoConfig: boolean;
  retired: boolean;
  /** 半完成：`migrate-retiring.json` 在而 `migrate-retired.json` 不在（可重跑 recover） */
  retiring: boolean;
  blockers: string[];
  /**
   * 本次 workspace 扫描**被排除的包**（机器面）。
   *
   * 排除 = pnpm 负向模式（`!packages/legacy`）命中的包 —— 用户声明「这个包
   * 不归我管」⇒ 它既不进 status，也不被 `retire --all` 改写。
   *
   * ⚠ 此前这份清单**只**出现在 **stderr**（人读行）⇒ **机器消费者**看不到
   * 「哪些包被排除了」（`--json` 面缺字段）。现在它同时进 **stdout 的机器面**
   * （本字段）⇒ 机器可解析。
   *
   * 口径：
   * - **只在有排除时出现**（无排除 ⇒ JSON 与旧版**逐字相同**）；
   * - 同一扫描的**每一行都带同一份清单**（消费方取任意一行即可）；
   * - 路径 = 相对**扫描根**（workspace root）的 posix 路径，与 stderr 那行
   *   **逐字一致**（人读提示与机器报文说同一份清单）。
   */
  excluded?: string[];
};

export type StripResult = {
  file: string;
  outFile: string;
  sidecarDraft?: string;
  notes: string[];
  /**
   * 失败码（机器面）——**与 `migrateVerify` 同款**（`VerifyResult.code`）。
   *
   * 族 56b：strip 的库面改**逐文件隔离**——解析失败**不**再中止整批，
   * 而是降级成**一行错误**（带文件名）⇒ 同目标内其它文件的成功结果
   * 照常返回（原先 `makeStripPlan` 直接 throw ⇒ 整批结果全丢）。
   *
   * 码表**沿用** `migrateVerify` 的逐文件失败码（`analysis-error`）——
   * 不另立码表（verify 对任何逐文件失败都发这个码 ⇒ 两个面同码）。
   */
  code?: string;
  /** 失败详情（带文件名，便于定位）——与 `migrateVerify` 的 `error` 同款 */
  error?: string;
};

export type VerifyResult = {
  file: string;
  nudoOk: boolean;
  nudoSummary: string;
  tsc?: { ok: boolean; output: string };
  /**
   * 失败码（机器面）：
   * - `no-files`：目标目录里没有可分析文件（空集 ≠ 验过了）
   * - `not-a-target`：目标文件不是分析目标（侧车 / .d.ts / JSX）
   * - `syntax-error`：语法错（解析失败）
   * - `analysis-error`：分析/注入装配失败
   */
  code?: string;
  /** 失败详情（带文件名，便于定位） */
  error?: string;
  /** 修复引导（对齐 nudo check 的文案） */
  fix?: string;
};

/** package.json 脚本改写记录 */
export type RetireScriptChange = { name: string; from: string; to: string };
/** CI workflow 改写记录 */
export type RetireWorkflowChange = { file: string; from: string; to: string };
/** 保留 tsc 的编译器角色脚本（构建/发射）——未改写 */
export type RetirePreservedScript = { name: string; command: string; reason: string };

export type RetireResult = {
  root: string;
  removedDeps: string[];
  rewrittenScripts: RetireScriptChange[];
  rewrittenWorkflows: RetireWorkflowChange[];
  marker: string;
  /** 保留 tsc 的编译器角色脚本（`nudo check` 不产产物 ⇒ 不得改写） */
  preservedScripts: RetirePreservedScript[];
  /**
   * 本次 workspace 扫描**被排除的包**（机器面）。
   *
   * 与 `MigrateStatusRow.excluded` 同口径：排除 = pnpm 负向模式命中的包；
   * 此前只在 **stderr**（人读行）⇒ 机器消费者看不到 ⇒ 现在同时进 stdout 的
   * 机器面（`--json`）。**只在有排除时出现** ⇒ 无排除时 JSON 逐字不变。
   *
   * ⚠ 只在 **workspace 扫描**（`retire --all`）时有值；单目标退役
   * （`migrate retire <pkg>`）不做 workspace 枚举 ⇒ 无排除清单。
   */
  excluded?: string[];
};

/**
 * 落盘审计标记（`.nudo/migrate-retired.json`）——与 stdout 报文**同键同型**：
 * `rewrittenWorkflows` 两处都是 `{file,from,to}` 对象数组（不是路径字符串数组）。
 */
export type RetireMarker = {
  retiredAt: string;
  removedDeps: string[];
  rewrittenScripts: RetireScriptChange[];
  rewrittenWorkflows: RetireWorkflowChange[];
  preservedScripts: RetirePreservedScript[];
  /** 因保留编译器脚本而**未**摘掉的 typescript 依赖来源 */
  keptDeps: string[];
};

export type WorkflowRewrite = {
  file: string;
  changes: Array<{ from: string; to: string }>;
};

const TS_EXT = new Set([".ts", ".mts", ".cts"]);
const TSX_EXT = new Set([".tsx"]);

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    /* optional: package.json unreadable — omit */
    return undefined;
  }
}

/**
 * tmp + rename 原子写：避免半截文件。rename 同目录，崩溃时目标要么旧要么新。
 */
function writeFileAtomic(path: string, data: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, data, "utf-8");
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort tmp cleanup */
    }
    throw e;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

type FileSnapshot =
  | { path: string; kind: "missing" }
  | { path: string; kind: "file"; content: string }
  /** 目标不是普通文件（目录等）：回滚时不碰它 */
  | { path: string; kind: "other" };

function snapshotFile(path: string): FileSnapshot {
  // 单次 stat：miss（ENOENT）→ missing；EACCES/EIO 上抛——快照是
  // 回滚数据安全网，读不了就不该开始迁移（不得伪装 other 跳过回滚）
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return { path, kind: "missing" };
  if (st.isFile()) {
    return { path, kind: "file", content: readFileSync(path, "utf-8") };
  }
  return { path, kind: "other" };
}

function restoreSnapshot(snap: FileSnapshot): void {
  if (snap.kind === "missing") {
    if (existsSync(snap.path)) rmSync(snap.path, { force: true });
    return;
  }
  if (snap.kind === "file") writeFileAtomic(snap.path, snap.content);
}

/**
 * 提交一组写入（调用方保证顺序：package.json → workflows → marker 最后）。
 * 任一步失败：只回滚「已成功写入」的文件（writeFileAtomic 失败时目标未动，无需回滚）。
 * 回滚也失败：留下 `.nudo/migrate-retiring.json`（status 可见，可重跑）。
 */
function commitWriteSet(
  root: string,
  ops: Array<{ path: string; text: string }>,
): void {
  const snaps: FileSnapshot[] = [];
  try {
    for (const op of ops) {
      const snap = snapshotFile(op.path);
      writeFileAtomic(op.path, op.text);
      // 仅记录已成功写入的：失败的那次目标未动（tmp+rename），回滚反而可能再炸
      snaps.push(snap);
    }
  } catch (err) {
    let rollbackFailed = false;
    for (let i = snaps.length - 1; i >= 0; i--) {
      try {
        restoreSnapshot(snaps[i]!);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) {
      try {
        writeJson(join(root, ".nudo", "migrate-retiring.json"), {
          retiringAt: new Date().toISOString(),
          error: (err as Error).message ?? String(err),
          note: "partial migrate retire — re-run `nudo migrate retire` to recover",
        });
      } catch {
        /* best-effort: 半完成标记写不上就只抛原错 */
      }
    }
    throw err;
  }
}

function listFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    /* optional: directory unreadable — skip */
    return out;
  }
  for (const name of entries) {
    // 族 21 Bug 1026：`migrate verify` 的扫描集合必须与 `nudo check .` **同口径** ——
    // 产品默认安全排除是 3 条（node_modules / dist / coverage，见 service 的
    // `DEFAULT_ANALYSIS_EXCLUDE`）；此前只抄了 1 条（node_modules）⇒ `dist/` 与
    // `coverage/` 的陈旧构建产物被当源码门禁 ⇒ `migrate verify`（绿）与
    // `migrate retire` 装上的 `nudo check .`（红）扫描的文件集合不同。
    // 另排除 `.git` / `.nudo`（不在服务默认表里，但显然不该被扫描）。
    if (
      name === "node_modules" ||
      name === ".git" ||
      name === "dist" ||
      name === "coverage" ||
      name === ".nudo"
    ) {
      continue;
    }
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      /* optional: entry unstatable — skip */
      continue;
    }
    if (st.isDirectory()) listFiles(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

/** 剥离 YAML 行注释（引号内 `#` 不是注释） */
function stripYamlLineComment(line: string): string {
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i]!;
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (quote === '"' && line[i] === "\\") {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
    i++;
  }
  return line;
}

function unquoteYamlScalar(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  }
  return t;
}

/**
 * 最小解析 pnpm-workspace.yaml 的 `packages:` 列表（非完整 YAML）。
 * 认块列表（`- item`）与单行流列表（`packages: [a, b]`）；处理注释/引号。
 * 排除模式（`!…`）原样返回——排除**语义**由 resolveWorkspacePackages 统一实现。
 */
function parsePnpmWorkspacePackages(root: string): string[] {
  const yamlPath = join(root, "pnpm-workspace.yaml");
  let text: string;
  try {
    text = readFileSync(yamlPath, "utf-8");
  } catch (err) {
    // ENOENT = 无 workspace 文件（单包仓库，合法 miss）；
    // EACCES/EIO 等读失败上抛——静默 [] 会漏采 monorepo 包根
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  let inPackages = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripYamlLineComment(rawLine);
    if (!line.trim()) continue;
    const top = !/^\s/.test(line);
    const trimmed = line.trim();
    if (top) {
      const m = trimmed.match(/^packages:\s*(.*)$/);
      if (m) {
        const rest = m[1]!.trim();
        if (rest.startsWith("[")) {
          const inner = rest.endsWith("]") ? rest.slice(1, -1) : rest.slice(1);
          for (const part of inner.split(",")) {
            const item = unquoteYamlScalar(part);
            if (item) out.push(item);
          }
          inPackages = false;
        } else if (rest) {
          const item = unquoteYamlScalar(rest);
          if (item) out.push(item);
          inPackages = false;
        } else {
          inPackages = true;
        }
        continue;
      }
      inPackages = false;
      continue;
    }
    if (!inPackages) continue;
    const itemMatch = trimmed.match(/^-\s+(.+)$/);
    if (itemMatch) {
      const item = unquoteYamlScalar(itemMatch[1]!);
      if (item) out.push(item);
    }
  }
  return out;
}

/** workspace glob 展开深度上限（防符号链接环） */
const WS_MAX_DEPTH = 12;

/** 归一化 workspace pattern：`\`→`/`、去 `./` 前缀、去尾部 `/` */
function normalizeWorkspacePattern(p: string): string {
  let s = p.trim().replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** pattern → 路径段（`*` / `**` 保留为整段） */
function workspacePatternSegments(p: string): string[] {
  return normalizeWorkspacePattern(p).split("/").filter((s) => s.length > 0);
}

/** 单段 glob（`*` / `?`）→ 正则；`**` 只在段级处理 */
function workspaceSegmentRegExp(seg: string): RegExp {
  let out = "";
  for (const ch of seg) {
    if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * 段级 glob 匹配：`**` = 零或多段，`*` = 段内任意字符，`?` = 单字符。
 * 语义对齐 pnpm 的 workspace pattern（`**` 可匹配零段：`a/**` 命中 `a`）。
 */
function workspaceGlobMatch(pat: string[], segs: string[]): boolean {
  if (pat.length === 0) return segs.length === 0;
  const head = pat[0]!;
  if (head === "**") {
    for (let k = 0; k <= segs.length; k++) {
      if (workspaceGlobMatch(pat.slice(1), segs.slice(k))) return true;
    }
    return false;
  }
  if (segs.length === 0) return false;
  if (!workspaceSegmentRegExp(head).test(segs[0]!)) return false;
  return workspaceGlobMatch(pat.slice(1), segs.slice(1));
}

/**
 * 负向模式（`!…`）是否命中候选包（相对 root 的段数组）。
 * `!dir`（末段无通配）排除整个子树——命中目录即剪枝（fast-glob ignore 语义）。
 */
function workspaceExcluded(excludes: string[][], segs: string[]): boolean {
  for (const ex of excludes) {
    if (ex.length === 0) continue;
    if (workspaceGlobMatch(ex, segs)) return true;
    const last = ex[ex.length - 1]!;
    if (!/[*?]/.test(last) && segs.length > ex.length) {
      let same = true;
      for (let i = 0; i < ex.length; i++) {
        if (!workspaceSegmentRegExp(ex[i]!).test(segs[i]!)) {
          same = false;
          break;
        }
      }
      if (same) return true;
    }
  }
  return false;
}

/** 子目录列表（跳过 node_modules / .git；stat 跟随 symlink） */
function workspaceChildDirs(base: string): string[] {
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    /* 目录不可读——跳过（不能因此中断整个枚举） */
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(base, name);
    try {
      if (statSync(p).isDirectory()) out.push(p);
    } catch {
      /* 断链 symlink / 不可 stat——跳过 */
    }
  }
  return out;
}

/**
 * 真 glob 展开：把 pattern 展开成**包根**（含 package.json 的目录）。
 * - `*` = 一段；`**` = 零或多段（`packages/**` 覆盖任意深度的嵌套成员）
 * - 多段 pattern（`packages` 目录下两层 `*`）逐段展开，不再被整条丢弃
 * - 字面段必须是真实目录（不存在即不展开，不静默假装「没有成员」）
 */
function expandWorkspacePattern(root: string, pattern: string): string[] {
  const pat = workspacePatternSegments(pattern);
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (base: string, idx: number, depth: number): void => {
    if (depth > WS_MAX_DEPTH) return;
    if (idx >= pat.length) {
      if (seen.has(base)) return;
      seen.add(base);
      if (existsSync(join(base, "package.json"))) found.push(base);
      return;
    }
    const seg = pat[idx]!;
    if (seg === "**") {
      visit(base, idx + 1, depth); // ** 匹配零段
      for (const child of workspaceChildDirs(base)) {
        visit(child, idx, depth + 1); // ** 匹配一段以上
      }
      return;
    }
    if (seg === "*") {
      for (const child of workspaceChildDirs(base)) visit(child, idx + 1, depth + 1);
      return;
    }
    const child = join(base, seg);
    try {
      if (!statSync(child).isDirectory()) return;
    } catch {
      return;
    }
    visit(child, idx + 1, depth + 1);
  };
  visit(root, 0, 0);
  return found;
}

/** workspace 枚举结果：包根 + 边界说明（排除 / 未匹配） */
export type WorkspaceScan = {
  /** 包根绝对路径（根目录自身在前，其后按 pattern 声明顺序） */
  roots: string[];
  /** 被负向模式（`!…`）排除的包（相对 root 的 posix 路径） */
  excluded: string[];
  /** 边界说明（未识别的 workspaces 形态 / 没匹配到包的 pattern） */
  notes: string[];
};

/**
 * workspace 包枚举（pnpm / npm / yarn 三种来源统一成「包根集合」）。
 *
 * 契约（下游 `migrateStatus` / `migrateRetireAll` 依赖）：
 * - `package.json#workspaces`：**数组式**（yarn classic）与**对象式**
 *   `{ "packages": [...] }`（npm / yarn berry）**都**认；对象式取其 `packages` 数组。
 * - `pnpm-workspace.yaml` 的 `packages:`：pnpm 权威清单，**真 glob**
 *   ——`*` 一段、`**` 零或多段、多段 pattern（`packages` 目录下两层 `*`）都展开。
 * - **负向模式**（`!packages/legacy`）优先：被排除的包既不进 status，
 *   也**不被 `retire --all` 改写**（用户写 `!` 就是声明「这个包不归我管」）。
 * - 根目录自身始终是第一个根；同源与跨源同包去重。
 */
export function resolveWorkspacePackages(root: string): WorkspaceScan {
  const rawPatterns: string[] = [];
  const notes: string[] = [];
  const pkg = readJson(join(root, "package.json"));
  const workspaces = pkg?.workspaces;
  if (Array.isArray(workspaces)) {
    for (const w of workspaces) {
      if (typeof w === "string") rawPatterns.push(w);
    }
  } else if (workspaces !== undefined && workspaces !== null && typeof workspaces === "object") {
    // 对象式（npm / yarn berry）：`{ "packages": [...] }`
    const obj = workspaces as { packages?: unknown };
    if (Array.isArray(obj.packages)) {
      for (const w of obj.packages) {
        if (typeof w === "string") rawPatterns.push(w);
      }
    } else {
      notes.push('package.json#workspaces 是对象形态但没有 packages 数组（子包不可见）');
    }
  } else if (workspaces !== undefined && workspaces !== null) {
    notes.push("package.json#workspaces 既不是数组也不是 { packages: [...] } 对象（子包不可见）");
  }
  rawPatterns.push(...parsePnpmWorkspacePackages(root));

  const includes: string[] = [];
  const excludes: string[][] = [];
  for (const raw of rawPatterns) {
    const p = normalizeWorkspacePattern(raw);
    if (!p) continue;
    if (p.startsWith("!")) {
      const ex = workspacePatternSegments(p.slice(1));
      if (ex.length > 0) excludes.push(ex);
      continue;
    }
    includes.push(p);
  }

  const roots: string[] = [root];
  const seen = new Set<string>([root]);
  const excluded: string[] = [];
  for (const p of includes) {
    const matched = expandWorkspacePattern(root, p);
    if (matched.length === 0) {
      notes.push(`workspace pattern "${p}" 没有匹配到任何包`);
      continue;
    }
    for (const m of matched) {
      const rel = relative(root, m)
        .split(/[\\/]/)
        .filter((s) => s.length > 0);
      if (workspaceExcluded(excludes, rel)) {
        const relPath = rel.join("/");
        if (!excluded.includes(relPath)) excluded.push(relPath);
        continue;
      }
      if (seen.has(m)) continue;
      seen.add(m);
      roots.push(m);
    }
  }
  return { roots, excluded, notes };
}

/**
 * 包根集合（`migrate status` / `migrate retire --all` 的作用域）。
 * 边界（pnpm 排除掉的包 / 没匹配到包的 pattern）走 **stderr**——
 * stdout 是产品面（`--json` 必须是合法 JSON），提示不得污染它。
 *
 * ⚠ **排除清单同时进 stdout 的机器面**（`excluded` 字段，见
 * `MigrateStatusRow.excluded`）：stderr 那行是**人读**提示，机器消费者拿不到
 * 「哪些包被排除了」⇒ 这里把清单一并返回，由调用方放进 `--json` 报文。
 */
function packageRoots(root: string): { roots: string[]; excluded: string[] } {
  const scan = resolveWorkspacePackages(root);
  for (const note of scan.notes) console.error(`nudo migrate: ${note}`);
  if (scan.excluded.length > 0) {
    console.error(`nudo migrate: skipped (pnpm excluded): ${scan.excluded.join(", ")}`);
  }
  return { roots: scan.roots, excluded: scan.excluded };
}

/**
 * 排除清单的**机器面**形态。
 *
 * 字符串与 stderr 那行**逐字一致**（相对**扫描根**（workspace root）的 posix
 * 路径）⇒ 人读提示与机器报文说的是同一份清单、同一批字符串。
 *
 * **无排除 ⇒ undefined**（JSON 里不出现该键 ⇒ 与旧版逐字相同）。
 */
function excludedPackages(excluded: string[]): string[] | undefined {
  if (excluded.length === 0) return undefined;
  return [...excluded];
}

/** 声明文件（.d.ts / .d.mts / .d.cts）不是可 strip 的实现源 */
const DTS_RE = /\.d\.(m|c)?ts$/i;

function isDeclarationFile(file: string): boolean {
  return DTS_RE.test(file);
}

/**
 * verify 的**扫描面**（nudojs 本地口径；**不**依赖 service 的 `isNudoTargetPath`）。
 *
 * 根因在 **service**（本片未改，见交回报告）：`isNudoTargetPath` 把 `.jsx` /
 * `.tsx` / `.cjs` 一律排除 ⇒ `migrate verify` 看不见 **JSX 产物**（旧
 * `migrate strip` 的 `.tsx → .jsx` 映射产物——Node 加载不了）⇒ 迁移闸门对
 * **不可加载的产物**发绿灯（假绿）。`nudo check` / `nudo health` / `nudo test`
 * 共用那条规则 ⇒ **service 侧仍是根因**，本片只做 **CLI 侧兜底**（verify 自己
 * 算扫描面）。
 *
 * 口径（verify 关心「迁移前的源 + 迁移后的产物」）：
 * - 源：`.ts` / `.mts` / `.cts` / `.tsx`
 * - 产物：`.js` / `.mjs` / `.cjs` / `.jsx`
 * - **排除**（与 Bug 566 同口径）：声明文件（`.d.ts` / `.d.mts` / `.d.cts`）、
 *   侧车（`*.nudo.js` / `*.nudo.mjs` / `*.nudo.ts`）、draft 产物
 *   （`*.nudo.draft.js` / `*.nudo.draft.mjs` / `*.nudo.draft.ts`）——它们不是
 *   实现源码，当源码分析会与 `nudo check` 给出**相反结论**。
 */
const VERIFY_TARGET_EXTS: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
]);

/** 侧车 / draft 产物（排除表与 service `isNudoTargetPath` 逐条一致） */
function isSidecarOrDraftPath(file: string): boolean {
  const lower = file.toLowerCase();
  return (
    lower.endsWith(".nudo.js") ||
    lower.endsWith(".nudo.mjs") ||
    lower.endsWith(".nudo.ts") ||
    lower.endsWith(".nudo.draft.js") ||
    lower.endsWith(".nudo.draft.mjs") ||
    lower.endsWith(".nudo.draft.ts")
  );
}

/** verify 的目标判定（口径见 VERIFY_TARGET_EXTS 的说明） */
function isVerifyTargetPath(file: string): boolean {
  if (isDeclarationFile(file)) return false;
  if (isSidecarOrDraftPath(file)) return false;
  return VERIFY_TARGET_EXTS.has(extname(file.toLowerCase()));
}

/** migrate strip 的源门：TS/TSX 实现源，排除 .d.* 声明 */
function isStripSource(file: string): boolean {
  if (isDeclarationFile(file)) return false;
  const e = extname(file).toLowerCase();
  return TS_EXT.has(e) || TSX_EXT.has(e);
}

/**
 * shell/YAML 命令行的字符串+注释掩码（等长）。
 * 不能复用 JS 的 stripCommentsAndStrings：`//` 在 shell 里不是注释
 * （`curl https://…` 会被误截），`#` 才是。
 * 引号内不改写：`echo "please run tsc first"` 不是 tsc 调用。
 */
function maskShellStringsAndComments(cmd: string): string {
  const out = cmd.split("");
  const blank = (from: number, to: number, keepNewlines: boolean): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (keepNewlines && cmd[i] === "\n") continue;
      out[i] = " ";
    }
  };
  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const start = i;
      i++;
      while (i < n) {
        if (quote !== "'" && cmd[i] === "\\") {
          i += 2;
          continue;
        }
        if (cmd[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      blank(start, i, true);
      continue;
    }
    // shell 注释：# 起于词首（行首或空白后），不是 URL 里的 #fragment
    if (c === "#" && (i === 0 || /\s/.test(cmd[i - 1]!))) {
      const start = i;
      while (i < n && cmd[i] !== "\n") i++;
      blank(start, i, true);
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** 跳过引号字符串（shell 词法），返回结束位置 */
function skipShellQuoted(cmd: string, start: number): number {
  const quote = cmd[start]!;
  let i = start + 1;
  const n = cmd.length;
  while (i < n) {
    if (quote !== "'" && cmd[i] === "\\") {
      i += 2;
      continue;
    }
    if (cmd[i] === quote) return i + 1;
    i++;
  }
  return n;
}

/**
 * shell 元字符：tsc 命令短语在此结束。
 * `(` / `)` 仍是边界——但命令替换 `$( … )` / `<( … )` 在 consumeTscArgv 里
 * **先被整体消费**（skipSubstitution），不会在左括号处截断（Bug 966）。
 */
function isPhraseBoundary(c: string): boolean {
  return (
    c === ";" ||
    c === "&" ||
    c === "|" ||
    c === "\n" ||
    c === "<" ||
    c === ">" ||
    c === "(" ||
    c === ")"
  );
}

/**
 * tsc 调用前缀白名单（包管理器 / runner）。命中则整段（前缀+tsc）换成产品命令
 * `npx nudojs check .`；不在表内的 wrapper（`sudo`/`time`/`env`…）保留，只换 tsc 本体。
 * 长前缀必须先于短前缀（`pnpm exec ` 先于 `pnpm `），否则会吃残前缀。
 */
const TSC_RUNNER_PREFIX_SRC =
  "(?:npx(?:\\s+(?:--no-install|--yes|-y|--quiet|-q)|(?:\\s+(?:--package|-p)\\s+\\S+))*\\s+" +
  "|npm exec(?:\\s+--)?\\s+|npm run\\s+" +
  "|pnpm exec\\s+|pnpm dlx\\s+|pnpm run\\s+|pnpm\\s+" +
  "|yarn dlx\\s+|yarn run\\s+|yarn\\s+" +
  "|bunx\\s+|bun x\\s+)";

/**
 * tsc 命令词（可带 runner 前缀）；argv 由调用方按短语消费。
 * 覆盖三种形态——**检测与改写共用同一个正则**（口径分裂是 Bug 570/943 的根因）：
 * - 裸 tsc / `npx tsc`
 * - 版本钉住：`npx tsc@5.4.5`（`@version` 后缀）
 * - 路径限定：`./node_modules/.bin/tsc`（CI 里常见）
 */
const TSC_TOKEN_SRC = "(?:[\\w.@+~-]+[\\\\/])*tsc(?:@[\\w.^~-]+)?";
const TSC_CMD_SRC = `(?<![\\w-])(?:${TSC_RUNNER_PREFIX_SRC})?${TSC_TOKEN_SRC}(?=$|[\\s;&|<>()])`;
const TSC_CMD_STICKY = new RegExp(TSC_CMD_SRC, "y");

/**
 * 透明包装器：其**首个参数**仍处于「命令位」（`sudo tsc` 是 tsc 调用，
 * `eslint --rule tsc` 不是）。用于命令位判定（Bug 967）。
 */
const SHELL_WRAPPER_COMMANDS = new Set([
  "sudo",
  "doas",
  "su",
  "time",
  "env",
  "nohup",
  "command",
  "exec",
  "nice",
  "ionice",
  "stdbuf",
  "setsid",
  "npx",
  "bunx",
  "pnpx",
]);

/** shell 运算符字符（结束一个词） */
function isShellOperatorChar(c: string): boolean {
  return (
    c === ";" || c === "&" || c === "|" || c === "<" || c === ">" || c === "(" || c === ")"
  );
}

/**
 * 跳过 `$( … )` / `$(( … ))` / `<( … )` / `>( … )`（含嵌套与引号），返回结束位置。
 * 命令替换必须**整体消费**——否则改写器会在左括号处截断，把尾巴粘到门禁路径上（Bug 966）。
 */
function skipSubstitution(cmd: string, start: number): number {
  const n = cmd.length;
  let i = start + 2;
  let depth = 1;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "'" || c === '"' || c === "`") {
      i = skipShellQuoted(cmd, i);
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if ((c === "$" || c === "<" || c === ">") && cmd[i + 1] === "(") {
      i = skipSubstitution(cmd, i);
      continue;
    }
    if (c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return n;
}

/** 跳过 `${{ … }}`（GitHub Actions 表达式），返回结束位置 */
function skipGhaExpression(cmd: string, start: number): number {
  const end = cmd.indexOf("}}", start + 3);
  return end === -1 ? cmd.length : end + 2;
}

/** 跳过 `${ … }`，返回结束位置 */
function skipBracedVar(cmd: string, start: number): number {
  const end = cmd.indexOf("}", start + 2);
  return end === -1 ? cmd.length : end + 1;
}

/** 一个 shell 词（去引号后的内容 + 是否字面量 / 是否含展开语法） */
type ShellWord = {
  start: number;
  end: number;
  value: string;
  /** 词内含引号 ⇒ 字面量（不该被 shell 展开） */
  quoted: boolean;
  /** 词内含展开语法（$ / ` / ${} / ${{}}）⇒ 需要 shell / CI 展开 */
  expanded: boolean;
};

/**
 * 扫描一个 shell 词（到空白 / 运算符为止）。
 * 引号、命令替换、`${{ … }}` 表达式整体消费——`packages/${{ matrix.pkg }}/tsconfig.json`
 * 必须是**一个**词（Bug 924）。
 */
function scanShellWord(cmd: string, start: number): ShellWord {
  const n = cmd.length;
  let i = start;
  let value = "";
  let quoted = false;
  let expanded = false;
  while (i < n) {
    const c = cmd[i]!;
    if (/\s/.test(c)) break;
    if (isShellOperatorChar(c)) break;
    if (c === "'" || c === '"' || c === "`") {
      const end = skipShellQuoted(cmd, i);
      value += cmd.slice(i + 1, Math.max(i + 1, end - 1));
      quoted = true;
      i = end;
      continue;
    }
    if (c === "\\") {
      value += cmd[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      const end = skipSubstitution(cmd, i);
      value += cmd.slice(i, end);
      expanded = true;
      i = end;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "{") {
      const end = cmd[i + 2] === "{" ? skipGhaExpression(cmd, i) : skipBracedVar(cmd, i);
      value += cmd.slice(i, end);
      expanded = true;
      i = end;
      continue;
    }
    if (c === "$" && /[A-Za-z_]/.test(cmd[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && /\w/.test(cmd[j]!)) j++;
      value += cmd.slice(i, j);
      expanded = true;
      i = j;
      continue;
    }
    value += c;
    i++;
  }
  return { start, end: i, value, quoted, expanded };
}

/** 带命令位信息的词 */
type ShellWordToken = ShellWord & {
  /** 在当前简单命令中的参数序号（0 = 命令词；-1 = 重定向目标 / 赋值） */
  argIndex: number;
  /** 当前简单命令的命令词 */
  commandWord: string | null;
};

/**
 * 词法扫描：切出命令里的词，并标注「命令位」。
 * 简单命令 = 以 `;` / `&&` / `||` / `|` / `&` / 换行分隔的一段。
 */
function scanShellWords(cmd: string): ShellWordToken[] {
  const out: ShellWordToken[] = [];
  const n = cmd.length;
  let i = 0;
  let argIndex = 0;
  let commandWord: string | null = null;
  let pendingRedirect = false;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "\n") {
      argIndex = 0;
      commandWord = null;
      pendingRedirect = false;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2; // 转义 / 续行（`\` + 换行）：整对消费
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(cmd[i - 1]!))) {
      while (i < n && cmd[i] !== "\n") i++;
      continue;
    }
    if (c === ";" || c === "&" || c === "|") {
      i += c === "&" || c === "|" ? (cmd[i + 1] === c ? 2 : 1) : 1;
      argIndex = 0;
      commandWord = null;
      pendingRedirect = false;
      continue;
    }
    if (c === ">" || c === "<") {
      i += cmd[i + 1] === c || cmd[i + 1] === "&" ? 2 : 1;
      pendingRedirect = true;
      continue;
    }
    const w = scanShellWord(cmd, i);
    if (w.end <= i) {
      i++;
      continue;
    }
    const isAssign = !w.quoted && /^[A-Za-z_]\w*=/.test(w.value);
    const isArg = !pendingRedirect && !isAssign;
    if (isArg && argIndex === 0) commandWord = w.value;
    const myIndex = isArg ? argIndex : -1;
    if (isArg) argIndex++;
    pendingRedirect = false;
    out.push({ ...w, argIndex: myIndex, commandWord });
    i = w.end;
  }
  return out;
}

/** 词是否处于「命令位」：命令词本身，或透明包装器的首个参数 */
function isCommandPosition(tok: ShellWordToken): boolean {
  if (tok.argIndex === 0) return true;
  if (tok.argIndex === 1 && tok.commandWord !== null) {
    return SHELL_WRAPPER_COMMANDS.has(tok.commandWord);
  }
  return false;
}

/** 一处 tsc 调用（命令位） */
type TscCall = {
  /** tsc 短语（含 runner 前缀）在原文中的起点 */
  start: number;
  /** 命中的文本 */
  matched: string;
  /** argv 起点 */
  argvStart: number;
  /** argv 终点（整段被消费） */
  argvEnd: number;
};

/** 找出命令文本里所有「命令位」的 tsc 调用（检测口径 = 改写口径） */
function findTscCalls(cmd: string): TscCall[] {
  const out: TscCall[] = [];
  let skipUntil = 0;
  for (const tok of scanShellWords(cmd)) {
    if (tok.start < skipUntil) continue;
    if (!isCommandPosition(tok)) continue;
    TSC_CMD_STICKY.lastIndex = tok.start;
    const m = TSC_CMD_STICKY.exec(cmd);
    if (!m) continue;
    const argvStart = tok.start + m[0].length;
    const argvEnd = consumeTscArgv(cmd, argvStart);
    out.push({ start: tok.start, matched: m[0], argvStart, argvEnd });
    skipUntil = argvEnd;
  }
  return out;
}

/**
 * 命令替换（`$( … )`）内部是**独立的命令上下文**——里面的 tsc 也是一次真实的
 * tsc 调用，必须同样退役。扫描器把 `$( … )` 当不透明单元，故显式递归。
 */
function rewriteSubstitutionBodies(cmd: string): string {
  let out = "";
  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const end = skipShellQuoted(cmd, i);
      out += cmd.slice(i, end);
      i = end;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      const end = skipSubstitution(cmd, i);
      const inner = cmd.slice(i + 2, Math.max(i + 2, end - 1));
      out += `$(` + rewriteTscPhrases(inner) + `)`;
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 命令替换内部是否含 tsc 调用（检测口径与改写口径同源） */
function hasNestedTscCall(cmd: string): boolean {
  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "'" || c === '"' || c === "`") {
      i = skipShellQuoted(cmd, i);
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      const end = skipSubstitution(cmd, i);
      const inner = cmd.slice(i + 2, Math.max(i + 2, end - 1));
      if (isTscCommand(inner)) return true;
      i = end;
      continue;
    }
    i++;
  }
  return false;
}

/**
 * 统一判定：命令文本里是否存在「命令位」的 tsc 调用。
 * `migrate status` / `migrate retire` 的**检测口径**与**改写口径**必须同源——
 * 否则「被计入 ⇒ 必被改写」不成立（Bug 570 / 943 / 967）。
 */
export function isTscCommand(cmd: string): boolean {
  return findTscCalls(cmd).length > 0 || hasNestedTscCall(cmd);
}

/** 门禁目标（`nudo check <target>` 的参数） */
type CheckTarget = {
  path: string;
  /** 原词是字面量（带引号）⇒ 落盘仍按字面量 */
  quoted: boolean;
  /** 含展开语法 ⇒ 落盘保留展开（交给 shell / CI 展开） */
  expanded: boolean;
};

/** tsconfig 文件 → 所在目录（nudo check 吃源码路径，不解析 tsconfig） */
function tsconfigToDir(p: string): string {
  if (!/\.json$/i.test(p)) return p;
  const dir = dirname(p);
  return dir === "" ? "." : dir;
}

/**
 * 从 tsc argv 抽出项目路径（-p / --project / -b / --build 的首个位置参数）。
 * tsconfig 文件 → 其所在目录；目录原样。无路径 → "."。
 * 切词按 **shell 词法**（引号 / 命令替换 / `${{ … }}` 整体不可分割），
 * 不再按空白硬切（Bug 924）。
 */
function projectPathFromTscArgv(cmd: string, start: number, end: number): CheckTarget {
  const tokens: ShellWord[] = [];
  let i = start;
  while (i < end) {
    const w = scanShellWord(cmd, i);
    if (w.end <= i) {
      i++;
      continue;
    }
    tokens.push(w);
    i = w.end;
  }
  let project: ShellWord | null = null;
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!;
    if (tok.value === "-p" || tok.value === "--project") {
      project = tokens[t + 1] ?? null;
      break;
    }
    if (tok.value.startsWith("--project=")) {
      project = { ...tok, value: tok.value.slice("--project=".length) };
      break;
    }
    if (tok.value === "-b" || tok.value === "--build") {
      // -b [project…]：取首个非旗标参数；裸 -b → "."
      const next = tokens[t + 1];
      project =
        next !== undefined && !next.value.startsWith("-") ? next : { ...tok, value: "." };
      break;
    }
  }
  if (!project || project.value === "") return { path: ".", quoted: false, expanded: false };
  const v = project.value;
  if (project.quoted) {
    // 原词是字面量（引号内）⇒ 落盘仍按字面量（引号里的 $() 不该被展开）
    return { path: tsconfigToDir(v), quoted: true, expanded: false };
  }
  if (project.expanded) {
    // 含展开语法：能判定是目录就保留（交给 shell / CI 展开），否则退回 "."
    if (/\.json$/i.test(v)) return { path: tsconfigToDir(v), quoted: false, expanded: true };
    if (v.includes("/")) return { path: v, quoted: false, expanded: true };
    return { path: ".", quoted: false, expanded: false };
  }
  return { path: tsconfigToDir(v), quoted: false, expanded: false };
}

/**
 * 消费 tsc argv 直到 shell 元字符。旗标（含未知旗标）与位置参数一并剥离——
 * 项目路径由 projectPathFromTscArgv 另行抽出，映射为 `nudo check <path>`。
 * 命令替换 / CI 表达式 / 续行都是**整体**消费：
 * - `$( … )` 整体跳过，不在左括号处截断（Bug 966）
 * - `${{ … }}` 整体跳过，内部空白不切开（Bug 924）
 * - `\` + 换行整对消费，续行不会被拆成两条命令（Bug 1005）
 */
function consumeTscArgv(cmd: string, start: number): number {
  let i = start;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "'" || c === '"' || c === "`") {
      i = skipShellQuoted(cmd, i);
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      i = skipSubstitution(cmd, i);
      continue;
    }
    if (c === "$" && cmd[i + 1] === "{") {
      i = cmd[i + 2] === "{" ? skipGhaExpression(cmd, i) : skipBracedVar(cmd, i);
      continue;
    }
    if (c === "<" && cmd[i + 1] === "(") {
      i = skipSubstitution(cmd, i);
      continue;
    }
    if (c === "\\") {
      i += 2; // 转义 / 续行：整对消费
      continue;
    }
    if (isPhraseBoundary(c)) break;
    if (c === "#" && (i === 0 || /\s/.test(cmd[i - 1]!))) break;
    i++;
  }
  // 不吞短语后的空白：保留 ` && ` / ` # 注释` 结构
  while (i > start && /\s/.test(cmd[i - 1]!)) i--;
  return i;
}

/**
 * 单引号 shell 安全引用：内部 `'` 以 `'\''` 闭合再拼。
 * 禁止「仅空白才加引号」/JSON.stringify——那会让 $()/`/glob 在重写后被展开。
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 门禁目标的落盘形态：
 * - `.` 裸写（稳定快照）
 * - 原词是字面量（引号内）⇒ 单引号字面量（`$()` / glob 不展开）
 * - 含展开语法（$ / ` / `${{ … }}`）⇒ **原样保留**，交给 shell / CI 展开
 *   （封成字面量会指向不存在的路径——Bug 924）
 * - 含 glob（* / ? / [）⇒ 原样保留，交给 shell 展开
 * - 其余路径 ⇒ 单引号字面量
 */
function emitCheckTarget(t: CheckTarget): string {
  if (t.path === ".") return ".";
  if (t.quoted) return shellQuote(t.path);
  if (t.expanded) return t.path;
  if (t.path.includes("*") || t.path.includes("?") || t.path.includes("[")) return t.path;
  return shellQuote(t.path);
}

/**
 * 以「命令短语」为单位改写 tsc：前缀白名单 + tsc + argv。
 * 字符串/注释里的 tsc 是文本，不是编译器调用；非命令位的 tsc（旗标值 / 描述文字）
 * 也不是调用（Bug 967）——判定与改写共用 `findTscCalls`。
 */
function rewriteTscPhrases(cmd: string): string {
  // 先递归改写命令替换内部（独立命令上下文），再改写外层
  const src = rewriteSubstitutionBodies(cmd);
  const calls = findTscCalls(src);
  if (calls.length === 0) return src;
  let out = "";
  let pos = 0;
  for (const call of calls) {
    out += src.slice(pos, call.start);
    const target = projectPathFromTscArgv(src, call.argvStart, call.argvEnd);
    out +=
      (call.matched === "tsc" ? "nudo check " : "npx nudojs check ") + emitCheckTarget(target);
    pos = call.argvEnd;
  }
  out += src.slice(pos);
  return out;
}

/** 单条 shell 命令里的 tsc → nudo check（A1：CI workflow 可改写） */
export function rewriteTscCommand(cmd: string): { cmd: string; changed: boolean } {
  const before = cmd;
  let next = rewriteTscPhrases(cmd);
  next = next.replace(/nudo check \.\s*&&\s*nudo check \./g, "nudo check .");
  next = next.replace(/npx nudojs check \.\s*&&\s*npx nudojs check \./g, "npx nudojs check .");
  return { cmd: next, changed: next !== before };
}

/** 是否像 shell 命令行（跳过 name:/注释/纯描述） */
// ---------------------------------------------------------------------------
// CI workflow（YAML）改写
// ---------------------------------------------------------------------------

/** YAML 行的 key：`- run: value` / `run: value` / `  TSC: tsc` */
const YAML_KEY_RE = /^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*)(\s*:\s*)(.*)$/;

/** 块标量指示符：| / >（可带 chomping / 缩进指示符） */
const YAML_BLOCK_RE = /^[|>][+-]?\d*$/;

/** YAML 标量（普通 / 单引号 / 双引号） */
type YamlScalar = {
  style: "plain" | "single" | "double";
  /** 标量内容 */
  value: string;
  /** 标量之后的 YAML 注释（回写时保留） */
  tail: string;
};

/**
 * 解析 YAML 标量。**YAML 的引号不是 shell 的引号**——`- run: "npx tsc --noEmit"`
 * 的引号属于 YAML，值本身是 `npx tsc --noEmit`（Bug 580）。
 */
function parseYamlScalar(raw: string): YamlScalar | null {
  const s = raw.trim();
  if (s === "") return null;
  if (s.startsWith("'")) {
    let i = 1;
    let v = "";
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          v += "'";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      v += s[i]!;
      i++;
    }
    return { style: "single", value: v, tail: s.slice(i) };
  }
  if (s.startsWith('"')) {
    let i = 1;
    let v = "";
    while (i < s.length) {
      const c = s[i]!;
      if (c === "\\") {
        const nx = s[i + 1] ?? "";
        v += nx === "n" ? "\n" : nx;
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        break;
      }
      v += c;
      i++;
    }
    return { style: "double", value: v, tail: s.slice(i) };
  }
  // 普通标量：` #` 起是 YAML 注释（与 shell 的注释规则一致）
  const cut = s.search(/\s#/);
  if (cut >= 0) {
    return { style: "plain", value: s.slice(0, cut).trimEnd(), tail: s.slice(cut) };
  }
  return { style: "plain", value: s, tail: "" };
}

/** 按原标量风格回写 */
function emitYamlScalar(scalar: YamlScalar, value: string): string {
  if (scalar.style === "single") return `'${value.replace(/'/g, "''")}'`;
  if (scalar.style === "double") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  // 普通标量：不能以 YAML 特殊字符开头，也不能含 `: ` / ` #`
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || /:\s/.test(value) || /\s#/.test(value)) {
    return emitYamlScalar({ ...scalar, style: "double" }, value);
  }
  return value;
}

type WorkflowScan = {
  text: string;
  changes: Array<{ from: string; to: string }>;
  /** 每个 tsc 调用一条（命令原文，trimmed） */
  tscCommands: string[];
};

/**
 * 扫描并改写 workflow YAML。
 * - 只有 `run:` 的标量是**命令位**：env 值 / 描述文字 / 注释都不是命令（Bug 579）。
 * - 块标量（`run: |` / `run: >`）整体按 YAML 语义取出、在**命令层面**改写、
 *   再按原形态写回——一条命令跨多行不会被拆开（Bug 1005）。
 */
function scanWorkflowText(text: string): WorkflowScan {
  const lines = text.split("\n");
  const out: string[] = [];
  const changes: Array<{ from: string; to: string }> = [];
  const tscCommands: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = YAML_KEY_RE.exec(line);
    if (!m || m[2] !== "run") {
      out.push(line);
      i++;
      continue;
    }
    const keyPart = `${m[1]!}${m[2]!}${m[3]!}`;
    const value = m[4]!;
    // 块标量内容的最小缩进：比 `-`（或 key）更深
    const itemIndent = m[1]!.includes("-") ? m[1]!.indexOf("-") : m[1]!.length;
    if (YAML_BLOCK_RE.test(value.trim())) {
      const content: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j]!;
        if (l.trim() === "") {
          content.push(l);
          j++;
          continue;
        }
        const ind = l.length - l.trimStart().length;
        if (ind <= itemIndent) break;
        content.push(l);
        j++;
      }
      let end = content.length;
      while (end > 0 && content[end - 1]!.trim() === "") end--;
      const bodyLines = content.slice(0, end);
      const tailLines = content.slice(end);
      const firstBody = bodyLines.find((l) => l.trim() !== "");
      const baseIndent =
        firstBody === undefined
          ? itemIndent + 2
          : firstBody.length - firstBody.trimStart().length;
      const pad = " ".repeat(baseIndent);
      const body = bodyLines
        .map((l) => (l.trim() === "" ? "" : l.slice(baseIndent)))
        .join("\n");
      // `>` 折叠标量：换行折成空格 ⇒ 多行本就是一条命令
      const folded = value.trim().startsWith(">");
      const logical = folded ? body.replace(/\n+/g, " ") : body;
      const calls = findTscCalls(logical);
      const { cmd, changed } = rewriteTscCommand(logical);
      if (!changed) {
        out.push(line, ...content);
        i = j;
        continue;
      }
      changes.push({ from: logical.trim(), to: cmd.trim() });
      for (let k = 0; k < calls.length; k++) tscCommands.push(logical.trim());
      out.push(line);
      const newBody = folded ? cmd.replace(/\n+/g, " ") : cmd;
      for (const l of newBody.split("\n")) out.push(l === "" ? "" : pad + l);
      out.push(...tailLines);
      i = j;
      continue;
    }
    // 单行标量
    const scalar = parseYamlScalar(value);
    if (!scalar) {
      out.push(line);
      i++;
      continue;
    }
    const calls = findTscCalls(scalar.value);
    const { cmd, changed } = rewriteTscCommand(scalar.value);
    if (!changed) {
      out.push(line);
      i++;
      continue;
    }
    changes.push({ from: scalar.value.trim(), to: cmd.trim() });
    for (let k = 0; k < calls.length; k++) tscCommands.push(scalar.value.trim());
    out.push(`${keyPart}${emitYamlScalar(scalar, cmd)}${scalar.tail}`);
    i++;
  }
  return { text: out.join("\n"), changes, tscCommands };
}

export function rewriteWorkflowText(text: string): {
  text: string;
  changes: Array<{ from: string; to: string }>;
} {
  const scan = scanWorkflowText(text);
  return { text: scan.text, changes: scan.changes };
}

/** 自 package 根向上找 `.github/workflows`（monorepo 根） */
export function findWorkflowDir(from: string): string | undefined {
  let cur = resolve(from);
  for (let i = 0; i < 6; i++) {
    const wf = join(cur, ".github", "workflows");
    // 单次 stat：miss（ENOENT）→ 继续向上；EACCES/EIO 上抛（写盘工具 fail loud）
    if (statSync(wf, { throwIfNoEntry: false })?.isDirectory()) return wf;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

export function listWorkflowTscLines(from: string): Array<{ file: string; line: string }> {
  const wf = findWorkflowDir(from);
  if (!wf) return [];
  const out: Array<{ file: string; line: string }> = [];
  for (const name of readdirSync(wf)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const p = join(wf, name);
    const text = readFileSync(p, "utf-8");
    // 计数口径 = 改写口径（同一个扫描器）：被计入的 tsc 必被改写
    const scan = scanWorkflowText(text);
    for (const cmd of scan.tscCommands) {
      out.push({ file: relative(process.cwd(), p), line: cmd });
    }
  }
  return out;
}

/** workflow 改写计划（只读，不写盘）——供 retire 提交阶段按序落盘 */
export type PlannedWorkflowWrite = {
  path: string;
  file: string;
  text: string;
  changes: Array<{ from: string; to: string }>;
};

export function planWorkflowRewrites(from: string): PlannedWorkflowWrite[] {
  const wf = findWorkflowDir(from);
  if (!wf) return [];
  const out: PlannedWorkflowWrite[] = [];
  for (const name of readdirSync(wf)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const p = join(wf, name);
    const text = readFileSync(p, "utf-8");
    const { text: next, changes } = rewriteWorkflowText(text);
    if (changes.length === 0) continue;
    out.push({ path: p, file: relative(process.cwd(), p), text: next, changes });
  }
  return out;
}

export function rewriteWorkflowsNear(
  from: string,
  opts: { dryRun?: boolean } = {},
): WorkflowRewrite[] {
  const planned = planWorkflowRewrites(from);
  if (!opts.dryRun) {
    for (const w of planned) writeFileAtomic(w.path, w.text);
  }
  return planned.map((w) => ({ file: w.file, changes: w.changes }));
}

/**
 * migrate 根解析：已存在目录原样；已存在文件（package.json / 源文件）取所在目录。
 * 路径不存在必须报错——禁止 silent `dirname` 回退到真实 package 根（误改父目录）。
 */
function resolveMigrateRoot(rootDir: string): string {
  const raw = resolve(rootDir);
  if (!existsSync(raw)) {
    throw new Error(`not found: ${rootDir}`);
  }
  return statSync(raw).isDirectory() ? raw : dirname(raw);
}

/**
 * package.json 读取结果：**区分「不存在」/「解析失败」/「读失败」/「可读」**。
 * `readJson`（公共基建）把解析失败与「文件不存在」压成同一个 undefined——
 * 迁移面不能把「不知道」当成「没有」（status 假绿 / retire 谎报 no package.json）。
 */
export type PackageJsonRead =
  | { kind: "missing" }
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "invalid"; error: string }
  | { kind: "unreadable"; error: string };

export function readPackageJsonDetailed(path: string): PackageJsonRead {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", error: (err as Error).message ?? String(err) };
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { kind: "invalid", error: "package.json is not a JSON object" };
    }
    return { kind: "ok", value: value as Record<string, unknown> };
  } catch (err) {
    return { kind: "invalid", error: (err as Error).message ?? String(err) };
  }
}

/**
 * 依赖合并口径（status / retire / retire --all 三处统一）：
 * dependencies + devDependencies + peerDependencies + optionalDependencies。
 * 少算一个来源 ⇒ status 假绿 + `retire --all` 静默漏包（peer-only 的包）。
 */
export function mergePackageDeps(pkg: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const) {
    const bag = pkg?.[field];
    if (bag && typeof bag === "object" && !Array.isArray(bag)) {
      Object.assign(out, bag as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * scripts 条目：**只保留字符串值**。`{"scripts":{"typecheck":null}}` 是合法 JSON
 * （npm 读作「无命令」）——`as Record<string,string>` 只是编译期断言，运行期
 * 把 null 送进掩码函数 ⇒ 裸 TypeError。
 */
export function scriptCommandEntries(
  pkg: Record<string, unknown> | undefined,
): Array<[string, string]> {
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  const out: Array<[string, string]> = [];
  for (const [name, cmd] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof cmd === "string") out.push([name, cmd]);
  }
  return out;
}

/** nudo 命令形态：`nudo` 与 `npx nudojs` 都是产品 CLI（retire 改写后的形态） */
const NUDO_CMD_RE = /\bnudo(js)?\b/;
/** nudo 门禁形态：命令文本里的 `nudo check` / `npx nudojs check` / `nudo test` */
const NUDO_GATE_RE = /\bnudo(js)?\s+(check|test)\b/;

/**
 * 包边界：文件是否属于**另一个** workspace 包（父包不得重复计入子包的文件）。
 * status 按包分行 ⇒ 每行只能是「该包自己的面」。
 */
function belongsToOtherPackage(file: string, self: string, allRoots: string[]): boolean {
  const relFile = relative(self, file);
  for (const other of allRoots) {
    if (other === self) continue;
    const relOther = relative(self, other);
    if (relOther === "" || relOther.startsWith("..")) continue; // 不在 self 之下
    if (relFile === relOther || relFile.startsWith(relOther + sep)) return true;
  }
  return false;
}

export function migrateStatus(rootDir: string): MigrateStatusRow[] {
  const root = resolveMigrateRoot(rootDir);
  const { roots, excluded } = packageRoots(root);
  const excludedList = excludedPackages(excluded);
  const workflowHits = listWorkflowTscLines(root);
  const rows: MigrateStatusRow[] = [];
  for (const r of roots) {
    const pkgPath = join(r, "package.json");
    const read = readPackageJsonDetailed(pkgPath);
    const pkg = read.kind === "ok" ? read.value : undefined;
    // 包边界裁剪：嵌套 workspace 包的文件不计入父包（根行不再重复计数子包的 .ts）
    const files = listFiles(r).filter((f) => !belongsToOtherPackage(f, r, roots));
    // .d.ts/.d.mts/.d.cts 是声明 stub（retire 时删除/保留 ambient），不是可 strip 源
    const tsFiles = files.filter((f) => TS_EXT.has(extname(f).toLowerCase()) && !isDeclarationFile(f)).length;
    const tsxFiles = files.filter((f) => TSX_EXT.has(extname(f).toLowerCase())).length;
    const scripts = scriptCommandEntries(pkg);
    // 脚本是 shell 命令：字符串里的 tsc 不算
    // 检测口径 = 改写口径（isTscCommand）：「被计入 ⇒ 必被改写」（Bug 570/943/967）
    const tscScripts = scripts
      .filter(([, cmd]) => isTscCommand(cmd))
      .map(([name]) => name);
    const nudoScripts = scripts
      .filter(([, cmd]) => NUDO_CMD_RE.test(maskShellStringsAndComments(cmd)))
      .map(([name]) => name);
    // 门禁判定口径 = **命令文本**（脚本名不参与）：命令已是 `nudo check` / `npx nudojs check`
    // 的包即便脚本名叫 lint / typecheck2 也**已经有**门禁 ⇒ 不得报假阻塞。
    const hasNudoGate = scripts.some(([, cmd]) => NUDO_GATE_RE.test(maskShellStringsAndComments(cmd)));
    const deps = mergePackageDeps(pkg);
    // 占位目录不算 retired——marker 必须是普通文件；
    // 单次 stat：miss（ENOENT）→ false；EACCES/EIO 上抛（不伪装未 retired）
    const markerPath = join(r, ".nudo", "migrate-retired.json");
    const retired = statSync(markerPath, { throwIfNoEntry: false })?.isFile() === true;
    const retiringPath = join(r, ".nudo", "migrate-retiring.json");
    const retiring =
      !retired && statSync(retiringPath, { throwIfNoEntry: false })?.isFile() === true;
    const blockers: string[] = [];
    // 清单读不出来 ⇒ 这一行的其它读数都不可信（必须显式报出，不得静默当「没有」）
    let pkgError: string | undefined;
    if (read.kind === "invalid") {
      pkgError = `package.json parse failed: ${read.error}`;
      blockers.push("package.json parse failed");
    } else if (read.kind === "unreadable") {
      pkgError = `package.json read failed: ${read.error}`;
      blockers.push("package.json read failed");
    }
    if (retiring) {
      blockers.push(
        "partial migrate retire (migrate-retiring.json) — re-run nudo migrate retire",
      );
    }
    if (tsxFiles > 0) blockers.push(`${tsxFiles} .tsx (JSX migrate is manual/later)`);
    // tsc 脚本仍在 ⇒ 阻塞；与 .ts 数量无关（0 个 .ts 恰恰是最该退役的场景）
    if (tscScripts.length > 0) blockers.push("tsc still in scripts");
    if (tsFiles > 0 && !hasNudoGate) {
      blockers.push("no nudo check/test script yet");
    }
    if (deps.typescript) blockers.push("typescript still in dependencies");
    if (workflowHits.length > 0) {
      blockers.push(`${workflowHits.length} tsc line(s) in .github/workflows`);
    }
    // 无阻塞项 ⇒ 空数组（占位符「—」只属于文本面的人读表达，不得进机器面）
    rows.push({
      root: relative(process.cwd(), r) || ".",
      packageJson: existsSync(pkgPath),
      ...(pkgError ? { packageJsonError: pkgError } : {}),
      typescriptDep: Boolean(deps.typescript),
      tsconfig: existsSync(join(r, "tsconfig.json")),
      tscScripts,
      tsFiles,
      tsxFiles,
      nudoScripts,
      nudoConfig: pkg?.nudo !== undefined,
      retired,
      retiring,
      blockers,
      // 排除清单（机器面）：同一次扫描的每一行都带同一份（无排除 ⇒ 不出现）
      ...(excludedList ? { excluded: excludedList } : {}),
    });
  }
  return rows;
}

/**
 * 剥除事实回报（与 core 的 `StripOptions.report` **同字段名**）。
 *
 * ⚠ `StripOptions` 是 `packages/core/src/strip-types.ts` 内的**本地类型、未导出**
 * ⇒ 这里**镜像**一份结构（只声明用到的字段；字段全可选 ⇒ 形状兼容）。
 * 字段语义（core 侧为准）：
 * - enumRemoved：TS enum 声明被**整条删除**（仅 `declare enum` —— 环境声明
 *   没有运行时语义）。
 * - enumSynthesized：TS enum 被**合成成运行时对象**（正向 + 反向映射）。
 * - namespaceKept：非 declare 的 namespace 被保留（运行时语义）。
 * - exportAssignmentRemoved：`export = X` / `export as namespace X` 被剥除。
 * - thisParamRemoved：TS 的 `this` 形参被从形参数组里删除。
 * - typeOnlyImportRemoved：值位置零引用的**本地**类型专用 import 被消掉。
 * - typeOnlyImportKept：值位置的导入**被保留**（绑定有值位置引用，或引用形态
 *   判不准 ⇒ 保守保留）⇒ 产物面应当提示人工确认。
 * - directivesBefore / directivesAfter / directivesDropped：剥除前后的
 *   `@nudo:` 指令条数比对（不等 ⇒ 有指令随被删语句一起消失）。
 */
type StripReport = {
  enumRemoved?: boolean;
  enumSynthesized?: boolean;
  namespaceKept?: boolean;
  exportAssignmentRemoved?: boolean;
  thisParamRemoved?: boolean;
  typeOnlyImportRemoved?: boolean;
  typeOnlyImportKept?: boolean;
  directivesBefore?: number;
  directivesAfter?: number;
  directivesDropped?: boolean;
  ctorParamPropsSuperMissing?: boolean;
};

/** TS 源 → 纯 JS 源（Nudo strip 语义；enum 合成见 strip-types 注释）。 */
export function stripTsToJs(
  source: string,
  opts: { filePath?: string } = {},
): { code: string; notes: string[] } {
  const notes: string[] = [];
  const ast = parseSource(source, { keepTs: true });
  // 剥除事实回报（Bug 596）：notes 必须基于 **AST 事实**——裸正则扫源码会把
  // 注释 / 字符串里的 "enum " / "namespace " 当成声明（提示与事实相反）。
  const report: StripReport = {};
  const resolveSpecifier = opts.filePath
    ? (spec: string): string | undefined =>
        resolveProductSpecifier(opts.filePath as string, spec, notes)
    : undefined;
  stripTypes(ast, undefined, {
    report,
    ...(resolveSpecifier ? { resolveSpecifier } : {}),
  });
  // 运行时 enum 现在是**被合成**而不是被删除（Bug 913）⇒ note 必须跟着改口径：
  // 「runtime semantics lost」对「已被合成」的文件是**误报**。
  if (report.enumSynthesized) {
    notes.push(
      "contains enum — strip synthesizes a runtime object for it (TS enum semantics kept: forward + reverse mapping); confirm the emitted shape matches your expectations",
    );
  }
  if (report.enumRemoved) {
    notes.push(
      "contains declare enum — strip removes it (ambient declaration: no runtime semantics)",
    );
  }
  if (report.namespaceKept) {
    notes.push(
      "contains namespace — non-declare namespaces keep TS nodes and may not print cleanly",
    );
  }
  // `export =` / `export as namespace` 被剥除（Bug 446）：产物**合法**了，但
  // CommonJS 的出口面**没了** ⇒ 必须提示人工改写成 ESM 出口。
  if (report.exportAssignmentRemoved) {
    notes.push(
      "contains `export =` / `export as namespace` — strip removes it (TS-only module exit): the CommonJS export surface is gone — re-export it as an ESM export by hand",
    );
  }
  // TS 的 `this` 形参被剥除（Bug 448）：运行时无影响（只是接收者标注）。
  if (report.thisParamRemoved) {
    notes.push(
      "contains a `this` parameter — strip removes it (TypeScript-only receiver annotation: no runtime effect)",
    );
  }
  // 值位置零引用的类型专用 import 被消掉（Bug 445）：与 tsc 的 import elision
  // 同口径 ⇒ 这是**预期行为**，但用户需要知道产物少了什么。
  if (report.typeOnlyImportRemoved) {
    notes.push(
      "removed a type-only import (its binding was only used in type positions — same elision as tsc)",
    );
  }
  // 保守保留的 import（本地再导出 / 包说明符 / 完全未引用）⇒ 产物**可能**链接
  // 失败（被 import 的模块剥成空模块）⇒ 提示人工确认。
  if (report.typeOnlyImportKept) {
    notes.push(
      "kept an import whose binding could not be proven type-only (local re-export / package specifier / unused) — the product fails to link if the imported module has no such runtime export: check it by hand",
    );
  }
  // 剥除前后的指令条数比对（Bug 968 的兜底自检）：不等 ⇒ 有指令随被删语句消失。
  if (report.directivesDropped) {
    notes.push(
      `some @nudo: directives were lost while stripping (before: ${report.directivesBefore ?? 0}, after: ${report.directivesAfter ?? 0}) — re-check the emitted file`,
    );
  }
  // 派生类构造器**没有**顶层 `super(...)` 调用 ⇒ 参数属性赋值仍落在构造器体
  // **开头**（早于 `super()`）⇒ 产物在 `new C()` 时抛 ReferenceError
  // （"Must call super constructor in derived class before accessing 'this'"）。
  // strip 不合成 `super()`（父构造器实参不可知 ⇒ 合成会引入新的错值）⇒
  // 保持源自身的失败形态并提示人工处理。
  if (report.ctorParamPropsSuperMissing) {
    notes.push(
      "a derived class constructor has no top-level `super(...)` call — constructor parameter properties are lowered at the top of the constructor body (before `super()`), so `new C()` throws a ReferenceError in the emitted file: add the `super(...)` call by hand",
    );
  }
  const out = generate(
    ast as never,
    {
      retainLines: true,
      comments: true,
      compact: false,
      jsescOption: { minimal: true },
    },
    source,
  );
  return { code: out.code.endsWith("\n") ? out.code : `${out.code}\n`, notes };
}

/** 相对说明符的候选扩展名（TS 解析序：.ts → .tsx → .mts → .cts → .js …） */
const SPECIFIER_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

/** 源扩展名 → 产物扩展名（strip 只剥类型，不做模块系统转换） */
function productExtOf(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mts":
      return ".mjs";
    case ".cts":
      // strip 不做 ESM→CJS 转换 ⇒ 产物**不是** CommonJS ⇒ 不谎称 .cjs（Bug 917）
      return ".js";
    case ".tsx":
      return ".jsx";
    case ".mjs":
      return ".mjs";
    case ".cjs":
      return ".cjs";
    case ".jsx":
      return ".jsx";
    default:
      return ".js";
  }
}

/**
 * 相对说明符 → 产物说明符（Bug 587）。
 *
 * ESM 规定相对说明符必须带显式扩展名；TS 源码习惯写 "./helper"（无扩展名），
 * strip 产物原样保留 ⇒ Node 加载不了（ERR_MODULE_NOT_FOUND），而 strip /
 * verify / check 三个面都不做链接检查 ⇒ 零告警放行。
 * 这里把说明符解析到**真实文件**，再按「源扩展名 → 产物扩展名」映射回去。
 */
function resolveProductSpecifier(
  fromFile: string,
  spec: string,
  notes: string[],
): string | undefined {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return undefined;
  // 非 JS/TS 资源（./styles.css / ./data.json）不属于 ESM 扩展名规则的适用范围
  const lastSeg = spec.slice(Math.max(spec.lastIndexOf("/"), spec.lastIndexOf("\\")) + 1);
  const segExt = /\.[^./]+$/.exec(lastSeg);
  if (segExt && !/^\.(m|c)?(j|t)sx?$/i.test(segExt[0])) return undefined;
  const specPath = resolve(dirname(fromFile), spec);
  const candidates: string[] = [];
  for (const e of SPECIFIER_EXTS) candidates.push(`${specPath}${e}`);
  // TS 的 ".js 说明符 → .ts 源" 约定（import "./helper.js" 解析到 helper.ts）
  const jsExt = /\.(m|c)?js$/i.exec(spec);
  if (jsExt) {
    const stem = specPath.slice(0, -jsExt[0].length);
    for (const e of [".ts", ".tsx", ".mts", ".cts"]) candidates.push(`${stem}${e}`);
  }
  for (const e of SPECIFIER_EXTS) candidates.push(join(specPath, `index${e}`));
  for (const c of candidates) {
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(c, { throwIfNoEntry: false });
    } catch {
      continue;
    }
    if (!st || !st.isFile()) continue;
    return productSpecifier(spec, c, specPath);
  }
  notes.push(
    `relative specifier '${spec}' could not be resolved — extension not added (ESM requires an explicit file extension)`,
  );
  return undefined;
}

/** 用产物的扩展名重建说明符（保留调用方的目录形态） */
function productSpecifier(spec: string, resolved: string, specPath: string): string {
  const resolvedExt = extname(resolved).toLowerCase();
  const ext = productExtOf(resolvedExt);
  const slash = Math.max(spec.lastIndexOf("/"), spec.lastIndexOf("\\"));
  const head = spec.slice(0, slash + 1);
  const last = spec.slice(slash + 1);
  if (last.length === 0) return spec;
  const stem = last.replace(/\.[^./]+$/, "");
  const isIndex = resolved === join(specPath, `index${resolvedExt}`);
  return `${head}${isIndex ? `${stem}/index` : stem}${ext}`;
}

/** strip 的产物计划（写盘前的全部计算结果） */
type StripPlan = {
  /** 判别位：与 StripFileFailure 区分（内部类型，不进公开面） */
  kind: "plan";
  /** 源文件（绝对路径） */
  file: string;
  /** 产物文件（绝对路径） */
  outFile: string;
  /** 产物内容 */
  code: string;
  /** 面向用户的提示 */
  notes: string[];
  /** 侧车迁移（源侧车 → 产物侧车）：不是独立实现源 */
  sidecar: boolean;
};

/**
 * 单个文件的失败（**解析错**）——逐文件隔离用（族 56b · Bug 696 的库面半边）。
 *
 * 结构与 `migrateVerify` 的逐文件错误行**同款**：`code`（机器面失败码）
 * + `error`（带文件名的失败详情）。失败**不**中止整批 ⇒ 同目标内其它文件
 * 的成功结果照常返回（原先 `makeStripPlan` 直接 throw ⇒ 同目标内的成功
 * 结果**全丢**）。
 */
type StripFileFailure = {
  /** 判别位：与 StripPlan 区分（内部类型，不进公开面） */
  kind: "failure";
  /** 源文件（绝对路径） */
  file: string;
  /** 产物文件（绝对路径） */
  outFile: string;
  /** 失败码（机器面）：与 `migrateVerify` 的逐文件失败码**同码** */
  code: string;
  /** 失败详情（带文件名） */
  error: string;
};

/** strip 的计划项：成功计划 或 逐文件失败（两者按计划顺序混排） */
type StripOutcome = StripPlan | StripFileFailure;

/**
 * strip 的逐文件失败码（机器面）——**沿用** `migrateVerify` 的逐文件失败码
 * （`analysis-error`）⇒ 两个面同码，不另立码表。
 */
const STRIP_FAILURE_CODE = "analysis-error";

/**
 * 「这一批因别的文件失败而**没有**写盘」的注记（写盘模式下有失败时挂在
 * 成功行上）——防止调用方把「计划成功」误读成「已写盘」。
 */
const STRIP_NOT_WRITTEN_NOTE =
  "not written — another file in this strip batch failed (strip is atomic: a failed batch writes nothing)";

/** 侧车源（*.nudo.ts）：TS 源的侧车，随产物侧车（*.nudo.js）迁移 */
const SIDECAR_TS_RE = /\.nudo\.ts$/i;

function isSidecarSource(file: string): boolean {
  return SIDECAR_TS_RE.test(file);
}

/** 源 → 产物的扩展名映射（strip 只剥类型，不做模块系统转换） */
function productPathOf(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === ".mts") return file.replace(/\.mts$/i, ".mjs");
  if (ext === ".cts") return file.replace(/\.cts$/i, ".js");
  return file.replace(/\.ts$/i, ".js");
}

/** 备份名：<path>.bak 被占用时改用 <path>.1.bak / <path>.2.bak …（绝不静默跳过） */
function uniqueBackupPath(path: string): string {
  if (!existsSync(`${path}.bak`)) return `${path}.bak`;
  let i = 1;
  while (existsSync(`${path}.${i}.bak`)) i++;
  return `${path}.${i}.bak`;
}

type StripOp =
  | { kind: "write"; path: string; text: string }
  | { kind: "rename"; from: string; to: string };

/**
 * strip 写盘事务：全部成功才落盘；任一步失败 ⇒ 回滚已落盘的部分
 * （Bug 574：逐文件写盘留下半写状态）。复用既有的
 * snapshotFile / restoreSnapshot（事务基建），不另造快照机制。
 */
function commitStripOps(ops: StripOp[]): void {
  const snaps: FileSnapshot[] = [];
  try {
    for (const op of ops) {
      if (op.kind === "write") {
        snaps.push(snapshotFile(op.path));
        writeFileAtomic(op.path, op.text);
      } else {
        snaps.push(snapshotFile(op.to));
        snaps.push(snapshotFile(op.from));
        renameSync(op.from, op.to);
      }
    }
  } catch (err) {
    for (let i = snaps.length - 1; i >= 0; i--) {
      try {
        restoreSnapshot(snaps[i]!);
      } catch {
        /* best-effort 回滚：保留原错误 */
      }
    }
    throw err;
  }
}

/**
 * 单个产物的计算（**解析失败 ⇒ 降级成一行错误**（逐文件隔离，族 56b）；
 * .tsx ⇒ 拒绝迁移（整批 throw：那是**产品判定**不是解析失败））。
 */
function makeStripPlan(file: string, outFile: string, sidecar: boolean): StripOutcome {
  const ext = extname(file).toLowerCase();
  if (TSX_EXT.has(ext)) {
    // JSX 需要 JSX 变换（编译变换），strip 的产品约束是「只剥类型」⇒ 不产出
    // Node 加载不了的 .jsx（Bug 583：零告警 exit 0 的假绿）。
    throw new Error(
      `JSX source not migratable by strip: ${file} — strip removes types only (no JSX transform); compile .tsx with a JSX-capable build (tsc --jsx / esbuild) and strip the result`,
    );
  }
  const source = readFileSync(file, "utf-8");
  if (!isStripSource(file)) {
    // 非 TS 侧车（.js 形态）：原样迁移，不重排格式
    return { kind: "plan", file, outFile, code: source, notes: [], sidecar };
  }
  let code: string;
  let notes: string[];
  try {
    ({ code, notes } = stripTsToJs(source, { filePath: file }));
  } catch (err) {
    // 错误信息必须点名文件（Bug 574：Babel 的 "Unexpected token (2:12)" 无路径）
    // 族 56b：**不**再 throw（那会中止整批 ⇒ 同目标内的成功结果全丢）⇒
    // 降级成一行错误（结构同 `migrateVerify` 的逐文件错误行）。
    return {
      kind: "failure",
      file,
      outFile,
      code: STRIP_FAILURE_CODE,
      error: `parse failed: ${file}: ${(err as Error).message}`,
    };
  }
  if (!sidecar && ext === ".cts") {
    notes.push(
      'source is CommonJS TypeScript (.cts) — strip does not transform module systems: the .js product keeps the source\'s import/export syntax (Node parses .js as CommonJS unless the nearest package.json sets "type": "module")',
    );
  }
  return { kind: "plan", file, outFile, code, notes, sidecar };
}

/**
 * 产物计划：先算完再写（两阶段）⇒ 解析失败时一个字节都不落盘（Bug 574）。
 * 目录路径与单文件路径走**同一条**侧车迁移逻辑（Bug 969）。
 *
 * 族 56b：解析失败**不再中止整批**——失败项降级成 `StripFileFailure`
 * （一行错误，带文件名）⇒ 同目标内其它文件的成功结果照常返回。
 * ⚠ 目标级错误（`not found` / 非 TS 源 / `.tsx` 不可迁移）**仍**整批 throw：
 * 那是**用法/产品判定**，不是逐文件的解析失败。
 */
function planStrip(paths: string[]): StripOutcome[] {
  const plans: StripOutcome[] = [];
  const add = (file: string, outFile: string, sidecar: boolean): void => {
    plans.push(makeStripPlan(file, outFile, sidecar));
  };
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      throw new Error(`not found: ${p}`);
    }
    if (statSync(abs).isDirectory()) {
      const all = listFiles(abs).filter((f) => isStripSource(f));
      const claimed = new Set<string>();
      for (const f of all) {
        // 侧车不是独立实现源：随产物侧车（*.nudo.js）一起迁移（Bug 969）
        if (isSidecarSource(f)) continue;
        const product = productPathOf(f);
        add(f, product, false);
        const src = sidecarPathOf(f);
        if (src !== f && existsSync(src)) {
          claimed.add(src);
          add(src, sidecarPathOf(product), true);
        }
      }
      for (const f of all) {
        // 孤儿侧车（没有对应的 TS 源）：按普通源处理（保留旧行为）
        if (!isSidecarSource(f) || claimed.has(f)) continue;
        add(f, productPathOf(f), false);
      }
    } else {
      // 显式路径同样过扩展名门：非 TS / .d.* 声明是用法错误（不静默跳过）
      if (!isStripSource(abs)) {
        throw new Error(
          `not a TypeScript source (need .ts/.mts/.cts, not .d.ts decls, .js or .tsx): ${p}`,
        );
      }
      if (isSidecarSource(abs)) {
        add(abs, productPathOf(abs), false);
        continue;
      }
      const product = productPathOf(abs);
      add(abs, product, false);
      // 单文件路径同样迁移既有侧车（Bug 969：目录路径会迁、单文件不会）
      const src = sidecarPathOf(abs);
      if (src !== abs && existsSync(src)) {
        add(src, sidecarPathOf(product), true);
      }
    }
  }
  return plans;
}

/**
 * 计划项 → 结果行（失败项 = **一行错误**；成功项 = 一行计划）。
 *
 * 族 56b：失败行与 `migrateVerify` 的逐文件错误行**同款**
 * （`code` + `error`；`error` 带文件名）⇒ 机器面**同一套**读法。
 * 成功行的字段**逐字不变**（负控：全部成功时的输出与旧版逐字相同）。
 */
function stripOutcomeToResult(o: StripOutcome): StripResult {
  if (o.kind === "failure") {
    return {
      file: relative(process.cwd(), o.file),
      outFile: relative(process.cwd(), o.outFile),
      notes: [],
      code: o.code,
      error: o.error,
    };
  }
  return {
    file: relative(process.cwd(), o.file),
    outFile: relative(process.cwd(), o.outFile),
    notes: o.notes,
  };
}

export async function migrateStrip(
  paths: string[],
  opts: { write?: boolean; draft?: boolean; backup?: boolean } = {},
): Promise<StripResult[]> {
  // 阶段一：**先算完全部结果**（含错误行，零写盘）——族 56b：
  // 解析失败**不再中止整批**（降级成一行错误，带文件名；结构同
  // `migrateVerify` 的逐文件错误行）⇒ 同目标内其它文件的成功结果照常返回。
  const outcomes = planStrip(paths);
  const failures = outcomes.filter((o): o is StripFileFailure => o.kind === "failure");
  const plans = outcomes.filter((o): o is StripPlan => o.kind === "plan");
  if (!opts.write) {
    return outcomes.map(stripOutcomeToResult);
  }
  if (failures.length > 0) {
    // 原子性（Bug 574）：任一文件失败 ⇒ **整批零写盘**。
    // 但**结果不丢**：成功文件的行照常返回（附「未写盘」注记 ⇒ 调用方
    // 不会把「计划成功」误读成「已写盘」）。
    const rows = outcomes.map(stripOutcomeToResult);
    for (const row of rows) {
      if (!row.code) row.notes.push(STRIP_NOT_WRITTEN_NOTE);
    }
    return rows;
  }
  // 阶段二：写盘（事务）——目标已存在且内容不同 ⇒ 拒绝覆盖（Bug 575）
  const ops: StripOp[] = [];
  for (const p of plans) {
    if (!existsSync(p.outFile)) continue;
    const existing = readFileSync(p.outFile, "utf-8");
    if (existing === p.code) continue; // 幂等重跑：内容逐字相同，覆盖无损失
    if (!opts.backup) {
      throw new Error(
        `target exists: ${p.outFile} — refusing to overwrite (remove it, or re-run with --backup to keep a copy)`,
      );
    }
    const bak = uniqueBackupPath(p.outFile);
    ops.push({ kind: "rename", from: p.outFile, to: bak });
    p.notes.push(
      `backed up existing ${relative(process.cwd(), p.outFile)} → ${relative(process.cwd(), bak)}`,
    );
  }
  // --backup：源改名留底（备份名被占用时换名，绝不静默跳过 —— Bug 591）
  if (opts.backup) {
    for (const p of plans) {
      if (p.sidecar || !existsSync(p.file)) continue;
      const bak = uniqueBackupPath(p.file);
      ops.push({ kind: "rename", from: p.file, to: bak });
      p.notes.push(
        `backed up ${relative(process.cwd(), p.file)} → ${relative(process.cwd(), bak)}`,
      );
    }
  }
  for (const p of plans) {
    ops.push({ kind: "write", path: p.outFile, text: p.code });
    if (p.sidecar) {
      p.notes.push(
        `sidecar migrated ${relative(process.cwd(), p.file)} → ${relative(process.cwd(), p.outFile)}`,
      );
    }
  }
  commitStripOps(ops);
  // 侧车草稿（best-effort）：落盘到 **草稿路径**（不进 ambient 侧车表 —— Bug 585/592）
  const results: StripResult[] = [];
  for (const p of plans) {
    let sidecarDraft: string | undefined;
    if (opts.draft !== false && !p.sidecar) {
      try {
        const draft = await draftInterface(p.outFile, { source: p.code, bodyAccesses: true });
        if (draft.draftSource && draft.draftSource.trim().length > 0) {
          const written = writeInterfaceDraft(p.outFile, draft.draftSource, {
            entries: draft.entries,
          });
          if (written.written) {
            sidecarDraft = written.draftPath;
          } else if (written.skipped === "hand-edited") {
            p.notes.push("sidecar draft kept (existing draft was edited by hand)");
          }
        }
      } catch {
        /* optional: draft is best-effort — migrate continues without sidecar */
      }
    }
    results.push({
      file: relative(process.cwd(), p.file),
      outFile: relative(process.cwd(), p.outFile),
      ...(sidecarDraft ? { sidecarDraft: relative(process.cwd(), sidecarDraft) } : {}),
      notes: p.notes,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// verify — 迁移期门禁（与 nudo check 同源：文件集合 / 分析注入 / 门禁档）
// ---------------------------------------------------------------------------

/** verify 的分析注入包（与 commands/check.ts 的 buildCheckInjection 同口径） */
type VerifyInject = import("@nudojs/core").RunTranspiledOptions;
/** D1 指令文法诊断（@nudojs/parser） */
type VerifyDirectiveDiag = import("@nudojs/parser").DirectiveDiag;

/** tsc 基线的文件级诊断（`path(line,col): error TSxxxx: msg`） */
type TscDiag = { file: string; line: number; text: string };

/** 一次 tsc 运行的产物（项目级跑一次，按文件切分） */
type TscRun = {
  /** 项目根（tsconfig 所在目录；无 tsconfig 时 = 运行 cwd） */
  projectDir: string;
  /** tsc 是否跑成功（false = 运行失败：tsc 不可用 / 配置非法等） */
  ran: boolean;
  /** 原始输出（运行失败时 = 失败原因全文） */
  raw: string;
  /** 文件级诊断 */
  diags: TscDiag[];
};

/** tsc 诊断行：`path(line,col): error TSxxxx: msg`（项目级错误无此形态） */
const TSC_DIAG_RE = /^(.+?)\((\d+),(\d+)\):\s+(?:error|warning)\s+(TS\d+):\s*(.*)$/;

/** 向上找最近的 tsconfig.json（最多 8 层）——被检文件所属的 TS 项目 */
function findNearestTsconfig(dir: string): string | undefined {
  let cur = resolve(dir);
  for (let i = 0; i < 8; i++) {
    const candidate = join(cur, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
  return undefined;
}

function parseTscDiags(raw: string): TscDiag[] {
  const out: TscDiag[] = [];
  for (const line of raw.split("\n")) {
    const text = line.trim();
    const m = TSC_DIAG_RE.exec(text);
    if (m) out.push({ file: m[1]!, line: Number(m[2]), text });
  }
  return out;
}

/**
 * tsc 基线（Bug 582）：**项目级**跑一次，诊断按被检文件切分。
 *
 * 旧实现把源文件当**位置参数**传给 tsc ⇒ 现代 TS 见到「命令行给了文件 +
 * 目录里有 tsconfig.json」直接拒绝（TS5112）⇒ 干净文件与有错文件的基线
 * **逐字相同**（零信号）。现在：
 * - 有 tsconfig ⇒ `tsc -p <tsconfig>`（cwd = 项目根）——配置真正被加载；
 * - 无 tsconfig ⇒ 退回按文件位置参数（祖先链上没有 tsconfig ⇒ 不会有 TS5112）；
 * - 诊断按**被检文件**切分 ⇒ 干净文件与有错文件的基线必然不同。
 */
function runTscProject(dir: string, file: string, fallbackCwd: string): TscRun {
  const tsconfig = findNearestTsconfig(dir);
  const projectDir = tsconfig ? dirname(tsconfig) : resolve(fallbackCwd);
  const args = tsconfig
    ? ["exec", "tsc", "-p", tsconfig, "--noEmit", "--pretty", "false", "--skipLibCheck"]
    : ["exec", "tsc", "--noEmit", "--pretty", "false", "--skipLibCheck", file];
  try {
    const out = execFileSync("pnpm", args, {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { projectDir, ran: true, raw: out, diags: parseTscDiags(out) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const raw = `${err.stdout ?? ""}${err.stderr ?? err.message ?? ""}`.trim();
    return { projectDir, ran: false, raw, diags: parseTscDiags(raw) };
  }
}

/** 单文件基线：只取该文件的诊断；项目级失败（无文件级诊断）时透传失败原因 */
function tscBaselineForFile(run: TscRun, file: string): { ok: boolean; output: string } {
  const abs = resolve(file);
  const mine = run.diags.filter((d) => resolve(run.projectDir, d.file) === abs);
  if (mine.length > 0) {
    return { ok: false, output: mine.map((d) => d.text).join("\n") };
  }
  // 无本文件诊断：要么干净（ran），要么错误在别的文件（项目级 diags 非空）
  if (run.ran || run.diags.length > 0) return { ok: true, output: "" };
  // 项目级失败（tsc 不可用 / 配置非法）：不得报绿——基线根本没建立起来
  return { ok: false, output: run.raw };
}

/**
 * verify 的分析注入装配（Bug 593）——与 `commands/check.ts` 的 buildCheckInjection
 * 同口径：模块图（evalAbsModuleGraph）+ env modules + `@nudo:mock-module` 覆盖
 * + `@nudo:mock` seeds + env 全局 + `@nudo:as` / `@nudo:replace` 替换。
 *
 * 缺了它 ⇒ verify 跑在「没有模块图、没有 mock」的世界里 ⇒ 与 `nudo check`
 * **判相反**（跨模块 ⇒ 假绿；`@nudo:mock` ⇒ 假红 + 误导诊断）。
 */
async function buildVerifyInjection(
  filePath: string,
  source: string,
  allEnvNames: string[],
): Promise<{
  inject: VerifyInject;
  mockFromErrors: Array<{ name: string; fromPath: string; message: string; code?: string }>;
  dirDiags: VerifyDirectiveDiag[];
}> {
  const {
    applyMockModuleDirectivesFromSource,
    collectEnvGlobals,
    collectEnvModules,
    collectEvalReplacements,
    evalAbsModuleGraph,
    mockDirectivesToAbsSeeds,
    mockSeedsToAbsMocks,
  } = await import("@nudojs/service");
  const { extractDirectives, extractFileDirectives, parse, runWithDirectiveDiags } =
    await import("@nudojs/parser");
  const dirDiags: VerifyDirectiveDiag[] = [];
  const graph = evalAbsModuleGraph(source, filePath);
  const reps = collectEvalReplacements(source, { diags: dirDiags });
  const seedPkg = runWithDirectiveDiags(dirDiags, () => {
    const ast = parse(source);
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast), { fromFile: filePath });
    // D1 同族：JSDoc 块内错位的文件级指令族标签不再静默
    extractFileDirectives(ast);
    return seeds;
  });
  let mockFromErrors = seedPkg.fromErrors ?? [];
  const mocks = mockSeedsToAbsMocks(seedPkg);
  const envGlobals = collectEnvGlobals(allEnvNames);
  const envMods = collectEnvModules(allEnvNames);
  let mergedMods = {
    ...graph.modules,
    ...(Object.keys(envMods).length > 0 ? envMods : {}),
  };
  const mm = applyMockModuleDirectivesFromSource(source, mergedMods, { fromFile: filePath });
  mergedMods = mm.modules;
  mockFromErrors = [
    ...mockFromErrors,
    ...mm.errors.map((e) => ({
      name: e.name,
      fromPath: e.fromPath,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
    })),
  ];
  const inject: VerifyInject = {
    ...(Object.keys(mergedMods).length > 0 ? { modules: mergedMods } : {}),
    ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
    ...(Object.keys(envGlobals).length > 0 ? { envGlobals } : {}),
    ...(reps.targets.length > 0
      ? { replacements: reps.values, replacementTargets: reps.targets }
      : {}),
    ...(reps.asTargets.length > 0
      ? { asOverrides: reps.asValues, asOverrideTargets: reps.asTargets }
      : {}),
  };
  return { inject, mockFromErrors, dirDiags };
}

export async function migrateVerify(
  paths: string[],
  opts: { withTsc?: boolean; root?: string; json?: boolean } = {},
): Promise<VerifyResult[]> {
  const { checkSource, formatCheckReport, pTrue, extractFileEnvNames } = await import("@nudojs/core");
  const {
    analyzeFileAsync,
    checkConfig,
    collectSkipReturns,
    defaultLoadModule,
    findProjectConfig,
    interfaceConfig,
  } = await import("@nudojs/service");
  const { preloadPathEnvs } = await import("@nudojs/service/evaluator");
  const { checkGateFromConfig, mergeIgnoreThrows, resolveEntryThrows } = await import(
    "./check-gate-config.ts"
  );
  const {
    directiveDiagIssues,
    domainIssuesFromDiagnostics,
    mergeCheckIssues,
    mockFromErrorIssues,
  } = await import("./check-json-map.ts");
  const results: VerifyResult[] = [];
  const files: string[] = [];
  /** 空集 / 非目标：与 nudo check 同口径判红（不能给「无东西可验」发绿灯通行证） */
  const emptyRows: VerifyResult[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      throw new Error(`not found: ${p}`);
    }
    if (statSync(abs).isDirectory()) {
      // Bug 566：文件筛选与 nudo check 同口径——侧车（*.nudo.js）与 .d.ts 声明
      // **不是**分析目标，不得当源码分析。**扫描面本身**按 verify 自己的口径
      // （isVerifyTargetPath，见其注释）：额外纳入 `.jsx` / `.tsx` / `.cjs`
      // （JSX 产物 / TSX 源 / CJS 产物此前对 verify **不可见** ⇒ 假绿）。
      const found = listFiles(abs).filter((f) => isVerifyTargetPath(f));
      if (found.length === 0) {
        // Bug 589：空集 ≠ 验过了（与 check 面的空目录判定一致）
        emptyRows.push({
          file: relative(process.cwd(), abs),
          nudoOk: false,
          nudoSummary: "0 error · 0 warning · 0 fn",
          code: "no-files",
          error: `No nudo files found in directory: ${abs}`,
          fix: "add .js/.mjs/.jsx/.ts sources (or point at a directory that has them); sidecar/decl are skipped",
        });
        continue;
      }
      files.push(...found);
    } else if (!isVerifyTargetPath(abs)) {
      emptyRows.push({
        file: relative(process.cwd(), abs),
        nudoOk: false,
        nudoSummary: "0 error · 0 warning · 0 fn",
        code: "not-a-target",
        error: `Not an analysis target (need .js/.mjs/.jsx/.ts, not sidecar/decl): ${abs}`,
        fix: "pass a .js/.mjs/.jsx/.ts analysis file (not .nudo.js sidecars or .d.ts decls)",
      });
    } else {
      files.push(abs);
    }
  }
  const tscCache = new Map<string, TscRun>();
  const fallbackCwd = opts.root ?? process.cwd();
  for (const file of files) {
    let row: VerifyResult;
    try {
      const source = readFileSync(file, "utf-8");
      const proj = findProjectConfig(dirname(file));
      const cCfg = checkConfig(proj?.config);
      // 门禁档与 nudo check 同源（CLI 旗标 > pkg entryThrows > pkg profile > 默认）
      const gate = checkGateFromConfig(proj?.config);
      const entryThrows = resolveEntryThrows({}, gate, cCfg.entryThrows);
      const ignoreThrows = mergeIgnoreThrows(undefined, cCfg.ignoreThrows);
      const autoBind = interfaceConfig(proj?.config).autoBind;
      // env 名：项目配置 + 文件级 @nudo:env（命名 env 与 path env 同口径）
      const envNames = [
        ...new Set([...(proj?.config.env ?? []), ...extractFileEnvNames(source)]),
      ];
      // path 型 @nudo:env 预载（check 同口径：先 preload，再 collect globals）
      if (envNames.length > 0) {
        await preloadPathEnvs(envNames, dirname(file));
      }
      const { inject, mockFromErrors, dirDiags } = await buildVerifyInjection(
        file,
        source,
        envNames,
      );
      // interface 家族诊断（分析器通道）——check 的门禁面也含它们
      let domainIssues: ReturnType<typeof domainIssuesFromDiagnostics> = [];
      try {
        const analysis = await analyzeFileAsync(
          file,
          source,
          undefined,
          undefined,
          undefined,
          "none",
        );
        domainIssues = domainIssuesFromDiagnostics(analysis.diagnostics);
      } catch {
        /* 分析器通道失败不得拖垮 verify（诊断面降级，不造门禁） */
      }
      let report = checkSource(file, source, pTrue, {
        loadModule: defaultLoadModule,
        fromFile: file,
        ...(autoBind === false ? { autoBind: false } : {}),
        ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
        entryThrows,
        ...(ignoreThrows.length > 0 ? { ignoreThrows } : {}),
        // 分析注入与 nudo check 同源（模块图 / mock / env / replace / as）
        ...(Object.keys(inject).length > 0
          ? { modules: inject.modules as never, inject }
          : {}),
        // 与 nudo check 同源：@nudo:skip 的函数不评估 body（verify 的 ok 必须等于 check）
        skips: collectSkipReturns(source),
      });
      // D1 指令文法诊断 + mock 解析失败 + interface 家族诊断（与 check 同口径并入）
      if (dirDiags.length > 0) {
        report = mergeCheckIssues(report, directiveDiagIssues(dirDiags));
      }
      if (mockFromErrors.length > 0) {
        report = mergeCheckIssues(report, mockFromErrorIssues(mockFromErrors));
      }
      if (domainIssues.length > 0) {
        report = mergeCheckIssues(report, domainIssues);
      }
      const summary = `${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.functions} fn`;
      row = {
        file: relative(process.cwd(), file),
        nudoOk: report.ok,
        nudoSummary: summary,
      };
      if (!report.ok) {
        // 人工报告：--json 时走 stderr（stdout 保持机器契约，见 check-report.ts）
        const text = formatCheckReport(report);
        if (opts.json) console.error(text);
        else console.log(text);
      }
    } catch (err) {
      // Bug 569：per-file 隔离——单个文件失败**不**中止整批；失败项带文件名
      row = {
        file: relative(process.cwd(), file),
        nudoOk: false,
        nudoSummary: "0 error · 0 warning · 0 fn",
        code: "analysis-error",
        error: `${file}: ${(err as Error).message ?? String(err)}`,
      };
    }
    if (opts.withTsc) {
      // 迁移期对照：仅对 .ts 跑 tsc 基线；.js 无注解则跳过
      if (TS_EXT.has(extname(file).toLowerCase()) || TSX_EXT.has(extname(file).toLowerCase())) {
        const dir = dirname(file);
        const tsconfig = findNearestTsconfig(dir);
        const key = tsconfig ?? `file:${file}`;
        let run = tscCache.get(key);
        if (!run) {
          run = runTscProject(dir, file, fallbackCwd);
          tscCache.set(key, run);
        }
        row.tsc = tscBaselineForFile(run, file);
      }
    }
    results.push(row);
  }
  return [...emptyRows, ...results];
}

// ---------------------------------------------------------------------------
// retire —— 退役面判定 / 计划（只读）/ 提交（全批原子）
// ---------------------------------------------------------------------------

/** 编译角色脚本名（构建 / 发射）——这类脚本产出产物，不得改成 `nudo check` */
const COMPILER_SCRIPT_NAMES = new Set([
  "build",
  "bundle",
  "compile",
  "emit",
  "prepack",
  "prepublish",
  "prepublishOnly",
  "preprepare",
]);

/** tsc 的发射语义旗标：出现即产产物 ⇒ 编译器角色（不是门禁） */
const TSC_EMIT_FLAGS = [
  "--outDir",
  "--outFile",
  "--out",
  "--declaration",
  "--declarationMap",
  "--emitDeclarationOnly",
  "--sourceMap",
  "--inlineSourceMap",
  "--inlineSources",
];

/**
 * 脚本里 tsc 调用的角色：
 * - `gate`：类型门禁（`--noEmit` 或裸 tsc）⇒ 可改写成 `nudo check`
 * - `compiler`：编译器（发射旗标 / `-b` / `-p` 指向**会 emit** 的项目 /
 *   脚本名是构建角色且它**真的会 emit**）⇒ **原样保留**
 * - `null`：不是 tsc 调用（判定口径与改写口径同源：`isTscCommand`）
 *
 * 族 16 收口（Bug 586）：`-p <项目>` 只说明「用了项目配置」，**不代表会产产物**
 * —— tsconfig 里 `compilerOptions.noEmit: true` 时它就是**类型检查**。
 * 报告 586 的判据是「**真的会 emit**」（夹具 tsconfig 带 `outDir` + `declaration`）。
 * 脚本名（`build` 等）只是启发式，同样要让位于「是否真的 emit」。
 */
function scriptTscRole(name: string, cmd: string, root?: string): "gate" | "compiler" | null {
  if (!isTscCommand(cmd)) return null;
  const masked = maskShellStringsAndComments(cmd);
  const hasNoEmit = /(^|\s)--noEmit(\s|=|$)/.test(masked);
  const buildMode = /(^|\s)(-b|--build)(\s|$)/.test(masked);
  const projectFlag = /(^|\s)(-p|--project)([\s=]|$)/.test(masked);
  const emitFlag = TSC_EMIT_FLAGS.some((f) => masked.includes(f));
  if (hasNoEmit) return "gate";
  if (buildMode || emitFlag) return "compiler";
  if (projectFlag) {
    // `-p X`：读 X 的 tsconfig 判「会不会真的 emit」
    if (root) {
      const project = tscProjectArg(cmd);
      if (project !== undefined && !projectEmits(root, project)) return "gate";
    }
    return "compiler";
  }
  if (COMPILER_SCRIPT_NAMES.has(name)) {
    // 名字像编译脚本 —— 但若它**不 emit**（默认 tsconfig 里 `noEmit: true`）
    // ⇒ 它其实是门禁角色（可改写成 `nudo check`）
    if (root && !projectEmits(root, tscProjectArg(cmd) ?? ".")) return "gate";
    return "compiler";
  }
  return "gate";
}

/** 命令里 `-p/--project` 指向的**原始**项目路径（词法扫描，避开注释与引号误伤） */
function tscProjectArg(cmd: string): string | undefined {
  const words = scanShellWords(cmd);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.value === "-p" || w.value === "--project") return words[i + 1]?.value;
    if (w.value.startsWith("--project=")) return w.value.slice("--project=".length);
  }
  return undefined;
}

/** 项目路径 ⇒ tsconfig 文件路径（目录 ⇒ 其 `tsconfig.json`；读不到 ⇒ undefined） */
function resolveTsconfigPath(root: string, project: string): string | undefined {
  const abs = isAbsolute(project) ? project : resolve(root, project);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st) return undefined;
  if (st.isDirectory()) {
    const p = join(abs, "tsconfig.json");
    return statSync(p, { throwIfNoEntry: false })?.isFile() === true ? p : undefined;
  }
  return st.isFile() === true ? abs : undefined;
}

/** tsconfig 的 `extends` 链解析（相对被继承配置所在目录） */
function resolveTsconfigExtends(cfgPath: string, ext: string): string | undefined {
  const dir = dirname(cfgPath);
  const base = isAbsolute(ext) ? ext : resolve(dir, ext);
  const st = statSync(base, { throwIfNoEntry: false });
  if (!st) return undefined;
  if (st.isDirectory()) {
    const p = join(base, "tsconfig.json");
    return statSync(p, { throwIfNoEntry: false })?.isFile() === true ? p : undefined;
  }
  return st.isFile() === true ? base : undefined;
}

/**
 * 该项目配置**会不会产出产物**（emit）。
 * `compilerOptions.noEmit: true` ⇒ 不 emit（纯类型检查 ⇒ 门禁角色）。
 * `extends` 链上任何一层设了 `noEmit` 也算。读不到配置 ⇒ 保守按「会 emit」。
 */
function projectEmits(root: string, project: string): boolean {
  const cfgPath = resolveTsconfigPath(root, project);
  if (!cfgPath) return true;
  const seen = new Set<string>();
  let cur: string | undefined = cfgPath;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const cfg = readTsConfig(cur);
    if (!cfg) return true;
    const opts = cfg["compilerOptions"];
    if (opts && typeof opts === "object") {
      const noEmit = (opts as Record<string, unknown>)["noEmit"];
      if (noEmit === true) return false;
    }
    const ext = cfg["extends"];
    cur = typeof ext === "string" ? resolveTsconfigExtends(cur, ext) : undefined;
  }
  return true;
}

/** 读 tsconfig（JSONC：允许行注释 / 块注释与尾逗号） */
function readTsConfig(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** JSONC ⇒ JSON：剥行注释 / 块注释与尾逗号（字符串字面量内的内容不动） */
function stripJsoncComments(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += text.slice(start, i);
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** 退役面：typescript 依赖 + tsc 脚本的角色判定 */
type RetireSurface = {
  hasTypescriptDep: boolean;
  gateScripts: string[];
  compilerScripts: string[];
};

function retireSurface(pkg: Record<string, unknown>, root?: string): RetireSurface {
  const gateScripts: string[] = [];
  const compilerScripts: string[] = [];
  for (const [name, cmd] of scriptCommandEntries(pkg)) {
    const role = scriptTscRole(name, cmd, root);
    if (role === "gate") gateScripts.push(name);
    else if (role === "compiler") compilerScripts.push(name);
  }
  return {
    hasTypescriptDep: Boolean(mergePackageDeps(pkg).typescript),
    gateScripts,
    compilerScripts,
  };
}

/** 被退役包**自有**的 workflow 目录（不向上找）——作用域不得越到仓库根 */
function ownWorkflowDir(root: string): string | undefined {
  const wf = join(root, ".github", "workflows");
  return statSync(wf, { throwIfNoEntry: false })?.isDirectory() ? wf : undefined;
}

/** 指定目录内的 workflow 改写计划（只读，不写盘） */
function planWorkflowRewritesIn(dir: string | undefined): PlannedWorkflowWrite[] {
  if (!dir) return [];
  const out: PlannedWorkflowWrite[] = [];
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const p = join(dir, name);
    const text = readFileSync(p, "utf-8");
    const { text: next, changes } = rewriteWorkflowText(text);
    if (changes.length === 0) continue;
    out.push({ path: p, file: relative(process.cwd(), p), text: next, changes });
  }
  return out;
}

/** workflow 改写记录投影（stdout 报文与落盘 marker 共用 ⇒ 同键同型） */
function workflowRewriteRecords(planned: PlannedWorkflowWrite[]): RetireWorkflowChange[] {
  return planned.flatMap((w) => w.changes.map((c) => ({ file: w.file, from: c.from, to: c.to })));
}

/** 集合并集（按 key 去重；既有记录在前 ⇒ 首次退役的审计不被覆盖） */
function unionBy<T>(a: readonly T[], b: readonly T[], key: (x: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of [...a, ...b]) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** 既有 marker 读取 + 旧格式归一（旧 `rewrittenWorkflows` 是路径字符串数组） */
function readMarkerRecords(prev: Record<string, unknown> | undefined): {
  retiredAt?: string;
  removedDeps: string[];
  rewrittenScripts: RetireScriptChange[];
  rewrittenWorkflows: RetireWorkflowChange[];
  preservedScripts: RetirePreservedScript[];
  keptDeps: string[];
} {
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const rewrittenScripts: RetireScriptChange[] = [];
  for (const s of Array.isArray(prev?.rewrittenScripts) ? prev.rewrittenScripts : []) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (typeof r.name !== "string") continue;
    rewrittenScripts.push({ name: r.name, from: String(r.from ?? ""), to: String(r.to ?? "") });
  }
  const rewrittenWorkflows: RetireWorkflowChange[] = [];
  for (const w of Array.isArray(prev?.rewrittenWorkflows) ? prev.rewrittenWorkflows : []) {
    if (typeof w === "string") {
      // 旧格式只有路径（无 from/to）——补成同型对象，审计链不断
      rewrittenWorkflows.push({ file: w, from: "(unknown)", to: "(unknown)" });
      continue;
    }
    if (!w || typeof w !== "object") continue;
    const r = w as Record<string, unknown>;
    if (typeof r.file !== "string") continue;
    rewrittenWorkflows.push({ file: r.file, from: String(r.from ?? ""), to: String(r.to ?? "") });
  }
  const preservedScripts: RetirePreservedScript[] = [];
  for (const s of Array.isArray(prev?.preservedScripts) ? prev.preservedScripts : []) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (typeof r.name !== "string") continue;
    preservedScripts.push({
      name: r.name,
      command: String(r.command ?? ""),
      reason: String(r.reason ?? ""),
    });
  }
  return {
    ...(typeof prev?.retiredAt === "string" ? { retiredAt: prev.retiredAt } : {}),
    removedDeps: strArray(prev?.removedDeps),
    rewrittenScripts,
    rewrittenWorkflows,
    preservedScripts,
    keptDeps: strArray(prev?.keptDeps),
  };
}

/** 退役计划（只读，不落盘） */
type RetirePlan = {
  root: string;
  ops: Array<{ path: string; text: string }>;
  result: RetireResult;
};

/**
 * 退役批次的**失败明细**（一个失败目标 = 一条）。
 *
 * 挂在抛出的 Error 的 `retireFailures` 属性上 ⇒ 命令层可把它放进 `--json`
 * 信封（机器面拿结构化清单，不解析人读消息）。
 */
type RetireFailure = {
  /** 失败目标（调用方给的路径原样） */
  target: string;
  /** 该目标的失败原因（库面消息） */
  message: string;
};

/**
 * 批次失败的 Error：**点名全部失败目标**。
 *
 * 消息口径（**只增不减**）：
 * - 单个失败 ⇒ 与旧实现**逐字相同**（`<原因> (target: <目标>)`）；
 * - 多个失败 ⇒ 旧消息**在前**，后面追加失败清单（每行 `  <目标>: <原因>`）。
 *
 * 结构化明细挂在 `retireFailures` 上（机器面；不新增公共导出）。
 */
function retireBatchError(failures: RetireFailure[]): Error {
  const first = failures[0]!;
  const head = `${first.message} (target: ${first.target})`;
  const err =
    failures.length === 1
      ? new Error(head)
      : new Error(
          `${head} — ${failures.length} target(s) failed (no package was modified):\n` +
            failures.map((f) => `  ${f.target}: ${f.message}`).join("\n"),
        );
  (err as Error & { retireFailures?: RetireFailure[] }).retireFailures = failures;
  return err;
}

/**
 * 退役计划（只读）：算出 package.json 改写、workflow 改写、审计标记。
 * 「没有可退役的东西」⇒ 抛错（不注入、不写标记、不谎报已退役）。
 */
function planRetirePackage(root: string, opts: { workflows?: boolean }): RetirePlan {
  const pkgPath = join(root, "package.json");
  // Bug 588（retire 侧）：`readJson` 把「解析失败」与「不存在」压成同一个
  // undefined ⇒ 畸形清单谎报「no package.json under X」（与 check 面的
  // 「package.json parse failed」不同口径）。改用详细读取并 fail-closed。
  const read = readPackageJsonDetailed(pkgPath);
  if (read.kind === "missing") throw new Error(`no package.json under ${root}`);
  if (read.kind === "invalid") throw new Error(`package.json parse failed: ${read.error}`);
  if (read.kind === "unreadable") throw new Error(`package.json unreadable: ${read.error}`);
  const pkg = read.value;
  const surface = retireSurface(pkg, root);
  const markerDir = join(root, ".nudo");
  const marker = join(markerDir, "migrate-retired.json");
  const alreadyRetired = statSync(marker, { throwIfNoEntry: false })?.isFile() === true;

  // A1：CI workflow 里的 tsc 一并退役（默认开；--no-workflows 关）
  // 作用域 = **被退役包自有**的 `.github/workflows`（仓库根共享的 workflow 属于整仓作用域，
  // 退役子包不得越界改写它）
  const plannedWorkflows =
    opts.workflows === false ? [] : planWorkflowRewritesIn(ownWorkflowDir(root));

  // 编译器脚本仍要 tsc ⇒ typescript 依赖不得摘（摘了 build 当场坏掉）
  const keepTypescript = surface.compilerScripts.length > 0;
  const depRemovable = surface.hasTypescriptDep && !keepTypescript;
  const hasWorkToDo =
    depRemovable || surface.gateScripts.length > 0 || plannedWorkflows.length > 0;
  if (!hasWorkToDo && !alreadyRetired) {
    if (surface.compilerScripts.length > 0) {
      throw new Error(
        `nothing to retire (tsc is only a compiler here: ${surface.compilerScripts.join(", ")} — \`nudo check\` does not emit artifacts)`,
      );
    }
    throw new Error("nothing to retire (no tsc/typescript in scope)");
  }

  // scripts：门禁角色改写成 nudo check；编译器角色**原样保留**
  const rawScripts = pkg.scripts;
  const scripts: Record<string, unknown> =
    rawScripts && typeof rawScripts === "object" && !Array.isArray(rawScripts)
      ? { ...(rawScripts as Record<string, unknown>) }
      : {};
  const rewrittenScripts: RetireScriptChange[] = [];
  const preservedScripts: RetirePreservedScript[] = [];
  let scriptsChanged = false;
  for (const [name, cmd] of scriptCommandEntries(pkg)) {
    const role = scriptTscRole(name, cmd, root);
    if (role === null) continue;
    if (role === "compiler") {
      preservedScripts.push({
        name,
        command: cmd,
        reason:
          "compiler role (emits artifacts) — `nudo check` never emits; script left untouched",
      });
      continue;
    }
    const { cmd: rewritten } = rewriteTscCommand(cmd);
    // package.json scripts 用本地 bin 名（任意 check 路径，不只 "."）
    const local = rewritten.replace(/npx nudojs check /g, "nudo check ");
    if (local === cmd) continue;
    rewrittenScripts.push({ name, from: cmd, to: local });
    scripts[name] = local;
    scriptsChanged = true;
  }
  const hasGate = Object.values(scripts).some(
    (c) => typeof c === "string" && NUDO_GATE_RE.test(maskShellStringsAndComments(c)),
  );
  if (!scripts["check:nudo"] && !hasGate) {
    scripts["check:nudo"] = "nudo check .";
    rewrittenScripts.push({ name: "check:nudo", from: "(none)", to: "nudo check ." });
    scriptsChanged = true;
  }
  // 注入/改写必须**落进 pkg**（只改局部副本 ⇒ 落盘没有 scripts 键，报告却谎称已改写）
  if (scriptsChanged) pkg.scripts = scripts;

  // 依赖摘除
  const removedDeps: string[] = [];
  const keptDeps: string[] = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const) {
    const bag = pkg[field];
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
    const rec = bag as Record<string, unknown>;
    if (!rec.typescript) continue;
    if (keepTypescript) {
      keptDeps.push(field);
      continue;
    }
    delete rec.typescript;
    removedDeps.push(field);
  }

  // 审计标记：与既有记录**合并**（二次运行不得清空首次的审计内容）
  const prev = readMarkerRecords(readJson(marker));
  const payload: RetireMarker = {
    retiredAt: prev.retiredAt ?? new Date().toISOString(),
    removedDeps: unionBy(prev.removedDeps, removedDeps, (x) => x),
    rewrittenScripts: unionBy(
      prev.rewrittenScripts,
      rewrittenScripts,
      (x) => `${x.name}${x.from}${x.to}`,
    ),
    rewrittenWorkflows: unionBy(
      prev.rewrittenWorkflows,
      workflowRewriteRecords(plannedWorkflows),
      (x) => `${x.file}${x.from}${x.to}`,
    ),
    preservedScripts: unionBy(prev.preservedScripts, preservedScripts, (x) => x.name),
    keptDeps: unionBy(prev.keptDeps, keptDeps, (x) => x),
  };

  const ops: Array<{ path: string; text: string }> = [
    { path: pkgPath, text: `${JSON.stringify(pkg, null, 2)}\n` },
    ...plannedWorkflows.map((w) => ({ path: w.path, text: w.text })),
    { path: marker, text: `${JSON.stringify(payload, null, 2)}\n` },
  ];
  return {
    root,
    ops,
    result: {
      root: relative(process.cwd(), root) || ".",
      removedDeps: payload.removedDeps,
      rewrittenScripts: payload.rewrittenScripts,
      rewrittenWorkflows: payload.rewrittenWorkflows,
      marker: relative(process.cwd(), marker),
      preservedScripts: payload.preservedScripts,
    },
  };
}

/** 提交一组退役计划（全批原子：任一写失败 ⇒ 整批回滚，不留半完成状态） */
function commitRetirePlans(root: string, plans: RetirePlan[]): void {
  // 目录先建：建不出来 ⇒ 尚未落任何盘（不得「半个仓库已经改了」）
  for (const p of plans) mkdirSync(join(p.root, ".nudo"), { recursive: true });
  commitWriteSet(root, plans.flatMap((p) => p.ops));
  // 提交成功：清掉可能残留的 in-progress 标记
  for (const p of plans) {
    const retiring = join(p.root, ".nudo", "migrate-retiring.json");
    if (existsSync(retiring)) rmSync(retiring, { force: true });
  }
}

export function migrateRetire(
  rootDir: string,
  opts: { dryRun?: boolean; workflows?: boolean } = {},
): RetireResult {
  const root = resolveMigrateRoot(rootDir);
  const plan = planRetirePackage(root, opts);
  if (!opts.dryRun) commitRetirePlans(root, [plan]);
  return plan.result;
}

/**
 * 多目标退役：**全退役或全报错**（不得静默只处理第一个）。
 * 任一目标失败 ⇒ 整批不落盘。
 *
 * 错误消息**点名全部失败目标**（旧实现只带**第一个**失败目标 ⇒ 其余失败目标
 * **丢失**：用户以为只有一个包有问题）。原子性**不变**：任一失败 ⇒ 整批零写盘
 * （抛错发生在 `commitRetirePlans` **之前**）。
 */
export function migrateRetireMany(
  rootDirs: string[],
  opts: { dryRun?: boolean; workflows?: boolean } = {},
): RetireResult[] {
  if (rootDirs.length === 0) return [];
  const plans: RetirePlan[] = [];
  const failures: RetireFailure[] = [];
  for (const dir of rootDirs) {
    const root = resolveMigrateRoot(dir);
    try {
      plans.push(planRetirePackage(root, opts));
    } catch (err) {
      // **不立即抛**：先把所有目标都计划一遍（计划是只读的、不落盘）⇒ 错误消息
      // 能列出**全部**失败目标，而不是只报第一个。
      failures.push({ target: dir, message: (err as Error).message });
    }
  }
  if (failures.length > 0) throw retireBatchError(failures);
  if (!opts.dryRun) commitRetirePlans(plans[0]!.root, plans);
  return plans.map((p) => p.result);
}

/** monorepo 批量：对仍带 tsc/typescript 的 workspace 包逐个 retire（**全批原子**） */
export function migrateRetireAll(
  rootDir: string,
  opts: { dryRun?: boolean; workflows?: boolean } = {},
): RetireResult[] {
  const root = resolveMigrateRoot(rootDir);
  const plans: RetirePlan[] = [];
  const { roots, excluded } = packageRoots(root);
  const excludedList = excludedPackages(excluded);
  for (const r of roots) {
    // Bug 588（retire --all 侧）：畸形清单**静默跳过** ⇒ 该包被当成「没有
    // tsc/typescript」⇒ 假绿。解析失败要显式报错（fail-closed）。
    const read = readPackageJsonDetailed(join(r, "package.json"));
    if (read.kind === "invalid") {
      throw new Error(`package.json parse failed: ${read.error} (package: ${r})`);
    }
    if (read.kind === "unreadable") {
      throw new Error(`package.json unreadable: ${read.error} (package: ${r})`);
    }
    if (read.kind === "missing") continue;
    const pkg = read.value;
    const surface = retireSurface(pkg, r);
    const keepTypescript = surface.compilerScripts.length > 0;
    const depRemovable = surface.hasTypescriptDep && !keepTypescript;
    // 没有可摘的依赖、没有门禁角色 tsc ⇒ 不注入、不写标记
    if (!depRemovable && surface.gateScripts.length === 0) continue;
    plans.push(planRetirePackage(r, opts));
  }
  if (plans.length === 0) return [];
  // 排除清单（机器面）：同一批结果的每一条都带同一份（无排除 ⇒ 不出现）
  if (excludedList) {
    for (const p of plans) p.result.excluded = [...excludedList];
  }
  if (!opts.dryRun) {
    try {
      commitRetirePlans(root, plans);
    } catch (err) {
      throw new Error(
        `retire batch aborted: ${(err as Error).message} (no package was modified; packages: ${plans
          .map((p) => p.result.root)
          .join(", ")})`,
      );
    }
  }
  return plans.map((p) => p.result);
}

export function formatStatusTable(rows: MigrateStatusRow[]): string {
  const lines: string[] = [];
  lines.push("migrate status");
  lines.push("");
  for (const r of rows) {
    lines.push(
      `  ${r.root}${r.retired ? "  [retired]" : r.retiring ? "  [retiring: partial]" : ""}`,
    );
    lines.push(
      `    ts files: ${r.tsFiles}  tsx: ${r.tsxFiles}  tsconfig: ${r.tsconfig ? "yes" : "no"}  typescript dep: ${r.typescriptDep ? "yes" : "no"}`,
    );
    if (r.packageJsonError) lines.push(`    ${r.packageJsonError}`);
    if (r.tscScripts.length > 0) lines.push(`    tsc scripts: ${r.tscScripts.join(", ")}`);
    if (r.nudoScripts.length > 0) lines.push(`    nudo scripts: ${r.nudoScripts.join(", ")}`);
    // 占位符「—」不是 blocker：过滤后再汇总（不得混进逗号串当成一条待办）
    const blockers = r.blockers.filter((b) => b.trim() !== "" && b.trim() !== "—");
    if (blockers.length > 0) {
      lines.push(`    blockers: ${blockers.join("; ")}`);
    }
    lines.push("");
  }
  lines.push("next: nudo migrate strip <path>  →  verify  →  retire <pkg>");
  return lines.join("\n");
}
