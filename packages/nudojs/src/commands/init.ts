/**
 * nudo init — 写入 adoption 基线配置（#8）。
 *
 * `nudo init [path]`：从 path（默认 cwd）向上找最近 package.json，
 * **该包没有有效 nudo 配置**时把 `"nudo": { "check": { "profile": "adoption" } }`
 * 写进去（最小改动：只插入/替换目标键，其余字节逐字保留）；已有**有效**
 * nudo 配置则幂等打印现状（exit 0，不写盘）。
 *
 * 三条边界（本文件的所有权范围，族 21 C5）：
 * - **幂等判据 = 配置加载器的真值判据**（Bug 676）：真源是
 *   `packages/service/src/evaluator/config.ts` 的 `readNudoKey` ——
 *   `nudo` 键存在（自有属性）**且**值是「非 null 的非数组对象」才算
 *   **有效配置**；键存在但形状非法（null / 标量 / 数组）⇒ 该包
 *   **没有**配置（加载器给 stderr 提示后按「无配置」处理，且**不继承**
 *   祖先配置）⇒ init 视为「无配置」，写入基线。
 * - **作用域不外溢**（Bug 677 / 678）：① 目标包若**继承**祖先的 nudo
 *   配置，写入自己的 `nudo` 键会**遮蔽**祖先（加载器取「最近的有 nudo
 *   键的 package.json」）⇒ 拒绝写盘并说明；② 最近�� package.json 若是
 *   **workspace / 容器根**，往那里写等于给整仓改门禁档 ⇒ 拒绝写盘。
 * - **继承口径 = 加载器口径**（Bug 1144）：① 只有**本包没有 `nudo` 键**
 *   时才谈得上「继承祖先」——本包的 `nudo` 键存在但形状非法时，加载器
 *   按「无配置」处理且**不继承**祖先 ⇒ 此时不得以「it inherits」拒绝
 *   （那是假话，且让用户无法自行修复该值 ⇒ 死锁），按文档**以基线替换
 *   并告警**；② 用户**显式**指向容器根 ⇒ 照写并说清作用域（只有「从
 *   子目录越界写」才拒绝）。
 * - **IO 失败可区分**（Bug 680）：读失败（EACCES…）与「不是合法 JSON」
 *   是两条不同的错误面；写失败不再冒泡成裸 errno，而是 `error:` / `fix:`
 *   引导 + 非零 exit。
 *
 * runInit 与 commander 解耦（返回退出码），测试可进程内直驱。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { displayPathOf } from "./shared.ts";

/** init 写入的 adoption 基线（profile: L2 entry may-throw → warning，L1 不变） */
const ADOPTION_BASELINE = { check: { profile: "adoption" } } as const;

/** 输出面注入（测试捕获 stdout/stderr；默认走 console） */
export type InitIo = {
  out: (line: string) => void;
  err: (line: string) => void;
};

const defaultIo: InitIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/**
 * 从 start（目录或文件）向上找最近 package.json。
 * 找不到返回 null；路径不存在按目录处理（沿父目录链继续）。
 */
