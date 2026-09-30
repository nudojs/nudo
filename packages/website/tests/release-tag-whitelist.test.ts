// FIX-RESIDUAL-3 项 4：release tag 白名单支持 prerelease（FIX-J5 残留风险 1）。
// 生产脚本是 .github/workflows/release.yml release-tag step 里的 node -e 内联体。
// 本测试从 YAML 抽出该脚本端到端跑，保证白名单与注入面跟工作流一致（不是复制正则）。
// 接受：vMAJOR.MINOR.PATCH + 可选 semver prerelease / build metadata。
// 拒绝：换行、空格、"="（GITHUB_OUTPUT 行注入面）、".." 等注入字符，以及结构非法 tag。
// 注入门禁是显式 charset 护栏（结构正则本身也是闭 charset）；JS "$" 在无 m 旗标时
// 并不会放过尾随换行（与 Perl/Python 不同），这里仍保留双重拒绝作纵深。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const RELEASE_YML = join(repoRoot, ".github/workflows/release.yml");

const NODE_E_OPEN = "tag=$(node -e '";
const NODE_E_CLOSE = "')";

/** 从 release.yml 抽出 release-tag step 的 `node -e '…'` 脚本体。 */
function extractReleaseTagScript(): string {
  const yaml = readFileSync(RELEASE_YML, "utf8");
  const start = yaml.indexOf(NODE_E_OPEN);
  expect(start, "release-tag node -e open marker").toBeGreaterThan(-1);
  const bodyStart = start + NODE_E_OPEN.length;
  const end = yaml.indexOf(NODE_E_CLOSE, bodyStart);
  expect(end, "release-tag node -e close marker").toBeGreaterThan(bodyStart);
  const body = yaml.slice(bodyStart, end);
  // node -e 外层是单引号：脚本体不得再含单引号（会提前截断）。
  expect(body.includes("'"), "script body has no single quote").toBe(false);
  return body;
}

type RunResult = { status: number; stdout: string; stderr: string };

