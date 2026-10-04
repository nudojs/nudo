// R2-4 / FIX-J4 / PR#71 review：gate-major 政策对齐。
// 1. --for-publish：拒绝未确认的 major 上升（2.x 天花板——唯一豁免是已有
//    发布 tag 的 no-op 重试、相对 baseline 的跳变、无 baseline 时的首版 1.0.0）；
//    1.x 火车（1.0.1+）必须可自动发。
// 2. --check-baseline：失败保留 baseline（重跑仍能看到 jumps）；成功/确认后也保留
//    （同一 job 的 --for-publish 要它做 jump 证据；下次 --save-baseline 整体覆盖）。
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const GATE_MAJOR = join(repoRoot, "scripts/gate-major.mjs");

/** 在 fixture 伪仓里 init git 并打 tag（`git tag` 需要先有一个提交）。 */
function tagInFixture(root: string, ...tags: string[]) {
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.email=gate@test",
    "-c",
    "user.name=gate-test",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "init",
  ]);
  for (const t of tags) execFileSync("git", ["-C", root, "tag", t]);
}

const helpers = (await import(GATE_MAJOR)) as unknown as {
  majorOf: (v: string) => number;
  majorJumps: (
    packages: Array<{ name: string; version: string }>,
    baseline: Array<{ name: string; version: string }>,
  ) => string[];
  elevatedForPublish: (
    packages: Array<{ name: string; version: string }>,
    baseline?: Array<{ name: string; version: string }>,
  ) => string[];
  MAJOR_CEILING: number;
};

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** 伪仓库根：packages/<dir>/package.json + .changeset/。 */
function makeFixture(
  pkgs: Array<{ dir: string; name: string; version: string; private?: boolean }>,
): string {
  const root = mkdtempSync(join(tmpdir(), "gate-major-"));
  temps.push(root);
  mkdirSync(join(root, ".changeset"), { recursive: true });
  for (const p of pkgs) {
    const dir = join(root, "packages", p.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: p.name,
          version: p.version,
          ...(p.private ? { private: true } : {}),
        },
        null,
        2,
      ) + "\n",
    );
  }
  return root;
}

function setVersion(root: string, dir: string, version: string): void {
  const pj = join(root, "packages", dir, "package.json");
  const pkg = JSON.parse(readFileSync(pj, "utf8"));
  pkg.version = version;
  writeFileSync(pj, JSON.stringify(pkg, null, 2) + "\n");
}

function baselinePath(root: string): string {
  return join(root, ".changeset", ".major-baseline.json");
}

function writeBaseline(
  root: string,
  entries: Array<{ name: string; version: string }>,
): void {
  writeFileSync(baselinePath(root), JSON.stringify(entries, null, 2) + "\n");
}