export function findPackageJsonUp(start: string): string | null {
  let dir = resolve(start);
  // 单次 stat：miss（ENOENT）→ 按目录继续向上；EACCES/EIO 上抛
  const startStat = statSync(dir, { throwIfNoEntry: false });
  if (startStat && !startStat.isDirectory()) dir = dirname(dir);
  for (;;) {
    const candidate = join(dir, "package.json");
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 起始路径 → 起始目录（文件取其 dirname；不存在的路径按目录处理） */
function startDirOf(startPath: string): string {
  const abs = resolve(startPath);
  let stat: ReturnType<typeof statSync> | undefined;
  try {
    stat = statSync(abs, { throwIfNoEntry: false });
  } catch {
    return abs;
  }
  return stat && !stat.isDirectory() ? dirname(abs) : abs;
}

/** 读 + 解析 package.json；读失败 / 解析失败 / 不是对象都**可区分**（Bug 680） */
type PkgRead =
  | { ok: true; raw: string; pkg: Record<string, unknown> }
  | { ok: false; kind: "unreadable" | "invalid-json" | "not-object"; message: string };

function readPackageJson(pkgPath: string): PkgRead {
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf-8");
  } catch (err) {
    return { ok: false, kind: "unreadable", message: errorText(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, kind: "invalid-json", message: errorText(err) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, kind: "not-object", message: "" };
  }
  return { ok: true, raw, pkg: parsed as Record<string, unknown> };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * package.json#nudo 的读取结果——**与配置加载器同口径**（Bug 676）。
 *
 * 真源：`packages/service/src/evaluator/config.ts` 的 `readNudoKey`：
 * - `present`：自有属性判定（键存在即**截断**祖先查找，#936）
 * - `valid`：值是「非 null 的非数组对象」⇒ **有效配置**（加载器据此返回
 *   配置、抑制 onboarding 引导）；否则（null / 标量 / 数组）⇒ 该包
 *   **没有**配置，且**不继承**祖先配置。
 */
type NudoKeyState = { present: boolean; valid: boolean; value: unknown };

function readNudoKeyState(pkg: Record<string, unknown>): NudoKeyState {
  if (!Object.prototype.hasOwnProperty.call(pkg, "nudo")) {
    return { present: false, valid: false, value: undefined };
  }
  const value = pkg.nudo;
  const valid = value !== null && typeof value === "object" && !Array.isArray(value);
  return { present: true, valid, value };
}

/** 值的人话描述（错误面用） */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/**
 * 目录是否是 **workspace / 容器根**（= 它的 nudo 键会影响其下所有包）。
 *
 * 真源（不自造）：`pnpm-workspace.yaml` / `lerna.json` /
 * `package.json#workspaces`（族 16 的 `packages/nudojs/src/migrate.ts`
 * 判 workspace 根用的也是这三者）。未声明 workspace 的 monorepo
 * （只有 `packages/*` 目录）另用「常规 workspace 目录」兜底。
 */
const WORKSPACE_DIR_NAMES = ["packages", "apps", "libs", "modules", "services"] as const;

function containerSignals(dir: string): string[] {
  const signals: string[] = [];
  if (existsSync(join(dir, "pnpm-workspace.yaml"))) signals.push("pnpm-workspace.yaml");
  if (existsSync(join(dir, "lerna.json"))) signals.push("lerna.json");
  const pkg = readJsonObject(join(dir, "package.json"));
  if (pkg && pkg.workspaces !== undefined) signals.push("package.json#workspaces");
  for (const name of WORKSPACE_DIR_NAMES) {
    const base = join(dir, name);
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(base, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: () => entry.isDirectory(),
      }));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(base, entry.name, "package.json"))) {
        signals.push(`${name}/${entry.name}/package.json`);
        break;
      }
    }
  }
  return signals;
}

/** 读 + 解析一个 package.json；失败（读不到 / 非法 JSON / 非对象）⇒ null */
function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 向上找「最近的有 nudo 键的祖先 package.json」——加载器的查找口径
 * （Bug 677）：
 * - 键**存在**即停（#936：假值键也不继承祖先）；值形状非法 ⇒ 该祖先
 *   **没有**配置且**不继承**更上层 ⇒ 走到这里就没有可继承的配置；
 * - 祖先 package.json 读不到 / 非法 JSON ⇒ fail-closed（不继承）。
 */
