/**
 * 一级 verb 端到端 golden：最小 fixture + 默认输出面快照 + exit code。
 * 路径已归一化（fixture 目录 → <DIR>），快照只锁稳定文本面。
 * migrate 只测 status（strip/verify/retire 有写副作用，不在 golden 范围）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const cli = join(root, "packages/cli/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCli(
  args: string[],
  opts: { cwd: string },
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    // Force a stable face: CI runners set GITHUB_ACTIONS=true, which would
    // append `::error` / `::warning` annotations and desync the snapshot.
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** fixture 目录绝对路径（含 /private 解析）→ <DIR>，保证跨机器快照稳定 */
function normalize(text: string, dir: string): string {
  const real = realpathSync(dir);
  return text.split(real).join("<DIR>").split(dir).join("<DIR>");
}

function writeFixture(dir: string, name: string, src: string): string {
  const p = join(dir, name);
  writeFileSync(p, src, "utf-8");
  return p;
}

// 最小 fixture 集（行号固定，供 call@L* 快照用）
const ID_SRC = `export function id(x) {
  return x;
}
id(1);
`;
const CASE_PASS_SRC = `/**
 * @nudo:case "num" (1) => number()
 */
export function id(x) {
  return x;
}
`;
const CASE_FAIL_SRC = `/**
 * @nudo:case "bad" (1) => string()
 */
export function id(x) {
  return x;
}
`;
const BOOM_SRC = `export function boom() {
  throw new TypeError("x");
}
`;

describe("check — default face golden", () => {
  it("OK file: signatures + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-check-ok-"));
    writeFixture(dir, "id.js", ID_SRC);
    const r = runCli(["check", "id.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });

  it("L2 entry may-throw: issues + exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-check-l2-"));
    writeFixture(dir, "boom.js", BOOM_SRC);
    const r = runCli(["check", "boom.js"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });
});

describe("test — default face golden", () => {
  it("synthetic call@ case + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-test-obs-"));
    writeFixture(dir, "id.js", ID_SRC);
    const r = runCli(["test", "id.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });

  it("declared @nudo:case pass: assertions + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-test-pass-"));
    writeFixture(dir, "id.js", CASE_PASS_SRC);
    const r = runCli(["test", "id.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });

  it("declared @nudo:case fail: FAIL row + exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-test-fail-"));
    writeFixture(dir, "id.js", CASE_FAIL_SRC);
    const r = runCli(["test", "id.js"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });
});

describe("contract — default face golden", () => {
  it("print surface: implicit interface line + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-contract-"));
    writeFixture(dir, "id.js", ID_SRC);
    const r = runCli(["contract", "id.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });
});

describe("export — default face golden", () => {
  it("default --format dts: declare lines + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-export-"));
    writeFixture(dir, "id.js", ID_SRC);
    const r = runCli(["export", "id.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });
});

describe("health — default face golden", () => {
  it("healthy file: summary + Result OK + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-health-"));
    writeFixture(dir, "id.js", ID_SRC);
    const r = runCli(["health", "id.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });
});

describe("migrate — status golden", () => {
  it("status on empty dir: table + next hint + exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-migrate-"));
    const r = runCli(["migrate", "status", "."], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout, dir)).toMatchSnapshot();
  });
});

describe("--version — shell + engine + core", () => {
  it("prints nudojs shell version and @nudojs/cli; core optional", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e2e-version-"));
    const r = runCli(["--version"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("@nudojs/cli ");
    // 壳包版本与引擎版本同屏；core 可解析时也在
    expect(r.stdout).toMatch(/nudojs \d+\.\d+\.\d+/);
    expect(r.stdout).toMatch(/@nudojs\/core \d+\.\d+\.\d+/);
  });
});
