/**
 * 族 16 主 agent 接线钉 —— 覆盖各分片「越界发现」里明确交给命令层的接线项：
 *
 * | Bug | 分片未做（因其不拥有命令层文件） | 本文件钉住的行为 |
 * |---|---|---|
 * | **668** | M1/M6 拥有 `commands/migrate.ts`，但 status 的多路径截断无人接线 | `migrate status <a> <b>` **两个包都审计** |
 * | **595** | M5 修好库面 `migrateRetireMany`，CLI 仍只退役 `targets[0]` | `migrate retire <a> <b>` **两个包都退役** |
 * | **675** | M5 报告「JSON 顶层形状随结果条数变化」⇒ 归命令层 | `migrate retire --json` 顶层**恒为数组**（1 个包也是数组） |
 * | **1006** | M5 报告「失败时 stdout 为空 ⇒ `--json` 契约破裂」⇒ 归命令层 | `migrate retire --json` 失败时 stdout **仍是合法 JSON** |
 * | **567** | M5 库面改成**抛错**（「nothing to retire」），CLI 口径需定 | 「无可退役」是**正常结果** ⇒ exit 0（不是错误） |
 * | **586** | M5 产出 `preservedScripts`，CLI 不打印 ⇒ 用户看不到「这个脚本为什么没改」 | CLI **打印** preserved 脚本及其原因 |
 * | **588** | M2 修好 status 面；M5 区间仍用 `readJson`（解析失败谎报「没有 package.json」） | retire 侧遇到畸形清单 **fail-closed** 报「parse failed」 |
 *
 * 反向闸（断言非永真）：每条都有「不该发生时不得触发」的对照断言。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(name: string, pkg: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-migrate-wiring-${name}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), String(pkg), "utf-8");
  return dir;
}

/** 有门禁角色 tsc 的包（可退役） */
function retirable(name: string): string {
  return pkgDir(
    name,
    JSON.stringify({
      name,
      version: "1.0.0",
      devDependencies: { typescript: "^5.0.0" },
      scripts: { typecheck: "tsc --noEmit" },
    }),
  );
}

/** 无任何 tsc/typescript 的包（无可退役） */
function nothingToRetire(name: string): string {
  return pkgDir(name, JSON.stringify({ name, version: "1.0.0" }));
}

/** 畸形清单 */
function brokenPkg(name: string): string {
  return pkgDir(name, `{"name":"${name}", broken json}`);
}

describe("族 16 接线 —— migrate 命令层（status 多路径 / retire 多目标 / JSON 契约）", () => {
  it("Bug 668：status 审计全部目标（不得静默只报第一个）", { timeout: 30_000 }, () => {
    const a = retirable("wiring-a");
    const b = retirable("wiring-b");
    const r = runCliTsx(["migrate", "status", a, b]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
    expect(r.stdout).toContain(b);
    // 反向闸：只给一个目标时，那一个必须出现（不是「因为模板里有字面量」）
    const one = runCliTsx(["migrate", "status", a]);
    expect(one.stdout).toContain(a);
    expect(one.stdout).not.toContain(b);
  });

  it("Bug 595：retire 退役全部目标（不得静默只退役第一个）", () => {
    const a = retirable("wiring-ret-a");
    const b = retirable("wiring-ret-b");
    const r = runCliTsx(["migrate", "retire", a, b]);
    expect(r.status, r.stderr).toBe(0);
    for (const dir of [a, b]) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      expect(pkg.devDependencies["typescript"]).toBeUndefined();
      expect(pkg.scripts["typecheck"]).toBe("nudo check .");
      expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    }
    expect(r.stdout).toContain(a);
    expect(r.stdout).toContain(b);
  });

  it("Bug 675：retire --json 的顶层形状恒为数组（1 个包也是数组）", { timeout: 30_000 }, () => {
    const a = retirable("wiring-json-1");
    const one = runCliTsx(["migrate", "retire", a, "--json"]);
    expect(one.status, one.stderr).toBe(0);
    const parsed = JSON.parse(one.stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);

    const b = retirable("wiring-json-2");
    const two = runCliTsx(["migrate", "retire", a, b, "--json"]);
    const parsed2 = JSON.parse(two.stdout) as unknown;
    expect(Array.isArray(parsed2)).toBe(true);
    expect(parsed2).toHaveLength(2);
  });

  it("Bug 1006：retire --json 失败时 stdout 仍是合法 JSON", () => {
    const bad = brokenPkg("wiring-bad");
    const r = runCliTsx(["migrate", "retire", bad, "--json"]);
    expect(r.status).toBe(1);
    // stdout 必须是合法 JSON（机器面契约：--json 下 stdout 永不为空且可解析）
    const parsed = JSON.parse(r.stdout) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("package.json parse failed");
    // 反向闸：人类面仍有 stderr 引导
    expect(r.stderr).toContain("package.json parse failed");
  });

  it("Bug 567：「无可退役」是正常结果 ⇒ exit 0（不是错误）", { timeout: 30_000 }, () => {
    const plain = nothingToRetire("wiring-plain");
    const r = runCliTsx(["migrate", "retire", plain]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("nothing to retire");
    // 反向闸：真的报错时必须非零 exit（不能把错误也吞成 0）
    const bad = brokenPkg("wiring-plain-bad");
    const r2 = runCliTsx(["migrate", "retire", bad]);
    expect(r2.status).toBe(1);
  });

  it("Bug 586：编译器角色的脚本被保留时，CLI 必须说明原因", () => {
    const dir = pkgDir(
      "wiring-build",
      JSON.stringify({
        name: "wiring-build",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" },
      }),
    );
    const r = runCliTsx(["migrate", "retire", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("build");
    expect(r.stdout).toContain("preserved");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // build 原样保留；typescript 依赖不得摘（摘了 build 当场坏掉）
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
  });

  it("Bug 588：retire 侧遇到畸形清单要 fail-closed（不得谎报「没有 package.json」）", () => {
    const bad = brokenPkg("wiring-parse");
    const r = runCliTsx(["migrate", "retire", bad]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("package.json parse failed");
    // 反向闸：措辞不得是「没有 package.json」（那是「读不出来」被当成「不存在」）
    expect(r.stderr).not.toContain("no package.json under");
  });
});
