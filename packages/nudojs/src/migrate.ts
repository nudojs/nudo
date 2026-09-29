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
import { dirname, extname, join, relative, resolve } from "node:path";
import { generate } from "@babel/generator";
import { parseSource, stripTypes, sidecarPathOf } from "@nudojs/core";
import { draftInterface } from "@nudojs/service/emit";

export type MigrateStatusRow = {
  root: string;
  packageJson: boolean;
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
};

export type StripResult = {
  file: string;
  outFile: string;
  sidecarDraft?: string;
  notes: string[];
};

export type VerifyResult = {
  file: string;
  nudoOk: boolean;
  nudoSummary: string;
  tsc?: { ok: boolean; output: string };
};

export type RetireResult = {
  root: string;
  removedDeps: string[];
  rewrittenScripts: Array<{ name: string; from: string; to: string }>;
  rewrittenWorkflows: Array<{ file: string; from: string; to: string }>;
  marker: string;
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
  if (!existsSync(path)) return { path, kind: "missing" };
  try {
    if (statSync(path).isFile()) {
      return { path, kind: "file", content: readFileSync(path, "utf-8") };
    }
    return { path, kind: "other" };
  } catch {
    return { path, kind: "other" };
  }
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
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".nudo") {
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
 * 排除模式（`!…`）原样返回，由调用方决定是否跳过。
 */
function parsePnpmWorkspacePackages(root: string): string[] {
  const yamlPath = join(root, "pnpm-workspace.yaml");
  if (!existsSync(yamlPath)) return [];
  let text: string;
  try {
    text = readFileSync(yamlPath, "utf-8");
  } catch {
    return [];
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

function packageRoots(root: string): string[] {
  const patterns: string[] = [];
  const pkg = readJson(join(root, "package.json"));
  const workspaces = pkg?.workspaces;
  if (Array.isArray(workspaces)) {
    for (const w of workspaces) {
      if (typeof w === "string") patterns.push(w);
    }
  }
  patterns.push(...parsePnpmWorkspacePackages(root));

  const roots = [root];
  const seen = new Set<string>([root]);
  for (const w of patterns) {
    // pnpm 排除模式（`!…`）不新增根；最小解析不做排除匹配
    if (w.startsWith("!")) continue;
    // support "packages/*" style
    if (w.endsWith("/*") || w.endsWith("/**")) {
      const base = join(root, w.replace(/\/\*\*?$/, ""));
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        const p = join(base, name);
        if (!existsSync(join(p, "package.json"))) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        roots.push(p);
      }
    } else {
      const p = join(root, w);
      if (!existsSync(join(p, "package.json"))) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      roots.push(p);
    }
  }
  return roots;
}

/** 声明文件（.d.ts / .d.mts / .d.cts）不是可 strip 的实现源 */
const DTS_RE = /\.d\.(m|c)?ts$/i;

function isDeclarationFile(file: string): boolean {
  return DTS_RE.test(file);
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

/** shell 元字符：tsc 命令短语在此结束 */
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

/** tsc 命令词：可带 runner 前缀；argv 由调用方按短语消费 */
const TSC_CMD_SRC = `(?<![\\w./-])(?:${TSC_RUNNER_PREFIX_SRC})?tsc(?=$|[\\s;&|<>()])`;
const TSC_CMD_STICKY = new RegExp(TSC_CMD_SRC, "y");

/**
 * 从 tsc argv 抽出项目路径（-p / --project / -b / --build 的首个位置参数）。
 * tsconfig 文件 → 其所在目录；目录原样。无路径 → "."。
 */
function projectPathFromTscArgv(cmd: string, start: number): string {
  const argvEnd = consumeTscArgv(cmd, start);
  const raw = cmd.slice(start, argvEnd);
  // 按空白切词，保留引号内容（粗切即可：路径通常无空格；有引号时去壳）
  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i]!)) {
      i++;
      continue;
    }
    if (raw[i] === "'" || raw[i] === '"' || raw[i] === "`") {
      const q = raw[i]!;
      i++;
      let tok = "";
      while (i < raw.length && raw[i] !== q) {
        if (raw[i] === "\\" && i + 1 < raw.length) {
          tok += raw[i + 1];
          i += 2;
          continue;
        }
        tok += raw[i];
        i++;
      }
      i++; // 闭合引号
      tokens.push(tok);
      continue;
    }
    let tok = "";
    while (i < raw.length && !/\s/.test(raw[i]!) && !"'\"`".includes(raw[i]!)) {
      tok += raw[i];
      i++;
    }
    tokens.push(tok);
  }

  let projectPath: string | null = null;
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!;
    if (tok === "-p" || tok === "--project") {
      projectPath = tokens[t + 1] ?? null;
      break;
    }
    if (tok.startsWith("--project=")) {
      projectPath = tok.slice("--project=".length);
      break;
    }
    if (tok === "-b" || tok === "--build") {
      // -b [project…]：取首个非旗标参数；裸 -b → "."
      const next = tokens[t + 1];
      projectPath = next !== undefined && !next.startsWith("-") ? next : ".";
      break;
    }
  }
  if (projectPath === null || projectPath === "") return ".";
  // tsconfig 文件 → 目录（nudo check 吃源码路径，不解析 tsconfig）
  if (/\.json$/i.test(projectPath)) {
    const dir = dirname(projectPath);
    return dir === "" ? "." : dir;
  }
  return projectPath;
}