function findInheritableAncestorConfig(dir: string): { path: string; value: unknown } | null {
  let cur = dirname(dir);
  for (;;) {
    const pkgPath = join(cur, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = readJsonObject(pkgPath);
      if (!pkg) return null;
      const state = readNudoKeyState(pkg);
      if (state.present) {
        return state.valid ? { path: pkgPath, value: state.value } : null;
      }
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// ---------------------------------------------------------------------------
// 最小改动写盘（Bug 681）：只在原文本上插入 / 替换 `nudo` 键，
// 其余字节**逐字保留**（缩进风格、键序、尾换行都不动）。
// ---------------------------------------------------------------------------

/** 顶层 JSON 成员（位置化） */
type TopMember = {
  key: string;
  /** 值的起点 */
  valueStart: number;
  /** 值的终点（exclusive） */
  valueEnd: number;
  /** 该成员键之前的空白（含换行） */
  lead: string;
};

type TopObjectScan = {
  members: TopMember[];
  /** 顶层对象闭合 `}` 的下标 */
  objectEnd: number;
  /** 冒号后是否有空格（沿用原风格） */
  colonSpace: boolean;
};

/** 跳过 JSON 字符串字面量（i 指向起始引号）⇒ 返回闭合引号之后的下标 */
function skipJsonString(text: string, i: number): number {
  i++;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i++;
  }
  return -1;
}

/** 跳过一个 JSON 值 ⇒ 返回值之后的下标（-1 = 不是合法值） */
function skipJsonValue(text: string, i: number): number {
  const ch = text[i];
  if (ch === '"') return skipJsonString(text, i);
  if (ch === "{" || ch === "[") {
    let depth = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') {
        const next = skipJsonString(text, i);
        if (next < 0) return -1;
        i = next;
        continue;
      }
      if (c === "{" || c === "[") {
        depth++;
        i++;
        continue;
      }
      if (c === "}" || c === "]") {
        depth--;
        i++;
        if (depth === 0) return i;
        continue;
      }
      i++;
    }
    return -1;
  }
  let j = i;
  while (j < text.length && !",}] \t\r\n".includes(text[j]!)) j++;
  return j > i ? j : -1;
}

/** 扫描顶层 JSON 对象的成员位置（不改变原文） */
function scanTopObject(text: string): TopObjectScan | null {
  let i = 0;
  const skipWs = (): void => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  skipWs();
  if (text[i] !== "{") return null;
  i++;
  const members: TopMember[] = [];
  let colonSpace = true;
  let lead = "";
  {
    const wsStart = i;
    skipWs();
    lead = text.slice(wsStart, i);
  }
  for (;;) {
    skipWs();
    if (i >= text.length) return null;
    const c = text[i]!;
    if (c === "}") return { members, objectEnd: i, colonSpace };
    if (c !== '"') return null;
    const keyStart = i;
    const keyEnd = skipJsonString(text, i);
    if (keyEnd < 0) return null;
    let key: string;
    try {
      key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    } catch {
      return null;
    }
    i = keyEnd;
    skipWs();
    if (text[i] !== ":") return null;
    colonSpace = text[i + 1] === " ";
    i++;
    skipWs();
    const valueStart = i;
    const valueEnd = skipJsonValue(text, i);
    if (valueEnd < 0) return null;
    i = valueEnd;
    members.push({ key, valueStart, valueEnd, lead });
    skipWs();
    if (text[i] === ",") {
      i++;
      const wsStart = i;
      skipWs();
      lead = text.slice(wsStart, i);
      continue;
    }
    if (text[i] === "}") return { members, objectEnd: i, colonSpace };
    return null;
  }
}

/** 文件的缩进单位（首个缩进行的前导空白）；紧凑单行文件 ⇒ null */
function detectIndentUnit(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const m = /^([ \t]+)\S/.exec(lines[i]!);
    if (m) return m[1]!;
  }
  return null;
}

/** 顶层成员的缩进（lead 里最后一段换行之后的空白） */
function indentOf(lead: string): string {
  return lead.slice(lead.lastIndexOf("\n") + 1);
}

/**
 * 在原文本上插入 / 替换 `nudo` 键（Bug 681 的最小改动面）。
 *
 * - 已有 `nudo` 键 ⇒ 只替换它的**值**区间（键与其余字节不动）；
 * - 没有 `nudo` 键 ⇒ 在最后一个顶层成员之后、闭合 `}` 之前插入
 *   `,` + 换行 + 原缩进 + `"nudo": …`；
 * - 缩进单位 / 冒号后空格 / 换行风格 / 尾换行状态全部沿用原文件。
 */
