/**
 * `nudo check` 磁盘缓存 miss/hit 渲染对称性（term 注记保真）：
 * CheckJson 只存 formatAbs 全量串（含 `= term` 注记），命中轮若直接用
 * display 回填 NudoSig，签名行会多出 term 注记（`add(...) => number | string
 * = (A1 + A2)`）。修法 = 写盘附带缓存私有 ret（miss 轮渲染出的返回段），
 * 读回消费。本文件钉住 CLI 全链：miss/命中/再命中 三轮输出逐字节一致。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const cli = join(root, "packages/nudojs/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCheck(
  file: string,
  cacheDir: string,
  args: string[] = [],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, "check", file, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      GITHUB_ACTIONS: "false",
      NUDO_CACHE_DIR: cacheDir,
    },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("check disk-cache miss/hit rendering symmetry", () => {
  it("term-annotated signatures are byte-identical across miss/hit/hit rounds", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cache-rt-"));
    const file = join(dir, "term.js");
    writeFileSync(
      file,
      `export function add(a, b) { return a + b; }
export function scale(x) { return x * 2 + 1; }
`,
      "utf8",
    );
    const cache = join(dir, "cache");
    const r1 = runCheck(file, cache);
    const r2 = runCheck(file, cache);
    const r3 = runCheck(file, cache);
    expect(r1.status).toBe(0);
    // miss 轮：签名行是 formatShape 口径（无 `= (A1 + A2)` term 注记）
    expect(r1.stdout).toContain("add(a: any, b: any) => number | string\n");
    expect(r1.stdout).not.toContain("A1");
    expect(r2.stdout).toBe(r1.stdout);
    expect(r3.stdout).toBe(r1.stdout);
    expect(r2.stderr).toBe(r1.stderr);
  });

  it("contract sidecar + warning project stays byte-identical across rounds", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cache-rt2-"));
    const file = join(dir, "math.js");
    writeFileSync(
      file,
      `export function div(a, b) { return a / b; }
export function boom(o) { return o.x.y; }
`,
      "utf8",
    );
    // .nudo.js 契约侧车（参数/返回约束）+ L2 warning（--entry-throws warning）
    writeFileSync(
      join(dir, "math.nudo.js"),
      `import { fn, number } from "@nudojs/core";

export const div = fn({ a: number(), b: number().gt(0) }, number());
`,
      "utf8",
    );
    const cache = join(dir, "cache");
    const args = ["--entry-throws", "warning"];
    const r1 = runCheck(file, cache, args);
    const r2 = runCheck(file, cache, args);
    expect(r1.status).toBe(0);
    expect(r1.stdout).toContain("nudo:entry-may-throw");
    expect(r1.stdout).toContain("div(a: number, b: number) => number\n");
    expect(r2.stdout).toBe(r1.stdout);
    expect(r2.stderr).toBe(r1.stderr);
  });

  it("--json contract face stays byte-identical across rounds (no cache-private fields)", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cache-rt3-"));
    const file = join(dir, "term.js");
    writeFileSync(
      file,
      `export function add(a, b) { return a + b; }
`,
      "utf8",
    );
    const cache = join(dir, "cache");
    const r1 = runCheck(file, cache, ["--json"]);
    const r2 = runCheck(file, cache, ["--json"]);
    expect(r1.status).toBe(0);
    expect(r1.stdout).not.toContain('"ret"');
    expect(r2.stdout).toBe(r1.stdout);
  });
});