/**
 * 消费 tsc argv 直到 shell 元字符。旗标（含未知旗标）与位置参数一并剥离——
 * 项目路径由 projectPathFromTscArgv 另行抽出，映射为 `nudo check <path>`。
 */
function consumeTscArgv(cmd: string, start: number): number {
  let i = start;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    if (isPhraseBoundary(c)) break;
    if (c === "#" && (i === 0 || /\s/.test(cmd[i - 1]!))) break;
    if (c === "'" || c === '"' || c === "`") {
      i = skipShellQuoted(cmd, i);
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    i++;
  }
  // 不吞短语后的空白：保留 ` && ` / ` # 注释` 结构
  while (i > start && /\s/.test(cmd[i - 1]!)) i--;
  return i;
}

/**
 * 以「命令短语」为单位改写 tsc：前缀白名单 + tsc + argv。
 * 字符串/注释里的 tsc 是文本，不是编译器调用。
 */
function rewriteTscPhrases(cmd: string): string {
  let out = "";
  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const start = i;
      i = skipShellQuoted(cmd, i);
      out += cmd.slice(start, i);
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(cmd[i - 1]!))) {
      const start = i;
      while (i < n && cmd[i] !== "\n") i++;
      out += cmd.slice(start, i);
      continue;
    }
    if (c === "\\") {
      out += cmd.slice(i, i + 2);
      i += 2;
      continue;
    }
    TSC_CMD_STICKY.lastIndex = i;
    const m = TSC_CMD_STICKY.exec(cmd);
    if (m) {
      const argvStart = i + m[0].length;
      const projectPath = projectPathFromTscArgv(cmd, argvStart);
      const target = projectPath === "." ? "." : projectPath;
      // 路径含空格时加引号，避免拆词
      const quoted = /\s/.test(target) ? JSON.stringify(target) : target;
      out += (m[0] === "tsc" ? "nudo check " : "npx nudojs check ") + quoted;
      i = consumeTscArgv(cmd, argvStart);
      continue;
    }
    out += c;
    i++;
  }
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
function looksLikeTscCommand(line: string): boolean {
  if (/^\s*#/.test(line)) return false;
  if (/^\s*-?\s*name\s*:/.test(line)) return false;
  if (/^\s*if\s*:/.test(line)) return false;
  // 字符串/注释里的 tsc 不算
  return new RegExp(TSC_CMD_SRC).test(maskShellStringsAndComments(line));
}

export function rewriteWorkflowText(text: string): {
  text: string;
  changes: Array<{ from: string; to: string }>;
} {
  const lines = text.split("\n");
  const changes: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!looksLikeTscCommand(line)) continue;
    // 改写 run: 后的命令，或已是命令形态的整行
    const run = line.match(/^(\s*-?\s*run:\s*)(.*)$/);
    const target = run ? run[2]! : line;
    const { cmd, changed } = rewriteTscCommand(target);
    if (!changed) continue;
    changes.push({ from: target.trim(), to: cmd.trim() });
    lines[i] = run ? run[1]! + cmd : cmd;
  }
  return { text: lines.join("\n"), changes };
}