function runTagScript(published: unknown): RunResult {
  const script = extractReleaseTagScript();
  try {
    const stdout = execFileSync(process.execPath, ["-e", script], {
      env: { ...process.env, PUBLISHED: JSON.stringify(published) },
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

function expectTag(published: unknown, tag: string): void {
  const r = runTagScript(published);
  expect(r.status, `reject ${JSON.stringify(published)}: ${r.stderr}`).toBe(0);
  expect(r.stdout).toBe(tag);
}

function expectReject(published: unknown): void {
  const r = runTagScript(published);
  expect(r.status, `accept ${JSON.stringify(published)} → ${r.stdout}`).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("failed whitelist");
}

describe("release-tag whitelist — accept stable + prerelease + build metadata", () => {
  it("accepts plain vMAJOR.MINOR.PATCH (FIX-J5 base case preserved)", () => {
    expectTag([{ name: "a", version: "1.2.3" }], "v1.2.3");
    expectTag([{ name: "a", version: "0.4.10" }], "v0.4.10");
    expectTag([{ name: "a", version: "10.20.30" }], "v10.20.30");
  });

  it("accepts semver prerelease (the FIX-J5 residual gap)", () => {
    expectTag([{ name: "a", version: "1.2.3-beta.1" }], "v1.2.3-beta.1");
    expectTag([{ name: "a", version: "1.0.0-rc.1" }], "v1.0.0-rc.1");
    expectTag([{ name: "a", version: "1.0.0-0" }], "v1.0.0-0");
    expectTag([{ name: "a", version: "1.0.0-alpha.beta.1" }], "v1.0.0-alpha.beta.1");
    expectTag([{ name: "a", version: "2.0.0-next-2" }], "v2.0.0-next-2");
    expectTag([{ name: "a", version: "1.0.0-beta--1" }], "v1.0.0-beta--1");
  });

  it("accepts build metadata (+meta, default-allowed per ticket)", () => {
    expectTag([{ name: "a", version: "1.0.0+build.1" }], "v1.0.0+build.1");
    expectTag(
      [{ name: "a", version: "1.0.0-beta.1+exp.sha.5114f85" }],
      "v1.0.0-beta.1+exp.sha.5114f85",
    );
  });

  it("still picks the highest major.minor.patch across packages", () => {
    expectTag(
      [
        { name: "nudojs", version: "0.4.10" },
        { name: "@nudojs/core", version: "1.10.0" },
      ],
      "v1.10.0",
    );
  });
});

// FIX-RESIDUAL-4 项 2：cmp 必须按 semver 优先级（含 prerelease），不能只比
// major.minor.patch——否则 1.0.0-beta.1 与 1.0.0 同序，sort().pop() 看数组顺序。
describe("release-tag semver precedence (cmp is prerelease-aware)", () => {
  it("stable beats prerelease at the same core version, both array orders", () => {
    expectTag(
      [
        { name: "a", version: "1.0.0" },
        { name: "b", version: "1.0.0-beta.1" },
      ],
      "v1.0.0",
    );
    expectTag(
      [
        { name: "b", version: "1.0.0-beta.1" },
        { name: "a", version: "1.0.0" },
      ],
      "v1.0.0",
    );
    expectTag(
      [
        { name: "a", version: "2.0.0-rc.1" },
        { name: "b", version: "2.0.0" },
        { name: "c", version: "1.9.9" },
      ],
      "v2.0.0",
    );
  });

  it("semver.org prerelease chain: alpha < alpha.1 < alpha.beta < beta < beta.2 < beta.11 < rc.1 < stable", () => {
    expectTag(
      [
        { name: "a", version: "1.0.0-alpha" },
        { name: "b", version: "1.0.0-alpha.1" },
      ],
      "v1.0.0-alpha.1",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-alpha.1" },
        { name: "b", version: "1.0.0-alpha.beta" },
      ],
      "v1.0.0-alpha.beta",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-alpha.beta" },
        { name: "b", version: "1.0.0-beta" },
      ],
      "v1.0.0-beta",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-beta" },
        { name: "b", version: "1.0.0-beta.2" },
      ],
      "v1.0.0-beta.2",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-beta.2" },
        { name: "b", version: "1.0.0-beta.11" },
      ],
      "v1.0.0-beta.11",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-beta.11" },
        { name: "b", version: "1.0.0-rc.1" },
      ],
      "v1.0.0-rc.1",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-rc.1" },
        { name: "b", version: "1.0.0" },
      ],
      "v1.0.0",
    );
    // shuffled chain still resolves to stable
    expectTag(
      [
        { name: "a", version: "1.0.0-beta.11" },
        { name: "b", version: "1.0.0" },
        { name: "c", version: "1.0.0-alpha" },
        { name: "d", version: "1.0.0-beta.2" },
        { name: "e", version: "1.0.0-rc.1" },
        { name: "f", version: "1.0.0-alpha.beta" },
      ],
      "v1.0.0",
    );
  });

  it("prerelease identifiers: numeric segments compare numerically; numeric < alphanumeric; longer wins on prefix ties", () => {
    // numeric, not lexicographic: 2 < 11
    expectTag(
      [
        { name: "a", version: "1.0.0-beta.2" },
        { name: "b", version: "1.0.0-beta.11" },
      ],
      "v1.0.0-beta.11",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-2" },
        { name: "b", version: "1.0.0-11" },
      ],
      "v1.0.0-11",
    );
    // numeric identifiers have lower precedence than alphanumeric
    expectTag(
      [
        { name: "a", version: "1.0.0-1" },
        { name: "b", version: "1.0.0-alpha" },
      ],
      "v1.0.0-alpha",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-999" },
        { name: "b", version: "1.0.0-0" },
      ],
      "v1.0.0-999",
    );
    // larger identifier set wins when all preceding are equal
    expectTag(
      [
        { name: "a", version: "1.0.0-alpha" },
        { name: "b", version: "1.0.0-alpha.1" },
      ],
      "v1.0.0-alpha.1",
    );
    // ASCII lexicographic on alphanumeric identifiers
    expectTag(
      [
        { name: "a", version: "1.0.0-alpha" },
        { name: "b", version: "1.0.0-beta" },
      ],
      "v1.0.0-beta",
    );
  });

  it("core version still dominates prerelease depth", () => {
    expectTag(
      [
        { name: "a", version: "1.2.3-beta.9" },
        { name: "b", version: "1.2.4-0" },
      ],
      "v1.2.4-0",
    );
    expectTag(
      [
        { name: "a", version: "1.2.3" },
        { name: "b", version: "1.3.0-rc.1" },
      ],
      "v1.3.0-rc.1",
    );
    expectTag(
      [
        { name: "a", version: "2.0.0-beta" },
        { name: "b", version: "1.9.9" },
      ],
      "v2.0.0-beta",
    );
  });

  it("build metadata is ignored for precedence", () => {
    // same core, build metadata does not promote a prerelease over stable
    expectTag(
      [
        { name: "a", version: "1.0.0-beta.1+aaa" },
        { name: "b", version: "1.0.0+bbb" },
      ],
      "v1.0.0+bbb",
    );
    expectTag(
      [
        { name: "a", version: "1.0.0-rc.1+exp.sha.5114f85" },
        { name: "b", version: "1.0.0+20130313144700" },
      ],
      "v1.0.0+20130313144700",
    );
    // build metadata must not beat a higher core version
    expectTag(
      [
        { name: "a", version: "1.0.0+9999" },
        { name: "b", version: "1.0.1-beta.1" },
      ],
      "v1.0.1-beta.1",
    );
  });
});

