/**
 * BUG-023：export 路径 / IO 错误面（PathError）。
 * export 是唯一完全绕开 PathError 面的主命令——
 * 输入不存在 → ENOENT 原文带绝对路径进 CI 日志；
 * --out IO 失败同样裸抛。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), cliEntry, ...args],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
    },
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

const CASE_FIXTURE = `export function scale(x) {
  // @nudo:case scale(1) => 2
  return x + 1;
}
`;

describe("BUG-023: export 路径 / IO 错误面", () => {
  it("missing input → nudo:path-not-found face (no ENOENT / raw errno), exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-pe-"));
    const r = runCli(["export", join(dir, "nope.js")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found");
    expect(r.stderr).toContain("fix:");
    // 原始 errno 面不得进产品日志
    expect(r.stderr).not.toContain("ENOENT");
    expect(r.stderr).not.toMatch(/\bError:/);
  });

  it("non-target input (.nudo.js sidecar) → nudo:path-not-target face, exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-nt-"));
    const sidecar = join(dir, "scale.nudo.js");
    writeFileSync(sidecar, `export {};\n`, "utf-8");
    const r = runCli(["export", sidecar]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not an analysis target");
    expect(r.stderr).toContain("fix:");
  });

  it("--out IO failure → nudo:path-io face (no raw errno), exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-io-"));
    const file = join(dir, "scale.js");
    writeFileSync(file, CASE_FIXTURE, "utf-8");
    // --out 指向文件内部路径 → mkdir ENOTDIR
    const r = runCli(["export", file, "--format", "schema", "--out", join(file, "sub")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out mkdir failed");
    expect(r.stderr).toContain("fix:");
    expect(r.stderr).not.toContain("ENOTDIR");
    expect(r.stderr).not.toContain("EACCES");
  });

  it("multi-file directory input → explicit single-file usage error (old: EISDIR raw)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-dir-"));
    writeFileSync(join(dir, "scale.js"), CASE_FIXTURE, "utf-8");
    writeFileSync(join(dir, "other.js"), CASE_FIXTURE, "utf-8");
    const r = runCli(["export", dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export takes exactly one analysis file");
    expect(r.stderr).toContain("fix:");
    expect(r.stderr).not.toContain("EISDIR");
  });

  it("happy path still projects (stdout) with exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-ok-"));
    const file = join(dir, "scale.js");
    writeFileSync(file, CASE_FIXTURE, "utf-8");
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("scale");
  });
});