/** 自 package 根向上找 `.github/workflows`（monorepo 根） */
export function findWorkflowDir(from: string): string | undefined {
  let cur = resolve(from);
  for (let i = 0; i < 6; i++) {
    const wf = join(cur, ".github", "workflows");
    if (existsSync(wf) && statSync(wf).isDirectory()) return wf;
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
    for (const line of text.split("\n")) {
      if (looksLikeTscCommand(line) && rewriteTscCommand(line).changed) {
        out.push({ file: relative(process.cwd(), p), line: line.trim() });
      }
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

export function migrateStatus(rootDir: string): MigrateStatusRow[] {
  const root = resolveMigrateRoot(rootDir);
  const roots = packageRoots(root);
  const workflowHits = listWorkflowTscLines(root);
  const rows: MigrateStatusRow[] = [];
  for (const r of roots) {
    const pkgPath = join(r, "package.json");
    const pkg = readJson(pkgPath);
    const files = listFiles(r);
    // .d.ts/.d.mts/.d.cts 是声明 stub（retire 时删除/保留 ambient），不是可 strip 源
    const tsFiles = files.filter((f) => TS_EXT.has(extname(f).toLowerCase()) && !isDeclarationFile(f)).length;
    const tsxFiles = files.filter((f) => TSX_EXT.has(extname(f).toLowerCase())).length;
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    // 脚本是 shell 命令：字符串里的 tsc 不算
    const tscScripts = Object.entries(scripts)
      .filter(([, cmd]) => /\btsc\b/.test(maskShellStringsAndComments(cmd)))
      .map(([name]) => name);
    const nudoScripts = Object.entries(scripts)
      .filter(([, cmd]) => /\bnudo\b/.test(maskShellStringsAndComments(cmd)))
      .map(([name]) => name);
    const deps = {
      ...((pkg?.dependencies ?? {}) as Record<string, string>),
      ...((pkg?.devDependencies ?? {}) as Record<string, string>),
    };
    // 占位目录不算 retired——marker 必须是普通文件
    const markerPath = join(r, ".nudo", "migrate-retired.json");
    const retired = existsSync(markerPath) && statSync(markerPath).isFile();
    const retiringPath = join(r, ".nudo", "migrate-retiring.json");
    const retiring =
      !retired && existsSync(retiringPath) && statSync(retiringPath).isFile();
    const blockers: string[] = [];
    if (retiring) {
      blockers.push(
        "partial migrate retire (migrate-retiring.json) — re-run nudo migrate retire",
      );
    }
    if (tsxFiles > 0) blockers.push(`${tsxFiles} .tsx (JSX migrate is manual/later)`);
    if (tsFiles > 0 && tscScripts.length > 0) blockers.push("tsc still in scripts");
    if (tsFiles > 0 && !nudoScripts.some((s) => /check|test/.test(s))) {
      blockers.push("no nudo check/test script yet");
    }
    if (deps.typescript) blockers.push("typescript still in dependencies");
    if (workflowHits.length > 0) {
      blockers.push(`${workflowHits.length} tsc line(s) in .github/workflows`);
    }
    if (tsFiles === 0 && tsxFiles === 0 && !deps.typescript && tscScripts.length === 0) {
      blockers.push("—");
    }
    rows.push({
      root: relative(process.cwd(), r) || ".",
      packageJson: existsSync(pkgPath),
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
    });
  }
  return rows;
}

/** TS 源 → 纯 JS 源（Nudo strip 语义；enum 删除见 strip-types 注释）。 */
export function stripTsToJs(source: string): { code: string; notes: string[] } {
  const notes: string[] = [];
  if (/\benum\s+[A-Za-z_$]/.test(source)) {
    notes.push("contains enum — strip removes it (runtime semantics lost); convert to const object first");
  }
  if (/namespace\s+[A-Za-z_$]/.test(source)) {
    notes.push("contains namespace — non-declare namespaces keep TS nodes and may not print cleanly");
  }
  const ast = parseSource(source, { keepTs: true });
  stripTypes(ast);
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

export async function migrateStrip(
  paths: string[],
  opts: { write?: boolean; draft?: boolean; backup?: boolean } = {},
): Promise<StripResult[]> {
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      throw new Error(`not found: ${p}`);
    }
    if (statSync(abs).isDirectory()) {
      for (const f of listFiles(abs)) {
        if (isStripSource(f)) files.push(f);
      }
    } else {
      // 显式路径同样过扩展名门：非 TS / .d.* 声明是用法错误（不静默跳过）
      if (!isStripSource(abs)) {
        throw new Error(
          `not a TypeScript source (need .ts/.mts/.cts/.tsx, not .d.ts decls or .js): ${p}`,
        );
      }
      files.push(abs);
    }
  }
  const results: StripResult[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const { code, notes } = stripTsToJs(source);
    const ext = extname(file).toLowerCase();
    const outFile = TSX_EXT.has(ext)
      ? file.replace(/\.tsx$/i, ".jsx")
      : file.replace(/\.tsx$/i, ".js").replace(/\.mts$/i, ".mjs").replace(/\.cts$/i, ".cjs").replace(/\.ts$/i, ".js");
    // 防御：映射不变（outFile==源）且源不是 TS 实现时禁止原地覆盖 JS
    const wouldClobberNonTs = outFile === file && !isStripSource(file);
    if (opts.write && !wouldClobberNonTs) {
      if (opts.backup && existsSync(file) && !existsSync(`${file}.bak`)) {
        renameSync(file, `${file}.bak`);
      } else if (opts.backup !== true && existsSync(file) && extname(file).toLowerCase() !== extname(outFile).toLowerCase()) {
        // default: keep .ts in place as .ts.bak only when --backup; else leave source
      }
      writeFileSync(outFile, code, "utf-8");
    }
    let sidecarDraft: string | undefined;
    if (opts.draft !== false && opts.write) {
      try {
        const draft = await draftInterface(outFile, { source: code, bodyAccesses: true });
        if (draft.draftSource && draft.draftSource.trim().length > 0) {
          const sc = sidecarPathOf(outFile);
          if (!existsSync(sc)) {
            mkdirSync(dirname(sc), { recursive: true });
            writeFileSync(sc, draft.draftSource, "utf-8");
            sidecarDraft = sc;
          }
        }
      } catch {
        /* optional: draft is best-effort — migrate continues without sidecar */
      }
    }
    results.push({
      file: relative(process.cwd(), file),
      outFile: relative(process.cwd(), outFile),
      ...(sidecarDraft ? { sidecarDraft: relative(process.cwd(), sidecarDraft) } : {}),
      notes,
    });
  }
  return results;
}

function runTscBaseline(root: string, files: string[]): { ok: boolean; output: string } {
  try {
    const out = execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--pretty", "false", "--skipLibCheck", ...files],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ""}${err.stderr ?? err.message ?? ""}`.trim(),
    };
  }
}

export async function migrateVerify(
  paths: string[],
  opts: { withTsc?: boolean; root?: string } = {},
): Promise<VerifyResult[]> {
  const { checkSource, formatCheckReport, pTrue } = await import("@nudojs/core");
  const { defaultLoadModule, findProjectConfig, interfaceConfig, checkConfig } = await import(
    "@nudojs/service"
  );
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      throw new Error(`not found: ${p}`);
    }
    if (statSync(abs).isDirectory()) {
      for (const f of listFiles(abs)) {
        const e = extname(f).toLowerCase();
        if (e === ".js" || e === ".mjs" || e === ".cjs" || TS_EXT.has(e) || TSX_EXT.has(e)) {
          files.push(f);
        }
      }
    } else {
      files.push(abs);
    }
  }
  const results: VerifyResult[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const proj = findProjectConfig(dirname(file));
    const cCfg = checkConfig(proj?.config);
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const report = checkSource(file, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: file,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      entryThrows: cCfg.entryThrows,
      ...(cCfg.ignoreThrows && cCfg.ignoreThrows.length > 0
        ? { ignoreThrows: cCfg.ignoreThrows }
        : {}),
    });
    const summary = `${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.functions} fn`;
    const row: VerifyResult = {
      file: relative(process.cwd(), file),
      nudoOk: report.ok,
      nudoSummary: summary,
    };
    if (opts.withTsc) {
      // 迁移期对照：仅对 .ts 跑 tsc 基线；.js 无注解则跳过
      if (TS_EXT.has(extname(file).toLowerCase()) || TSX_EXT.has(extname(file).toLowerCase())) {
        row.tsc = runTscBaseline(opts.root ?? process.cwd(), [file]);
      }
    }
    if (!report.ok) {
      // print human report so verify is actionable
      console.log(formatCheckReport(report));
    }
    results.push(row);
  }
  return results;
}

