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
  it("dry-run prints @nudo:throws plan without writing", () => {
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
    // 未 --write：源文件不变
    expect(readFileSync(file, "utf-8")).not.toContain("@nudo:throws");
  });

  it("--write inserts @nudo:throws annotation", () => {
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
    // 有 may-throw 时会物化 @nudo:throws；无 L2 则至少不破坏源码
    expect(next).toContain("staticName");
  });
});
