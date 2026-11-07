/**
 * Bug 567 — `nudo migrate retire` 对「无 tsc 可退役」的包仍写退役标记并注入脚本。
 *
 * 夹具：纯 JS 包（无 typescript 依赖、无任何 tsc 脚本、无 CI workflow）。
 * 期望：retire 是 no-op —— 不注入 `check:nudo`、不写 `.nudo/migrate-retired.json`、
 *       明确报「nothing to retire」；不得 exit 0 谎报「retired」。
 * 反向闸：有 tsc 面的包照常退役（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function plainJsPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-567-"));
  dirs.push(dir);
  const pkg = '{ "name": "plainjs", "version": "1.0.0", "scripts": { "test": "node -e 0" } }\n';
  writeFileSync(join(dir, "package.json"), pkg, "utf-8");
  return dir;
}

describe("Bug 567: retire 对「无 tsc 可退役」的包必须 no-op", () => {
  it("库面：无 TS 面 ⇒ 抛 nothing to retire，且零写盘", () => {
    const dir = plainJsPkg();
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/nothing to retire/);
    // 落盘零变化：无注入、无退役标记
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("CLI 面：exit 0 + 不谎报 retired + 落盘零变化", () => {
    const dir = plainJsPkg();
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    const r = runCliTsx(["migrate", "retire", dir]);
    // 报告口径：「nothing to retire (no tsc/typescript in scope)」分支在单根路径上
    // **永远不可达**（根因：库面无条件写标记 + 注入脚本）⇒ 修好后该分支**可达**。
    // 「无可退役」是**正常结果**（不是失败）⇒ exit 0（主 agent 收口时定的口径）。
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("retired");
    expect(`${r.stdout}${r.stderr}`).toContain("nothing to retire");
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(existsSync(join(dir, ".nudo"))).toBe(false);
  });

  it("反向闸：有 tsc 面的包照常退役（注入 + 标记落盘）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m5-567-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "tspkg",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const result = migrateRetire(dir, { workflows: false });
    expect(result.removedDeps).toContain("devDependencies");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    // 门禁脚本被改写成 nudo check（该包已有门禁 ⇒ 不再重复注入 check:nudo）
    expect(pkg.scripts["typecheck"]).toContain("nudo check");
  });
});
