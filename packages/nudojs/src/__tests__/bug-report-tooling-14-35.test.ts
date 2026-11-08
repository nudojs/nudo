/**
 * 工具链接入分册回归：Bug 14 / Bug 35（CLI 面）。
 *
 * - Bug 14：`migrate retire` 用 `consumeTscArgv` 重写 tsc 命令短语时吞掉
 *   文件描述符数字（`2>&1` → `>&1`）⇒ 重定向语义静默改变。
 * - Bug 35：`init` 用目录名启发式判「workspace / 容器根」：仅含
 *   `services/<pkg>/package.json` 的普通仓被拒写。
 *
 * 用共享 CLI runner（cwd = 仓库根、目标指向 /tmp 独立夹具），避免落到 dist。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(): string {
  const d = mkdtempSync(join(tmpdir(), "nudo-bugtooling-cli-"));
  dirs.push(d);
  return d;
}

// 缓存开关对 init / migrate 无意义，但显式清空以免继承外部 env 干扰。
const cleanEnv = { NUDO_CACHE_DIR: "", NUDO_CACHE_KEY: "" };

describe("Bug 14 —— migrate retire 保留 fd 重定向前缀", () => {
  const dir = tmpProject();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "mig14",
      version: "1.0.0",
      scripts: {
        ci: "tsc --noEmit 2>&1 | tee tsc.log",
        a: "tsc --noEmit 2>> err.log",
        b: "tsc --noEmit 3>&1",
        c: "tsc --noEmit 1> out.log",
        d: "tsc --noEmit > out.log 2>&1",
      },
    }),
  );
  const r = runCliTsx(["migrate", "retire", dir, "--dry-run"], { env: cleanEnv });

  it("exit 0 且 dry-run 保留全部 fd 数字（不再吞成 >&1）", { timeout: 120_000 }, () => {
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nudo check . 2>&1 | tee tsc.log");
    expect(r.stdout).toContain("nudo check . 2>> err.log");
    expect(r.stdout).toContain("nudo check . 3>&1");
    expect(r.stdout).toContain("nudo check . 1> out.log");
    expect(r.stdout).toContain("nudo check . > out.log 2>&1");
    expect(r.stdout).not.toContain("nudo check .>&1");
    expect(r.stdout).not.toContain("nudo check .>>");
  });

  it("含数字的正常位置参数不被当 fd 前缀吃掉（仍按项目路径映射）", { timeout: 120_000 }, () => {
    const dir2 = tmpProject();
    writeFileSync(
      join(dir2, "package.json"),
      JSON.stringify({
        name: "pos14",
        version: "1.0.0",
        scripts: { build: "tsc --noEmit src2/app.ts" },
      }),
    );
    const r2 = runCliTsx(["migrate", "retire", dir2, "--dry-run"], { env: cleanEnv });
    expect(r2.status).toBe(0);
    // `src2/app.ts` 里的 `2` 不是独立 token ⇒ 整段作为位置参数消费，映射成 `.`，
    // 且不会在 `2` 处断开短语产生 `2>` 重定向残留。
    expect(r2.stdout).toContain("- tsc --noEmit src2/app.ts");
    expect(r2.stdout).toContain("+ nudo check .");
    expect(r2.stdout).not.toContain("2>");
  });
});

describe("Bug 35 —— 未声明 workspace 的普通仓 init <dir> 不假拒绝", () => {
  it("仅含 services/api/package.json 的普通仓：init src 写进最近的根 package.json", { timeout: 120_000 }, () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "package.json"), '{ "name": "rpt35", "version": "1.0.0" }\n');
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "services", "api"), { recursive: true });
    writeFileSync(
      join(dir, "services", "api", "package.json"),
      '{ "name": "api", "version": "1.0.0" }\n',
    );
    const r = runCliTsx(["init", join(dir, "src")], { env: cleanEnv });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("refusing to write");
    expect(r.stderr).not.toContain("fix:");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(pkg.nudo).toBeDefined();
  });

  it("真声明 workspace 的仓仍拒绝越界写盘（真源判据不回归）", { timeout: 120_000 }, () => {
    const dir = tmpProject();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "ws35", version: "1.0.0", workspaces: ["packages/*"] }),
    );
    mkdirSync(join(dir, "packages", "a"), { recursive: true });
    writeFileSync(join(dir, "packages", "a", "package.json"), '{"name":"a","version":"1.0.0"}\n');
    mkdirSync(join(dir, "src"), { recursive: true });
    const r = runCliTsx(["init", join(dir, "src")], { env: cleanEnv });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to write");
  });
});
