/**
 * Bug 631 — `nudo check --json --gitlab`：GitLab 注解数组被**整段丢弃**
 * （既不进 stdout 也不进 stderr）。
 *
 * 根因（packages/nudojs/src/commands/check-report.ts）：注解分派把 GitLab
 * 挂在 `--json` 的 `else` 上，而 `--json` 路径**恒**置 `jsonCollect`
 * （check-command.ts）⇒ `opts.json && opts.jsonCollect` 永远成立 ⇒
 * `opts.gitlab` 分支永不可达 ⇒ 注解被静默吞掉（CI 面板上该文件的告警消失，
 * 且没有任何提示说这个组合被忽略了）。
 *
 * 修法：两个注解通道（GitLab Code Quality / GHA 行内注解）**并列**，
 * 机器面（--json）两者都只写 stderr —— stdout 是 CheckJson 机器契约，
 * 注解不得混进去（与 --gha 的既有口径同形）。
 *
 * 本文件钉住：
 *  - `--json --gitlab`：stdout 可解析为 CheckJson + stderr 可解析为
 *    Code Quality 数组（`check_name` 字段在位）；
 *  - `--json`（无 --gitlab）：stderr 不含任何注解（不回归泄漏）；
 *  - `--gitlab`（无 --json）：stdout 仍是**恰好一份** Code Quality 数组
 *    （旧口径不变）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 未约束入口 → L2 entry may-throw（error）+ entry-only（info） */
const BAD = `export function staticName(node) {
  return node.type;
}
`;

type CodeQualityRow = {
  check_name: string;
  fingerprint: string;
  severity: string;
  location: { path: string; lines: { begin: number } };
};

/** stderr 里最后一行非空内容（注解以单行 JSON 数组写出） */
function lastJsonLine(stderr: string): unknown {
  const lines = stderr.split("\n").filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!);
}

describe("Bug 631 — check --json --gitlab：GitLab 注解不再被丢弃", () => {
  it("--json --gitlab：stdout 是 CheckJson 契约，stderr 是 Code Quality 数组", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-json-gitlab-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCliTsx(["check", file, "--json", "--gitlab"]);
      // 门禁语义不变：L2 entry may-throw（error）⇒ exit 1
      expect(r.status).toBe(1);

      // stdout：CheckJson 机器契约（可解析，注解不得混进来）
      const envelope = JSON.parse(r.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.issues.map((i: { code: string }) => i.code)).toContain(
        "nudo:entry-may-throw",
      );
      expect(r.stdout).not.toContain("check_name");

      // stderr：GitLab Code Quality 数组（旧实现整段丢失 ⇒ 计数 0）
      const rows = lastJsonLine(r.stderr) as CodeQualityRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r2) => r2.check_name)).toContain("nudo:entry-may-throw");
      for (const row of rows) {
        expect(row.fingerprint).toBeTruthy();
        expect(row.severity).toBeTruthy();
        expect(row.location.lines.begin).toBeGreaterThanOrEqual(1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json（无 --gitlab）：stderr 不含任何 CI 注解（不回归泄漏）", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-json-only-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCliTsx(["check", file, "--json"]);
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stdout).ok).toBe(false);
      expect(r.stderr).not.toContain("check_name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--gitlab（无 --json）：stdout 仍是恰好一份 Code Quality 数组（旧口径不变）", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-gitlab-only-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCliTsx(["check", file, "--gitlab"]);
      expect(r.status).toBe(1);
      const rows = JSON.parse(r.stdout) as CodeQualityRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.map((r2) => r2.check_name)).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