function runGate(
  root: string,
  args: string[],
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  try {
    // 刻意剥掉继承的 CONFIRM_MAJOR：Release 的 workflow_dispatch(confirm_major)
    // 作业级 env 带 CONFIRM_MAJOR=1，不剥会漏进所有「未确认必须拦截」断言
    // （dispatch 确认路径的 test:coverage 从未绿过）。确认路径用 env 参数显式注入。
    const { CONFIRM_MAJOR: _inherited, ...scrubbedEnv } = process.env;
    const stdout = execFileSync(process.execPath, [GATE_MAJOR, ...args], {
      env: { ...scrubbedEnv, GATE_MAJOR_ROOT: root, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

describe("majorOf / elevatedForPublish — pure helpers", () => {
  it("majorOf parses the leading segment", () => {
    expect(helpers.majorOf("0.4.10")).toBe(0);
    expect(helpers.majorOf("1.0.0")).toBe(1);
    expect(helpers.majorOf("2.3.4")).toBe(2);
    expect(helpers.majorOf("not-a-version")).toBe(0);
  });

  it("elevatedForPublish flags 2.x and first-major 1.0.0, not the 1.x train", () => {
    const elevated = helpers.elevatedForPublish([
      { name: "a", version: "0.4.10" },
      { name: "b", version: "1.0.0" },
      { name: "core", version: "1.3.0" },
      { name: "cli", version: "1.0.8" },
      { name: "c", version: "2.1.0" },
    ]);
    expect(elevated).toEqual(["b@1.0.0", "c@2.1.0"]);
    expect(helpers.MAJOR_CEILING).toBe(2);
  });

  it("elevatedForPublish leaves the 0.x line alone", () => {
    expect(
      helpers.elevatedForPublish([
        { name: "env", version: "0.4.10" },
        { name: "hv", version: "0.2.16" },
      ]),
    ).toEqual([]);
  });

  it("elevatedForPublish flags baseline major jumps (0→1 and 1→2)", () => {
    const elevated = helpers.elevatedForPublish(
      [
        { name: "env", version: "1.0.0" },
        { name: "core", version: "2.0.0" },
        { name: "svc", version: "1.2.4" },
      ],
      [
        { name: "env", version: "0.4.10" },
        { name: "core", version: "1.3.0" },
        { name: "svc", version: "1.2.3" },
      ],
    );
    expect(elevated).toEqual(["env@1.0.0", "core@2.0.0"]);
  });

  it("elevatedForPublish allows 1.x train patches when already on major 1", () => {
    expect(
      helpers.elevatedForPublish(
        [
          { name: "core", version: "1.3.1" },
          { name: "nudojs", version: "1.1.0" },
        ],
        [
          { name: "core", version: "1.3.0" },
          { name: "nudojs", version: "1.0.8" },
        ],
      ),
    ).toEqual([]);
  });
});

describe("majorJumps — baseline rise detection", () => {
  it("reports 0→1 as a jump (the hole the old publish ceiling missed)", () => {
    const jumps = helpers.majorJumps(
      [{ name: "env", version: "1.0.0" }],
      [{ name: "env", version: "0.4.10" }],
    );
    expect(jumps).toEqual(["env: 0.4.10 → 1.0.0"]);
  });

  it("reports 1→2 as a jump; same-major patch is not a jump", () => {
    const jumps = helpers.majorJumps(
      [
        { name: "core", version: "2.0.0" },
        { name: "svc", version: "1.2.4" },
      ],
      [
        { name: "core", version: "1.3.0" },
        { name: "svc", version: "1.2.3" },
      ],
    );
    expect(jumps).toEqual(["core: 1.3.0 → 2.0.0"]);
  });
});

describe("--for-publish: hand-edited 0.x → 1.0.0 (R2-4 regression)", () => {
  it("blocks first-major 1.0.0 without CONFIRM_MAJOR", () => {
    const root = makeFixture([
      { dir: "env", name: "test-env", version: "1.0.0" },
    ]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-env@1.0.0");
    expect(r.stderr).toContain("CONFIRM_MAJOR");
  });

  it("allows the first-major elevation with CONFIRM_MAJOR=1", () => {
    const root = makeFixture([
      { dir: "env", name: "test-env", version: "1.0.0" },
    ]);
    const r = runGate(root, ["--for-publish"], { CONFIRM_MAJOR: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CONFIRM_MAJOR=1");
    expect(r.stdout).toContain("test-env@1.0.0");
  });

  it("allows a 0.x publish set without confirmation", () => {
    const root = makeFixture([
      { dir: "env", name: "test-env", version: "0.4.10" },
      { dir: "hv", name: "test-hv", version: "0.2.16" },
    ]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok");
  });

  it("allows the 1.x train without confirmation (packages already at major=1)", () => {
    const root = makeFixture([
      { dir: "core", name: "test-core", version: "1.3.0" },
      { dir: "cli", name: "test-cli", version: "1.0.8" },
      { dir: "njs", name: "test-nudojs", version: "1.1.0" },
    ]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok");
  });

  it("still blocks 2.x without CONFIRM_MAJOR when entering the line (no baseline)", () => {
    const root = makeFixture([{ dir: "core", name: "test-core", version: "2.0.1" }]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-core@2.0.1");
  });

  it("still blocks 2.x entering from a lower-major baseline (hand-edit shape)", () => {
    const root = makeFixture([{ dir: "core", name: "test-core", version: "2.0.1" }]);
    writeBaseline(root, [{ name: "test-core", version: "1.9.0" }]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-core@2.0.1");
  });

  it("blocks an unpublished same-major 2.x even with baseline proof (riding the train is not exempt)", () => {
    // 绝对拦截：baseline 同 major 只证明「上一轮就在 2.x」，不豁免**未发布过**
    // 的 2.x 版本（2.0.1 也要 CONFIRM_MAJOR）
    const root = makeFixture([{ dir: "core", name: "test-core", version: "2.0.1" }]);
    writeBaseline(root, [{ name: "test-core", version: "2.0.1" }]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-core@2.0.1");
  });

  it("exempts an already-released 2.x (release git tag exists → no-op re-attempt)", () => {
    // 唯一豁免：该版本已有 `<name>@<version>` 发布 tag（曾成功发布过），
    // publish 集里的重复尝试是 no-op——changeset-free push 不因此红
    const root = makeFixture([{ dir: "core", name: "test-core", version: "2.0.1" }]);
    tagInFixture(root, "test-core@2.0.1");
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok");
  });

  it("a tag of a different version does not exempt an unpublished 2.x", () => {
    const root = makeFixture([{ dir: "core", name: "test-core", version: "2.0.2" }]);
    tagInFixture(root, "test-core@2.0.1");
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-core@2.0.2");
  });

  it("blocks a baseline 0→1 jump at publish even when version is not 1.0.0", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "1.1.0" }]);
    writeBaseline(root, [{ name: "test-env", version: "0.4.10" }]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-env@1.1.0");
  });

  it("private packages are not in the publish set", () => {
    const root = makeFixture([
      { dir: "site", name: "test-site", version: "1.0.0", private: true },
      { dir: "env", name: "test-env", version: "0.4.10" },
    ]);
    const r = runGate(root, ["--for-publish"]);
    expect(r.status).toBe(0);
  });
});

describe("--check-baseline: failure keeps the evidence (R2-4 regression)", () => {
  it("rejects a 0→1 jump and leaves the baseline for re-diagnosis", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "0.4.10" }]);
    writeBaseline(root, [{ name: "test-env", version: "0.4.10" }]);
    setVersion(root, "env", "1.0.0");

    const r = runGate(root, ["--check-baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test-env: 0.4.10 → 1.0.0");
    expect(existsSync(baselinePath(root))).toBe(true);

    // 失败重跑仍能看到 jumps（旧实现在 fail 前 rmSync，重跑变成 "no baseline"）。
    const again = runGate(root, ["--check-baseline"]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("test-env: 0.4.10 → 1.0.0");
    expect(again.stderr).not.toContain("no baseline");
    expect(existsSync(baselinePath(root))).toBe(true);
  });

  it("rejects a 1→2 jump and keeps the baseline", () => {
    const root = makeFixture([{ dir: "core", name: "test-core", version: "1.3.0" }]);
    writeBaseline(root, [{ name: "test-core", version: "1.3.0" }]);
    setVersion(root, "core", "2.0.0");

    const r = runGate(root, ["--check-baseline"]);
    expect(r.status).toBe(1);
    expect(existsSync(baselinePath(root))).toBe(true);
  });

  it("keeps the baseline on success (same-train evidence for --for-publish)", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "0.4.11" }]);
    writeBaseline(root, [{ name: "test-env", version: "0.4.10" }]);
    setVersion(root, "env", "0.4.11");

    const r = runGate(root, ["--check-baseline"]);
    expect(r.status).toBe(0);
    // baseline 保留：同一 job 的 --for-publish 要用它做 same-train 判定
    expect(existsSync(baselinePath(root))).toBe(true);
  });

  it("keeps the baseline on a confirmed jump (publish gate still sees the entry)", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "0.4.10" }]);
    writeBaseline(root, [{ name: "test-env", version: "0.4.10" }]);
    setVersion(root, "env", "1.0.0");

    const r = runGate(root, ["--check-baseline"], { CONFIRM_MAJOR: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("test-env: 0.4.10 → 1.0.0");
    expect(existsSync(baselinePath(root))).toBe(true);
  });

  it("fails closed when the baseline is missing", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "0.4.10" }]);
    const r = runGate(root, ["--check-baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no baseline");
  });

  it("--save-baseline snapshots publishable versions (skips private)", () => {
    const root = makeFixture([
      { dir: "env", name: "test-env", version: "0.4.10" },
      { dir: "site", name: "test-site", version: "1.0.0", private: true },
    ]);
    const r = runGate(root, ["--save-baseline"]);
    expect(r.status).toBe(0);
    const snap = JSON.parse(readFileSync(baselinePath(root), "utf8")) as Array<{
      name: string;
      version: string;
    }>;
    expect(snap).toEqual([{ name: "test-env", version: "0.4.10" }]);
  });
});

