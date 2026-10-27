/**
 * BUG-051 —— `nudo migrate retire <a> <b>` **静默跳过**可退役的包并 exit 0。
 *
 * 根因（命令层）：`commands/migrate.ts` 把批次错误按「**所有**失败项都以
 * `nothing to retire` 开头」整体判为良性 ⇒ exit 0 + 成功信封 ⇒ 同一批里
 * **有活可干**的目标（库面因原子性未提交）被良性失败掩盖。
 *
 * 期望：
 * - 有活的目标**照常退役**（落盘）；
 * - 无可退役的目标**明确报出**（不得静默）；
 * - 「nothing to retire」仍是正常结果（exit 0，Bug 567 口径不变）。
 *
 * 库面的**原子性**不变（`migrateRetireMany` 仍整批报错，Bug 595 / 族 56 的
 * 契约）：本文件只钉命令层的「不得谎报」。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-051-"));
  dirs.push(dir);
  return dir;
}

/** 有 tsc 脚本 + typescript 依赖（可退役） */
function retirable(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        private: true,
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.4.0" },
      },
      null,
      2,
    ),
    "utf-8",
  );
  return dir;
}

/** 无 tsc/typescript（无可退役） */
function nothingToRetire(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", private: true, scripts: { build: "node build.js" } }),
    "utf-8",
  );
  return dir;
}

describe("Bug 051: 多目标批次里不得用「无可退役」掩盖「有活没干」", () => {
  it("可退役 + 无可退役 ⇒ 可退役的那个**真的退役**（不是 exit 0 什么都没做）", () => {
    const root = scratch();
    const a = retirable(root, "p11a");
    const b = nothingToRetire(root, "p11b");
    const r = runCliTsx(["migrate", "retire", a, b]);
    expect(r.status, r.stderr).toBe(0);

    // ① 有活的目标必须落盘
    const pkg = JSON.parse(readFileSync(join(a, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    expect(existsSync(join(a, ".nudo", "migrate-retired.json"))).toBe(true);

    // ② 被跳过的目标必须**可见**（不得静默）
    expect(r.stdout).toContain(b);
    expect(r.stdout).toContain("nothing to retire");
  });

  it("--json 面：已退役目标进结果，被跳过目标挂 skipped（机器面不丢信息）", () => {
    const root = scratch();
    const a = retirable(root, "p11a");
    const b = nothingToRetire(root, "p11b");
    const r = runCliTsx(["migrate", "retire", a, b, "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{
      root: string;
      removedDeps: string[];
      skipped?: Array<{ target: string; message: string }>;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.removedDeps).toContain("devDependencies");
    expect(parsed[0]!.skipped?.map((s) => s.target)).toEqual([b]);
  });

  it("反向闸：全部目标都无可退役 ⇒ exit 0 + 「nothing to retire」（Bug 567 口径不变）", () => {
    const root = scratch();
    const a = nothingToRetire(root, "plain-a");
    const b = nothingToRetire(root, "plain-b");
    const r = runCliTsx(["migrate", "retire", a, b]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("nothing to retire");
    expect(existsSync(join(a, ".nudo"))).toBe(false);
    expect(existsSync(join(b, ".nudo"))).toBe(false);
  });
});
