/**
 * `nudo test --both-paths` / `--only <names>`（改善 5）与签名磁盘缓存的
 * 配置错误面（改善 6）CLI 集成测试。
 *
 * both-paths 语义：带 @nudo:case 的函数默认独占（只出指令见证）；旗标打开
 * 后同一轮合成调用点见证（call@ / entry@），`--json` 面 `source` 字段可分辨
 * 两条路径。退出语义不变（合成见证不判失败）。
 *
 * 夹具必须 `writeSrcTsconfig`（paths 钉到仓内 src——见 run-cli.ts 头注释）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, writeSrcTsconfig } from "./helpers/run-cli.ts";

const SRC = `/**
 * @nudo:case "add-lit" (2, 3) => 5
 */
export function add(a, b) { return a + b; }

/**
 * @nudo:case "mul-lit" (2, 3) => 6
 */
export function mul(a, b) { return a * b; }

add(10, 20);
`;

function makeFx(src = SRC): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bp-cli-"));
  writeSrcTsconfig(dir);
  writeFileSync(join(dir, "teach.js"), src, "utf8");
  return dir;
}

describe("nudo test --both-paths", () => {
  it("shows directive witness AND synthesized call@ in one round; exit unchanged", { timeout: 60_000 }, () => {
    const dir = makeFx();
    const plain = runCliTsx(["test", join(dir, "teach.js")], { cwd: dir });
    expect(plain.stdout).toContain('(2, 3) => 5');
    expect(plain.stdout).not.toMatch(/call@L\d+\s+\(10, 20\) => 30/);

    const both = runCliTsx(["test", join(dir, "teach.js"), "--both-paths"], { cwd: dir });
    expect(both.status).toBe(plain.status);
    expect(both.stdout).toContain('(2, 3) => 5');
    expect(both.stdout).toMatch(/call@L\d+\s+\(10, 20\) => 30/);
    // 指令见证不因合成而丢失
    expect(both.stdout).toContain('"add-lit"');
  });

  it("--json lists both source:directive and source:callsite entries", { timeout: 60_000 }, () => {
    const dir = makeFx();
    const r = runCliTsx(["test", join(dir, "teach.js"), "--both-paths", "--json"], { cwd: dir });
    expect(r.status).not.toBe(127);
    const doc = JSON.parse(r.stdout);
    const add = (doc.files?.[0]?.functions ?? doc.functions ?? []).find(
      (f: { name: string }) => f.name === "add",
    );
    expect(add).toBeTruthy();
    const sources = add.cases.map((c: { source: string | null }) => c.source);
    expect(sources).toContain("directive");
    expect(sources).toContain("callsite");
  });

  it("--only limits synthesis to the named functions", { timeout: 60_000 }, () => {
    const dir = makeFx();
    const r = runCliTsx(
      ["test", join(dir, "teach.js"), "--both-paths", "--only", "add"],
      { cwd: dir },
    );
    expect(r.stdout).toMatch(/call@L\d+\s+\(10, 20\) => 30/);
    // mul 不在名单：保持指令独占（无 entry@ 合成）
    expect(r.stdout).not.toMatch(/entry@\d+ \(any, any\)/);
    expect(r.stdout).toContain('"mul-lit"');
  });

  it("usage errors: --only without --both-paths, and --both-paths with --freeze", { timeout: 60_000 }, () => {
    const dir = makeFx();
    const only = runCliTsx(["test", join(dir, "teach.js"), "--only", "add"], { cwd: dir });
    expect(only.status).toBe(1);
    expect(only.stderr).toContain("--only requires --both-paths");

    const freeze = runCliTsx(
      ["test", join(dir, "teach.js"), "--both-paths", "--freeze"],
      { cwd: dir },
    );
    expect(freeze.status).toBe(1);
    expect(freeze.stderr).toContain("--both-paths cannot be combined with --freeze");
  });

  it("usage errors on --json keep a non-empty stdout envelope", { timeout: 60_000 }, () => {
    const dir = makeFx();
    const r = runCliTsx(["test", join(dir, "teach.js"), "--only", "add", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    const doc = JSON.parse(r.stdout);
    // CaseJson 信封的机器面理由（pathErrors[] 携带 nudo:usage-error）
    expect(JSON.stringify(doc)).toContain("nudo:usage-error");
  });
});

describe("signed disk cache CLI face", () => {
  function signFx(): string {
    const dir = mkdtempSync(join(tmpdir(), "nudo-sign-cli-"));
    writeSrcTsconfig(dir);
    writeFileSync(join(dir, "app.js"), "export function add(a, b) { return a + b; }\n", "utf8");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "sign-fx", private: true, nudo: { cache: { sign: true } } }),
      "utf8",
    );
    return dir;
  }

  it("sign enabled without NUDO_CACHE_KEY: check/contract/health all refuse with exit 1", { timeout: 60_000 }, () => {
    const dir = signFx();
    for (const verb of ["check", "contract", "health"] as const) {
      const r = runCliTsx([verb, join(dir, "app.js")], { cwd: dir, env: { NUDO_CACHE_KEY: "" } });
      expect(r.status, verb).toBe(1);
      expect(r.stdout + r.stderr, verb).toContain("nudo.cache.sign is enabled but NUDO_CACHE_KEY is not set");
    }
  });

  it("health --json refuses with a machine-readable envelope (stdout never empty)", { timeout: 60_000 }, () => {
    const dir = signFx();
    const r = runCliTsx(["health", join(dir, "app.js"), "--json"], { cwd: dir, env: { NUDO_CACHE_KEY: "" } });
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain("NUDO_CACHE_KEY");
  });

  it("check --json refuses via usage-error envelope", { timeout: 60_000 }, () => {
    const dir = signFx();
    const r = runCliTsx(["check", join(dir, "app.js"), "--json"], { cwd: dir, env: { NUDO_CACHE_KEY: "" } });
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout);
    expect(JSON.stringify(doc)).toContain("NUDO_CACHE_KEY");
  });

  it("invalid sign shape fails loudly (typo'd value, not silent disable)", { timeout: 60_000 }, () => {
    const dir = signFx();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "sign-fx", private: true, nudo: { cache: { sign: "true" } } }),
      "utf8",
    );
    const r = runCliTsx(["check", join(dir, "app.js")], { cwd: dir, env: { NUDO_CACHE_KEY: "k" } });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("invalid value");
  });

  it("typo'd cache keys surface as config-shape report (does not block)", { timeout: 60_000 }, () => {
    const dir = signFx();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "sign-fx", private: true, nudo: { cache: { sine: true } } }),
      "utf8",
    );
    const r = runCliTsx(["check", join(dir, "app.js")], { cwd: dir });
    expect(r.stdout).toContain('unknown key(s) "cache.sine"');
  });
});