describe("--for-publish + --check-baseline combined (ci:version → publish)", () => {
  it("hand-edit 0.x → 1.0.0 is blocked at both gates without confirm", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "0.4.10" }]);
    writeBaseline(root, [{ name: "test-env", version: "0.4.10" }]);
    setVersion(root, "env", "1.0.0");

    const check = runGate(root, ["--check-baseline"]);
    expect(check.status).toBe(1);
    expect(existsSync(baselinePath(root))).toBe(true);

    const publish = runGate(root, ["--for-publish"]);
    expect(publish.status).toBe(1);
    expect(publish.stderr).toContain("test-env@1.0.0");
  });

  it("confirmed hand-edit passes check-baseline; for-publish still sees the entry and needs confirm", () => {
    const root = makeFixture([{ dir: "env", name: "test-env", version: "0.4.10" }]);
    writeBaseline(root, [{ name: "test-env", version: "0.4.10" }]);
    setVersion(root, "env", "1.0.0");

    const check = runGate(root, ["--check-baseline"], { CONFIRM_MAJOR: "1" });
    expect(check.status).toBe(0);
    // baseline 保留（--for-publish 的 jump 证据）
    expect(existsSync(baselinePath(root))).toBe(true);

    // 进入 1.x 的 jump 对 publish 门仍然可见：无 confirm 拦、有 confirm 放
    const publishBlocked = runGate(root, ["--for-publish"]);
    expect(publishBlocked.status).toBe(1);
    expect(publishBlocked.stderr).toContain("test-env@1.0.0");
    const publish = runGate(root, ["--for-publish"], { CONFIRM_MAJOR: "1" });
    expect(publish.status).toBe(0);
  });
});
