/**
 * issue #88 原始复现面：`nudo test` 在 path env 加载失败时曾完全静默
 * （check 侧已发 nudo:env-unresolved warning）。这里锁定 test 面的告警契约：
 * - 与 check 同格式的 `[WARNING] path env failed to load: … (nudo:env-unresolved)`
 * - 仅告警：不改退出码、不改 case 输出结构（--json 面 stdout 保持纯 JSON）
 * - 同 baseDir 多文件去重（一次批跑只报一次）
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const cli = join(root, "packages/nudojs/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCli(
  args: string[],
  opts: { cwd: string },
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const PROBE_SRC = `/**
 * @nudo:case "c" (1) => number()
 */
export function f(x) {
  return x;
}
`;
const PROBE2_SRC = `export function g(x) {
  return x + 1;
}
`;
/** 失败 env：子路径 specifier 不可解析 → import 失败 → env-unresolved */
const BROKEN_ENV = `import "@nudojs/env/does-not-exist";
export function defineEnv() {
  return { globals: {}, modules: {} };
}
`;
const VALID_ENV = `export function defineEnv() {
  return { globals: {}, modules: {} };
}
`;

function makeProject(envSrc: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-test-env-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "probe", type: "module", nudo: { env: ["./env.mjs"] } }),
    "utf-8",
  );
  writeFileSync(join(dir, "env.mjs"), envSrc, "utf-8");
  writeFileSync(join(dir, "probe.js"), PROBE_SRC, "utf-8");
  return dir;
}

/** 抽取 check/test 输出里的 env-unresolved 告警行（docs 深链行不含 [WARNING]，排除） */
function warningLines(out: string): string[] {
  return out.split("\n").filter((l) => l.includes("[WARNING]") && l.includes("nudo:env-unresolved"));
}

describe("nudo test — path env 加载失败告警（issue #88）", () => {
  it("broken env: 恰 1 条 env-unresolved 告警 + 正常 case 输出 + 退出码不变", () => {
    const dir = makeProject(BROKEN_ENV);
    const r = runCli(["test", "probe.js"], { cwd: dir });

    // 退出码与无 env 错误时一致（case 通过 → 0）
    expect(r.status).toBe(0);
    // 正常 case 输出不受影响
    expect(r.stdout).toContain('debug "c"  (1) => 1');
    expect(r.stdout).toContain('assertions');
    // 恰 1 条告警，格式与 check 同款
    const lines = warningLines(r.stdout);
    expect(lines).toHaveLength(1);
    const real = realpathSync(dir);
    expect(lines[0]).toContain(
      `[WARNING] path env failed to load: ${join(real, "env.mjs")} — Cannot find package`,
    );
    expect(lines[0]).toContain("(nudo:env-unresolved)");
  }, 30000);

  it("告警行格式与 check 完全一致（同 fixture 同错误）", () => {
    const dir = makeProject(BROKEN_ENV);
    const t = runCli(["test", "probe.js"], { cwd: dir });
    const c = runCli(["check", "probe.js"], { cwd: dir });

    expect(warningLines(t.stdout)).toHaveLength(1);
    expect(warningLines(c.stdout)).toHaveLength(1);
    expect(warningLines(t.stdout)[0]).toBe(warningLines(c.stdout)[0]);
  }, 30000);

  it("valid env: 无告警、无行为变化", () => {
    const dir = makeProject(VALID_ENV);
    const r = runCli(["test", "probe.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("env-unresolved");
    expect(r.stdout).not.toContain("env warnings");
    expect(r.stdout).toContain('debug "c"  (1) => 1');
  }, 30000);

  it("去重：同 baseDir 多文件只报一次同一错误", () => {
    const dir = makeProject(BROKEN_ENV);
    writeFileSync(join(dir, "probe2.js"), PROBE2_SRC, "utf-8");
    const r = runCli(["test", "probe.js", "probe2.js"], { cwd: dir });

    // 两个文件的 case 输出都在，env 告警只出现一次
    expect(r.stdout).toContain("nudo test");
    expect(warningLines(r.stdout)).toHaveLength(1);
    expect(r.status).toBe(0);
  }, 30000);

  it("--json: stdout 保持纯 JSON 契约，告警走 stderr，退出码不变", () => {
    const dir = makeProject(BROKEN_ENV);
    const r = runCli(["test", "--json", "probe.js"], { cwd: dir });

    expect(r.status).toBe(0);
    // stdout 是且仅是一个 JSON 文档（不含告警文本）
    const json = JSON.parse(r.stdout) as { assertions: { passed: number } };
    expect(json.assertions.passed).toBe(1);
    expect(r.stdout).not.toContain("env-unresolved");
    // 告警在 stderr，仍与 check 同格式
    expect(warningLines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("(nudo:env-unresolved)");
  }, 30000);

  it("退出码不被告警改变：断言失败仍是 1（告警不加码）", () => {
    const dir = makeProject(BROKEN_ENV);
    writeFileSync(
      join(dir, "probe.js"),
      PROBE_SRC.replace("=> number()", "=> string()"),
      "utf-8",
    );
    const r = runCli(["test", "probe.js"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(warningLines(r.stdout)).toHaveLength(1);
  }, 30000);
});