describe("release-tag whitelist — reject injection / structural garbage", () => {
  it("rejects newlines (GITHUB_OUTPUT line injection)", () => {
    expectReject([{ name: "a", version: "1.0.0\ntag=evil" }]);
    expectReject([{ name: "a", version: "1.0.0\n" }]);
    expectReject([{ name: "a", version: "1.0.0\r\n" }]);
    expectReject([{ name: "a", version: "1.0.0\nx=1" }]);
  });

  it("rejects spaces / tabs / = (GITHUB_OUTPUT spoof)", () => {
    expectReject([{ name: "a", version: "1.0.0 tag=evil" }]);
    expectReject([{ name: "a", version: "1.0.0=x" }]);
    expectReject([{ name: "a", version: "1.0.0-beta.1=x" }]);
    expectReject([{ name: "a", version: "1.0.0\tx" }]);
  });

  it("rejects empty pre/build identifiers and ..", () => {
    expectReject([{ name: "a", version: "1.0.0-beta..1" }]);
    expectReject([{ name: "a", version: "1.0.0-beta." }]);
    expectReject([{ name: "a", version: "1.0.0-.beta" }]);
    expectReject([{ name: "a", version: "1.0.0-" }]);
    expectReject([{ name: "a", version: "1.0.0+..x" }]);
    expectReject([{ name: "a", version: "1.0.0+" }]);
    expectReject([{ name: "a", version: "1.0.0..1" }]);
  });

  it("rejects shell / URL metas outside the closed charset", () => {
    expectReject([{ name: "a", version: "1.0.0; rm -rf /" }]);
    expectReject([{ name: "a", version: "1.0.0$(id)" }]);
    expectReject([{ name: "a", version: "1.0.0`id`" }]);
    expectReject([{ name: "a", version: "1.0.0/../../etc" }]);
    expectReject([{ name: "a", version: "1.0.0|id" }]);
    expectReject([{ name: "a", version: "1.0.0&id" }]);
    expectReject([{ name: "a", version: "1.0.0'" }]);
    expectReject([{ name: "a", version: '1.0.0"' }]);
    expectReject([{ name: "a", version: "1.0.0*" }]);
  });

  it("rejects non-tag versions (v prefix, short, non-numeric)", () => {
    expectReject([{ name: "a", version: "v1.0.0" }]); // → vv1.0.0
    expectReject([{ name: "a", version: "1.0" }]);
    expectReject([{ name: "a", version: "not-a-version" }]);
    expectReject([{ name: "a", version: "" }]);
    expectReject([{ name: "a", version: "1.0.0.0" }]);
  });

  it("fails closed on empty published set (vundefined)", () => {
    expectReject([]);
  });

  it("rejects when the winning version is malicious even among clean ones", () => {
    expectReject([
      { name: "a", version: "0.0.1" },
      { name: "b", version: "9.9.9\ntag=evil" },
    ]);
    expectReject([
      { name: "a", version: "0.0.1" },
      { name: "b", version: "9.9.9=evil" },
    ]);
  });
});
