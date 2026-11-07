/**
 * Bug 967 — `nudo migrate retire` 的 package.json 脚本面**没有「命令位」预筛**
 * ⇒ 非命令位置的 tsc（描述文字 / 旗标值）被当 tsc 调用改写
 * ⇒ 脚本语义被改坏（`eslint --rule tsc` → `eslint --rule nudo check .`）。
 *
 * 契约：脚本面与 workflow 面**同一套**命令位判定——
 * 只有「命令词本身」或「透明包装器（sudo/env/…）的首个参数」算 tsc 调用。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStatus, migrateRetire, rewriteTscCommand } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NON_COMMAND = [
  "eslint --rule tsc",
  "echo building with tsc",
  "echo see tsc docs",
  "eslint --rule=tsc",
  'echo "building with tsc"',
  "echo 'building with tsc'",
];

function fixture(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-967-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "b967", version: "1.0.0", scripts }, null, 2)}\n`,
  );
  return dir;
}

describe("Bug 967 — 脚本面缺「命令位」预筛 ⇒ 非命令位的 tsc 被改写", () => {
  it("非命令位置的 tsc 一律不改写", () => {
    for (const cmd of NON_COMMAND) {
      expect(rewriteTscCommand(cmd).changed).toBe(false);
      expect(rewriteTscCommand(cmd).cmd).toBe(cmd);
    }
  });

  it("命令位置的 tsc 仍然改写（含透明包装器后的首个参数）", () => {
    expect(rewriteTscCommand("tsc --noEmit").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("npx tsc --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("sudo tsc --noEmit").cmd).toBe("sudo nudo check .");
    expect(rewriteTscCommand("pnpm run lint && tsc --noEmit").cmd).toBe(
      "pnpm run lint && nudo check .",
    );
  });

  it("status 不把非命令位的 tsc 计入 tsc scripts", () => {
    const dir = fixture({
      lint: "eslint --rule tsc",
      note: "echo building with tsc",
      typecheck: "tsc --noEmit",
    });
    const rows = migrateStatus(dir);
    expect(rows[0]!.tscScripts).toEqual(["typecheck"]);
  });

  it("retire 后非命令位的 tsc 逐字未变", () => {
    const dir = fixture({
      lint: "eslint --rule tsc",
      note: "echo building with tsc",
      docs: "echo see tsc docs",
      flagval: "eslint --rule=tsc",
      quoted: 'echo "building with tsc"',
      typecheck: "tsc --noEmit",
    });
    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.lint).toBe("eslint --rule tsc");
    expect(pkg.scripts.note).toBe("echo building with tsc");
    expect(pkg.scripts.docs).toBe("echo see tsc docs");
    expect(pkg.scripts.flagval).toBe("eslint --rule=tsc");
    expect(pkg.scripts.quoted).toBe('echo "building with tsc"');
    // 真门禁仍然退役
    expect(pkg.scripts.typecheck).toBe("nudo check .");
  });
});