export function migrateRetire(
  rootDir: string,
  opts: { dryRun?: boolean; workflows?: boolean } = {},
): RetireResult {
  const root = resolveMigrateRoot(rootDir);
  const pkgPath = join(root, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) throw new Error(`no package.json under ${rootDir}`);
  const removedDeps: string[] = [];
  const rewrittenScripts: Array<{ name: string; from: string; to: string }> = [];

  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const bag = pkg[field] as Record<string, string> | undefined;
    if (bag?.typescript) {
      delete bag.typescript;
      removedDeps.push(field);
    }
  }

  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!/\btsc\b/.test(maskShellStringsAndComments(cmd))) continue;
    const { cmd: next } = rewriteTscCommand(cmd);
    // package.json scripts 用本地 bin 名（任意 check 路径，不只 "."）
    const local = next.replace(/npx nudojs check /g, "nudo check ");
    if (local !== cmd) {
      rewrittenScripts.push({ name, from: cmd, to: local });
      scripts[name] = local;
    }
  }
  if (!scripts["check:nudo"] && !Object.values(scripts).some((c) => maskShellStringsAndComments(c).includes("nudo check"))) {
    const to = "nudo check .";
    scripts["check:nudo"] = to;
    rewrittenScripts.push({ name: "check:nudo", from: "(none)", to });
  }

  // A1：CI workflow 里的 tsc 一并退役（默认开；--no-workflows 关）
  // 先只规划不落盘——commit 顺序：package.json → workflows → marker（marker 最后 = 提交点）
  const plannedWorkflows =
    opts.workflows === false ? [] : planWorkflowRewrites(root);

  const markerDir = join(root, ".nudo");
  const marker = join(markerDir, "migrate-retired.json");
  const payload = {
    retiredAt: new Date().toISOString(),
    removedDeps,
    rewrittenScripts,
    rewrittenWorkflows: plannedWorkflows.map((w) => w.file),
  };

  if (!opts.dryRun) {
    const ops: Array<{ path: string; text: string }> = [
      { path: pkgPath, text: `${JSON.stringify(pkg, null, 2)}\n` },
      ...plannedWorkflows.map((w) => ({ path: w.path, text: w.text })),
      { path: marker, text: `${JSON.stringify(payload, null, 2)}\n` },
    ];
    mkdirSync(markerDir, { recursive: true });
    commitWriteSet(root, ops);
    // 提交成功：清掉可能残留的 in-progress 标记
    const retiring = join(markerDir, "migrate-retiring.json");
    if (existsSync(retiring)) rmSync(retiring, { force: true });
  }

  return {
    root: relative(process.cwd(), root) || ".",
    removedDeps,
    rewrittenScripts,
    rewrittenWorkflows: plannedWorkflows.flatMap((w) =>
      w.changes.map((c) => ({ file: w.file, from: c.from, to: c.to })),
    ),
    marker: relative(process.cwd(), marker),
  };
}

