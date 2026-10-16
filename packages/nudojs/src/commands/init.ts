/**
 * nudo init — 写入 adoption 基线配置（#8）。
 *
 * `nudo init [path]`：从 path（默认 cwd）向上找最近 package.json，
 * 无 `nudo` 键时合并写入 `"nudo": { "check": { "profile": "adoption" } }`
 * （保留既有键序，stringify(…, null, 2) + 末尾换行）；已有键则幂等
 * 打印现状（exit 0，不写盘）。找不到 package.json / package.json 非
 * 法 JSON → usage error exit 1，不写盘。
 *
 * runInit 与 commander 解耦（返回退出码），测试可进程内直驱。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  if (existsSync(dir) && !statSync(dir).isDirectory()) dir = dirname(dir);
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * init 主体：返回进程退出码（0 = 成功/幂等，1 = usage error）。
 * 只在「无 nudo 键且 JSON 合法」这一条路径写盘。
 */
export function runInit(startPath: string, io: InitIo = defaultIo): number {
  const pkgPath = findPackageJsonUp(startPath);
  if (!pkgPath) {
    io.err(`error: no package.json found (searched upward from ${displayPathOf(resolve(startPath))})`);
    io.err("fix:  run `nudo init` inside a package directory (a folder with a package.json)");
    return 1;
  }
  const display = displayPathOf(pkgPath);
  let raw: string;
  let parsed: unknown;
  try {
    raw = readFileSync(pkgPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch (err) {
    io.err(`error: ${display} is not valid JSON — nothing written`);
    io.err(`fix:  repair it first (parse error: ${err instanceof Error ? err.message : String(err)})`);
    return 1;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    io.err(`error: ${display} does not contain a JSON object — nothing written`);
    return 1;
  }
  const pkg = parsed as Record<string, unknown>;
  if ("nudo" in pkg) {
    io.out(`${display} already has a nudo config — nothing written.`);
    io.out("");
    io.out(JSON.stringify({ nudo: pkg.nudo }, null, 2));
    return 0;
  }
  pkg.nudo = ADOPTION_BASELINE;
  const content = `${JSON.stringify(pkg, null, 2)}\n`;
  writeFileSync(pkgPath, content);
  io.out(`nudo init: wrote adoption baseline to ${display}`);
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
