/**
 * migrate 命令层接线：status 多目标、retire 多目标、--json 信封、失败时
 * fail-closed、无可退役、保留脚本的原因。每行同时带“不该触发”的反向断言。
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

const retirable = (name: string): string =>
  pkgDir(name, JSON.stringify({
    name,
    version: "1.0.0",
    devDependencies: { typescript: "^5.0.0" },
    scripts: { typecheck: "tsc --noEmit" },
  }));

const nothingToRetire = (name: string): string =>
  pkgDir(name, JSON.stringify({ name, version: "1.0.0" }));

const brokenPkg = (name: string): string =>
  pkgDir(name, `{"name":"${name}", broken json}`);

describe("migrate 命令层接线", () => {
  it("status 审计全部目标；单目标时不得出现另一目标", () => {
    const a = retirable("status-a");
    const b = retirable("status-b");
    const both = runCliTsx(["migrate", "status", a, b]);
    expect(both.status, both.stderr).toBe(0);
    expect(both.stdout).toContain(a);
    expect(both.stdout).toContain(b);
    const one = runCliTsx(["migrate", "status", a]);
    expect(one.stdout).toContain(a);
    expect(one.stdout).not.toContain(b);
  });

  it("retire 退役全部目标；--json 顶层恒为数组（1/2 个包）", () => {
    const a = retirable("ret-a");
    const b = retirable("ret-b");
    const human = runCliTsx(["migrate", "retire", a, b]);
    expect(human.status, human.stderr).toBe(0);
    for (const dir of [a, b]) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      expect(pkg.devDependencies["typescript"]).toBeUndefined();
      expect(pkg.scripts["typecheck"]).toBe("nudo check .");
      expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    }
    expect(human.stdout).toContain(a);
    expect(human.stdout).toContain(b);

    const c = retirable("ret-c");
    const one = runCliTsx(["migrate", "retire", c, "--json"]);
    expect(one.status, one.stderr).toBe(0);
    const oneEnv = JSON.parse(one.stdout) as unknown;
    expect(Array.isArray(oneEnv)).toBe(true);
    expect(oneEnv).toHaveLength(1);

    const d = retirable("ret-d");
    const e = retirable("ret-e");
    const two = runCliTsx(["migrate", "retire", d, e, "--json"]);
    const twoEnv = JSON.parse(two.stdout) as unknown;
    expect(Array.isArray(twoEnv)).toBe(true);
    expect(twoEnv).toHaveLength(2);
  }, 60_000);

  it("畸形清单 fail-closed：人类面与 --json 都报 parse failed，不谎报缺失", () => {
    const bad = brokenPkg("parse-human");
    const human = runCliTsx(["migrate", "retire", bad]);
    expect(human.status).toBe(1);
    expect(human.stderr).toContain("package.json parse failed");
    expect(human.stderr).not.toContain("no package.json under");

    const badJson = brokenPkg("parse-json");
    const json = runCliTsx(["migrate", "retire", badJson, "--json"]);
    expect(json.status).toBe(1);
    const envelope = JSON.parse(json.stdout) as Array<{ ok: boolean; error: string }>;
    expect(Array.isArray(envelope)).toBe(true);
    expect(envelope[0]?.ok).toBe(false);
    expect(envelope[0]?.error).toContain("package.json parse failed");
    expect(json.stderr).toContain("package.json parse failed");
  });

  it("无可退役是正常结果（exit 0）；真错误仍非零退出", () => {
    const plain = nothingToRetire("plain");
    const ok = runCliTsx(["migrate", "retire", plain]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("nothing to retire");
    const bad = brokenPkg("plain-bad");
    expect(runCliTsx(["migrate", "retire", bad]).status).toBe(1);
  });

  it("编译器角色的脚本被保留时，CLI 打印原因且不改写该脚本", () => {
    const dir = pkgDir("build", JSON.stringify({
      name: "wiring-build",
      version: "1.0.0",
      devDependencies: { typescript: "^5.0.0" },
      scripts: { build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" },
    }));
    const r = runCliTsx(["migrate", "retire", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("build");
    expect(r.stdout).toContain("preserved");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
  });
});