function writeNudoKeyMinimally(raw: string, baseline: unknown): string {
  const scan = scanTopObject(raw);
  if (!scan) {
    // 兜底：理论上到不了（调用方已 JSON.parse 成功）⇒ 退回整文件重排
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    pkg.nudo = baseline;
    return `${JSON.stringify(pkg, null, 2)}\n`;
  }
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const unit = detectIndentUnit(raw);
  const compact = unit === null;
  const render = (base: string): string => {
    const text = compact
      ? JSON.stringify(baseline)
      : JSON.stringify(baseline, null, unit as string);
    if (compact) return text;
    return text
      .split("\n")
      .map((line, idx) => (idx === 0 ? line : base + line))
      .join(newline);
  };
  const colonSep = scan.colonSpace ? ": " : ":";
  const key = `"nudo"`;
  const existing = scan.members.find((m) => m.key === "nudo");
  if (existing) {
    const base = indentOf(existing.lead);
    return raw.slice(0, existing.valueStart) + render(base) + raw.slice(existing.valueEnd);
  }
  if (scan.members.length === 0) {
    // 空对象：{} ⇒ {"nudo": …}（不引入逗号）
    const base = compact ? "" : (unit as string);
    return raw.slice(0, scan.objectEnd) + key + colonSep + render(base) + raw.slice(scan.objectEnd);
  }
  const last = scan.members[scan.members.length - 1]!;
  const base = indentOf(last.lead);
  const sep = compact ? "" : newline;
  const insert = `,${sep}${base}${key}${colonSep}${render(base)}`;
  return raw.slice(0, last.valueEnd) + insert + raw.slice(last.valueEnd);
}

/**
 * init 主体：返回进程退出码（0 = 成功/幂等，1 = usage / IO 错误）。
 * 只在「无**有效** nudo 配置且作用域安全」这一条路径写盘。
 */
