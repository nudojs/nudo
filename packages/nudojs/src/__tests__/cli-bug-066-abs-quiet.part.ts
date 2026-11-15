/**
 * BUG-066 —— `nudo check --abs --quiet` **完全忽略** `--quiet`：clean 文件
 * 打 3 行而非 1 行摘要，失败文件仍打印 `signatures` 段。
 *
 * 根因：渲染分支里 `opts.abs` 排在 `opts.quiet` **之前**，且 abs 分支自己打
 * 完整 report + 3 行 OK 块、完全不 consult quiet。现在 `--quiet` 优先
 * （压 signatures / 代数面，只留摘要），`--abs --verbose` 也不再被吞。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 零 issue 的干净文件（无导出 ⇒ 无签名、无 entry-only info ⇒ 一行摘要） */
const CLEAN = `const answer = 42;
export {};
`;
const BAD = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug066-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b66", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "ok.js"), CLEAN, "utf-8");
  writeFileSync(join(cwd, "bad.js"), BAD, "utf-8");
  return cwd;
}

describe("BUG-066 — --abs --quiet 必须兑现 --quiet", () => {
  it("clean 文件 ⇒ 恰好一行摘要（旧实现 3 行 OK 块 + 代数面）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "ok.js", "--abs", "--quiet"], { cwd });
      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("OK");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("失败文件 ⇒ 不打 signatures 段（与单独 --quiet 同形）", () => {
    const cwd = makeProject();
    try {
      const absQuiet = runCliTsx(["check", "bad.js", "--abs", "--quiet"], { cwd });
      const quiet = runCliTsx(["check", "bad.js", "--quiet"], { cwd });
      expect(absQuiet.status).toBe(1);
      expect(absQuiet.stdout).not.toContain("signatures");
      expect(quiet.stdout).not.toContain("signatures");
      // 诊断仍上屏（--quiet 只压签名，不吞错误）
      expect(absQuiet.stdout).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
