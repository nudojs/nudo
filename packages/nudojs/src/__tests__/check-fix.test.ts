/**
 * #69：`nudo check --fix` 批量通道（默认 dry-run）。
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "..", "dist", "index.js");

function runCli(args: string[], cwd: string) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("check --fix", () => {
  it("dry-run prints a fix plan without writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fix-"));
    const file = join(dir, "helper.js");
    writeFileSync(
      file,
      `export function staticName(node) {
  return node.type;
}
`,
      "utf-8",
    );
    const r = runCli(["check", file, "--fix"], dir);
    const out = r.stdout + r.stderr;
    expect(out).toContain("check --fix");
    expect(out).toMatch(/dry-run|planned/);
    // 未 --write：源文件不变，侧车不落盘
    expect(readFileSync(file, "utf-8")).not.toContain("@nudo:throws");
    expect(existsSync(join(dir, "helper.nudo.js"))).toBe(false);
  });

  it("--write applies one fix per issue (sidecar, not @nudo:throws)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fix-w-"));
    const file = join(dir, "helper.js");
    writeFileSync(
      file,
      `export function staticName(node) {
  return node.type;
}
`,
      "utf-8",
    );
    const r = runCli(["check", file, "--fix", "--write", "--only", "nudo:entry-may-throw"], dir);
    const out = r.stdout + r.stderr;
    expect(out).toContain("check --fix");
    const next = readFileSync(file, "utf-8");
    // silence 动作不得自动落地：@nudo:throws 是声明 fail-fast，不是修复
    expect(next).not.toContain("@nudo:throws");
    expect(next).toContain("staticName");
    // fix 优先落在侧车 param contract
    const sidecar = join(dir, "helper.nudo.js");
    if (existsSync(sidecar)) {
      const sc = readFileSync(sidecar, "utf-8");
      expect(sc).toContain("staticName");
      expect(sc).toContain("fn(");
    }
  });

  it("does not dual-write draft sidecar and @nudo:throws on the same issue", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-fix-dual-"));
    const file = join(dir, "helper.js");
    writeFileSync(
      file,
      `export function staticName(node) {
  return node.type === "x" ? node.name : null;
}
`,
      "utf-8",
    );
    const r = runCli(["check", file, "--fix", "--write", "--only", "nudo:entry-may-throw"], dir);
    const out = r.stdout + r.stderr;
    expect(out).toContain("check --fix");
    const next = readFileSync(file, "utf-8");
    expect(next).not.toContain("@nudo:throws");
    const sidecarPath = join(dir, "helper.nudo.js");
    expect(existsSync(sidecarPath)).toBe(true);
    const sc = readFileSync(sidecarPath, "utf-8");
    // 不得出现空 shape 塌签名
    expect(sc).not.toContain("shape({})");
    expect(sc).not.toContain("shape({ })");
  });
});