export function runInit(startPath: string, io: InitIo = defaultIo): number {
  let pkgPath: string | null;
  try {
    pkgPath = findPackageJsonUp(startPath);
  } catch (err) {
    // Bug 680：向上查找本身也可能撞上 IO 错误（EACCES / EIO）⇒ 不冒泡
    io.err(
      `error: cannot read ${displayPathOf(resolve(startPath))} (${errorText(err)}) — nothing written`,
    );
    io.err("fix:  check the path's read permissions, then re-run");
    return 1;
  }
  if (!pkgPath) {
    io.err(`error: no package.json found (searched upward from ${displayPathOf(resolve(startPath))})`);
    io.err("fix:  run `nudo init` inside a package directory (a folder with a package.json)");
    return 1;
  }
  const pkgDir = dirname(pkgPath);
  const display = displayPathOf(pkgPath);
  const read = readPackageJson(pkgPath);
  if (!read.ok) {
    if (read.kind === "unreadable") {
      // Bug 680：读失败 ≠ 不是合法 JSON（两条不同的错误面）
      io.err(`error: cannot read ${display} (${read.message}) — nothing written`);
      io.err("fix:  check the file's read permissions (and that it is a regular file), then re-run");
    } else if (read.kind === "invalid-json") {
      io.err(`error: ${display} is not valid JSON — nothing written`);
      io.err(`fix:  repair it first (parse error: ${read.message})`);
    } else {
      io.err(`error: ${display} does not contain a JSON object — nothing written`);
    }
    return 1;
  }
  const state = readNudoKeyState(read.pkg);
  if (state.valid) {
    // 幂等：**有效**配置在场 ⇒ 只打印现状，不写盘
    io.out(`${display} already has a nudo config — nothing written.`);
    io.out("");
    io.out(JSON.stringify({ nudo: state.value }, null, 2));
    return 0;
  }
  // Bug 678：作用域不外溢——最近的 package.json 是 workspace / 容器根时，
  // 往那里写等于给**整仓**改门禁档（用户以为只初始化了一个包）。
  const signals = containerSignals(pkgDir);
  const startDir = startDirOf(startPath);
  if (signals.length > 0 && startDir !== pkgDir) {
    io.err(
      `error: refusing to write a nudo config into ${display} — it is a workspace / container root (${signals.join(", ")})`,
    );
    io.err(
      `fix:  create a package.json for the package you want to initialize (e.g. ${displayPathOf(join(startDir, "package.json"))}) and re-run \`nudo init <that dir>\``,
    );
    return 1;
  }
  if (signals.length > 0) {
    // 用户**显式**指向容器根 ⇒ 照写，但说清作用域（nudo 键对下层所有包生效）
    io.err(
      `warning: ${display} is a workspace / container root (${signals.join(", ")}) — the nudo config written here applies to every package below it`,
    );
  }
  // Bug 677：祖先已有可继承的 nudo 配置 ⇒ 写入会**遮蔽**它
  // （加载器取「最近的有 nudo 键的 package.json」）⇒ 门禁由红翻绿。
  //
  // ⚠ 只在**本包没有 `nudo` 键**时才算「祖先可继承」（Bug 1144）：
  // 加载器（packages/service/src/evaluator/config.ts 的 findProjectConfig）
  // 在**本包的 `nudo` 键存在但形状非法**时给 stderr 提示后按「无配置」
  // 处理，并**不继承**祖先配置（键存在即截断祖先搜索，#936）⇒ 此时祖先
  // 配置对本包**不可继承**：拿「it inherits」当拒绝理由是**假话**，而且
  // 死锁——文档承诺「无效值以基线替换并告警」，实现却拒绝写盘 ⇒ 用户
  // 无法自行修复该值。本包已有 `nudo` 键（无论有效与否）⇒ 走下面的
  // 「幂等 / 替换基线」分支。
  if (!state.present) {
    const ancestor = findInheritableAncestorConfig(pkgDir);
    if (ancestor) {
      io.err(
        `error: refusing to write a nudo config into ${display} — it inherits a nudo config from ${displayPathOf(ancestor.path)}`,
      );
      io.err(
        `fix:  the inherited config stays visible here; add the "nudo" key to ${display} yourself if this package needs its own config (or drop the nudo key from ${displayPathOf(ancestor.path)})`,
      );
      return 1;
    }
  }
  const content = writeNudoKeyMinimally(read.raw, ADOPTION_BASELINE);
  try {
    writeFileSync(pkgPath, content);
  } catch (err) {
    // Bug 680：写失败不再冒泡成裸 errno
    io.err(`error: cannot write ${display} (${errorText(err)}) — nothing written`);
    io.err("fix:  check the file's write permissions (and that it is a regular file), then re-run");
    return 1;
  }
  if (state.present) {
    // 键存在但形状非法 ⇒ 加载器按「无配置」处理 ⇒ 这里替换成基线
    io.err(
      `warning: ${display} had an invalid "nudo" value (${describeValue(state.value)}) — replaced with the adoption baseline`,
    );
    io.out(`nudo init: wrote adoption baseline to ${display}`);
  } else {
    io.out(`nudo init: wrote adoption baseline to ${display}`);
  }
  io.out("");
  io.out(content.trimEnd());
  io.out("");
  io.out("next steps:");
  io.out("  nudo check .                   run the gate (adoption profile)");
  io.out("  nudo contract --draft <file>   draft a contract from inferred types");
  io.out("  docs                           https://nudojs.github.io/nudo/");
  return 0;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Write an adoption baseline nudo config into package.json")
    .argument("[path]", "Start directory/file (default: current directory); the nearest package.json upward is used")
    .action((path?: string) => {
      process.exitCode = runInit(path ?? process.cwd());
    });
}