/** monorepo 批量：对仍带 tsc/typescript 的 workspace 包逐个 retire（A1） */
export function migrateRetireAll(
  rootDir: string,
  opts: { dryRun?: boolean; workflows?: boolean } = {},
): RetireResult[] {
  const root = resolveMigrateRoot(rootDir);
  const roots = packageRoots(root);
  const results: RetireResult[] = [];
  let workflowsDone = false;
  for (const r of roots) {
    const pkg = readJson(join(r, "package.json"));
    if (!pkg) continue;
    const deps = {
      ...((pkg.dependencies ?? {}) as Record<string, string>),
      ...((pkg.devDependencies ?? {}) as Record<string, string>),
    };
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const hasTsc =
      Boolean(deps.typescript) ||
      Object.values(scripts).some((c) => /\btsc\b/.test(maskShellStringsAndComments(c)));
    if (!hasTsc) continue;
    // workflow 只改写一次（monorepo 根共享 .github）
    const doWf = opts.workflows !== false && !workflowsDone;
    const result = migrateRetire(r, {
      dryRun: opts.dryRun === true,
      workflows: doWf,
    });
    if (result.rewrittenWorkflows.length > 0) workflowsDone = true;
    results.push(result);
  }
  return results;
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
    if (r.tscScripts.length > 0) lines.push(`    tsc scripts: ${r.tscScripts.join(", ")}`);
    if (r.nudoScripts.length > 0) lines.push(`    nudo scripts: ${r.nudoScripts.join(", ")}`);
    if (r.blockers.length > 0 && r.blockers[0] !== "—") {
      lines.push(`    blockers: ${r.blockers.join("; ")}`);
    }
    lines.push("");
  }
  lines.push("next: nudo migrate strip <path>  →  verify  →  retire <pkg>");
  return lines.join("\n");
}
