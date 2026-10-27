/**
 * BUG-285 —— `check --gha --gitlab`（**非** `--json`）⇒ GHA 注解整段丢弃
 * （`::error` 计数 0），而同一语义只多一个无关的 `--json` 就恢复 ⇒
 * 「同一语义两种写法两个结论」。
 *
 * 现在：非 `--json` 面遇 `--gitlab`（stdout 被 Code Quality 数组占住）时
 * GHA 注解**改走 stderr**（与 `--json` 分支同形），一个通道都不丢。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 真实 L1 错误：侧车要求 n > 0，调用点传 -1 */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const boom = fn({ n: number().gt(0) });
`;
const SRC = `boom(-1);
export function boom(n) {
  return n;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug285-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b285", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "err.nudo.js"), SIDECAR, "utf-8");
  writeFileSync(join(cwd, "err.js"), SRC, "utf-8");
  return cwd;
}

const annCount = (r: { stdout: string; stderr: string }): number =>
  `${r.stdout}${r.stderr}`.split("::error").length - 1;

describe("BUG-285 — --gha --gitlab 两个通道都不丢", () => {
  it("--gha 单独 ⇒ 注解在 stdout（不回归）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gha", "err.js"], { cwd });
      expect(r.status).toBe(1);
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(r.stdout).toContain("::error");
      expect(r.stderr).not.toContain("::error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("--gha --gitlab ⇒ stdout 仍是 GitLab 数组、stderr 有 ::error（不被丢弃）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gha", "--gitlab", "err.js"], { cwd });
      expect(r.status).toBe(1);
      // stdout 契约：恰好一份 Code Quality 数组
      const rows = JSON.parse(r.stdout) as Array<{ check_name: string }>;
      expect(Array.isArray(rows)).toBe(true);
      // 用户点名的 GHA 通道不得静默消失
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(r.stderr).toContain("::error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("单变量对照：加 --json 后 GHA 计数不变（不再取决于无关旗标）", () => {
    const cwd = makeProject();
    try {
      const both = runCliTsx(["check", "--gha", "--gitlab", "err.js"], { cwd });
      const withJson = runCliTsx(
        ["check", "--json", "--gha", "--gitlab", "err.js"],
        { cwd },
      );
      expect(annCount(withJson)).toBeGreaterThanOrEqual(1);
      expect(annCount(both)).toBe(annCount(withJson));
      expect(withJson.stdout.trimStart().startsWith("{")).toBe(true);
      expect(both.stdout.trimStart().startsWith("[")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
