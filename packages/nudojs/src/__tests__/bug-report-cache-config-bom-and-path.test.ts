/**
 * 分册 12 回归：package.json BOM / 入口路径 file 归因（CLI 端到端）。
 *
 * - Bug 15：package.json 带 UTF-8 BOM ⇒ check / init / migrate status 三面都正常，
 *   配置照常生效、init 幂等 / 写入保留 BOM、migrate 不再「package.json parse failed」。
 * - Bug 2：NUDO_CACHE_DIR + 双同内容文件 ⇒ --json 的 file 字段各归各文件。
 *
 * CLI 子进程 cwd 保持仓库根（runCliTsx 默认），@nudojs/* 解析到 src；目标一律
 * 传 /tmp 夹具的绝对路径（配置查找基于目标文件所在目录，与 cwd 无关）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";
import { parseJsonText, stripBom } from "../read-json.ts";

const BOM = "\uFEFF";
/** 关闭磁盘缓存 + 中和环境里可能残留的签名密钥（配置无 nudo.cache 时密钥本就无关） */
const NEUTRAL_ENV = { NUDO_CACHE_DIR: "", NUDO_CACHE_KEY: "" };

function makeBomProject(withConfig: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug15-bom-"));
  const pkg = withConfig
    ? { name: "bom", version: "1.0.0", nudo: { check: { profile: "adoption" } } }
    : { name: "bom-no-config", version: "1.0.0" };
  writeFileSync(join(dir, "package.json"), BOM + JSON.stringify(pkg) + "\n", "utf-8");
  return dir;
}

describe("Bug 15 — package.json 带 BOM 仍正常读配置", () => {
  it("helper：先剥 BOM 再 parse；无 BOM 原样", () => {
    expect(stripBom(BOM + '{"a":1}')).toBe('{"a":1}');
    expect(stripBom('{"a":1}')).toBe('{"a":1}');
    expect(parseJsonText(BOM + '{"nudo":{"check":{"profile":"adoption"}}}')).toEqual({
      nudo: { check: { profile: "adoption" } },
    });
  });

  it(
    "check 应用 BOM 配置（adoption ⇒ L2 warning ⇒ ok:true），init 幂等，migrate status 不报 parse failed",
    { timeout: 60_000 },
    () => {
      const dir = makeBomProject(true);
      writeFileSync(
        join(dir, "a.js"),
        "export function getName(user) { return user.name; }\n",
        "utf-8",
      );

      const check = runCliTsx(["check", join(dir, "a.js"), "--json"], { env: NEUTRAL_ENV });
      expect(check.status).toBe(0);
      expect((JSON.parse(check.stdout) as { ok: boolean }).ok).toBe(true);
      expect(check.stderr).not.toContain("package.json parse failed");

      const init = runCliTsx(["init", dir], { env: NEUTRAL_ENV });
      expect(init.status).toBe(0);
      expect(init.stdout).toContain("already has a nudo config");

      const status = runCliTsx(["migrate", "status", dir], { env: NEUTRAL_ENV });
      expect(status.stdout + status.stderr).not.toContain("package.json parse failed");
    },
  );

  it("init 写入 adoption 基线且保留 BOM（最小写盘字节保真）", { timeout: 60_000 }, () => {
    const dir = makeBomProject(false);
    const init = runCliTsx(["init", dir], { env: NEUTRAL_ENV });
    expect(init.status).toBe(0);
    const raw = readFileSync(join(dir, "package.json"), "utf-8");
    expect(raw.startsWith(BOM)).toBe(true);
    expect((JSON.parse(raw.slice(BOM.length)) as { nudo: unknown }).nudo).toEqual({
      check: { profile: "adoption" },
    });
  });
});

describe("Bug 2 — NUDO_CACHE_DIR + 双同内容文件，file 字段各归各文件", () => {
  it("check b.js 的 file 不是 a.js（修复前共用 cnt: 缓存）", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug2-cli-"));
    const content = "export function f(x) { return x + 1; }\n";
    writeFileSync(join(dir, "a.js"), content, "utf-8");
    writeFileSync(join(dir, "b.js"), content, "utf-8");
    const env = { NUDO_CACHE_KEY: "", NUDO_CACHE_DIR: join(dir, "cache") };

    const a = runCliTsx(["check", join(dir, "a.js"), "--json"], { env });
    const b = runCliTsx(["check", join(dir, "b.js"), "--json"], { env });
    const fileA = (JSON.parse(a.stdout) as { file: string }).file;
    const fileB = (JSON.parse(b.stdout) as { file: string }).file;
    expect(fileA.endsWith("a.js")).toBe(true);
    expect(fileB.endsWith("b.js")).toBe(true);
    expect(fileA).not.toBe(fileB);
  });
});
