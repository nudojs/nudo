/**
 * @nudojs/cli 弃用转发 stub 的 stderr 契约：
 * - 版本/帮助探测（--version / -V / --help）无弃用提示——包管理器 resolve bin
 *   跑 --version 时 stderr 必须干净；
 * - 其余调用仍提示；
 * - NUDO_SUPPRESS_DEPRECATION=1 完全静音（脚本化迁移窗口）。
 * argv/exit-code 透传不变（无参 usage 退出码与 nudojs 一致）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const forward = join(root, "packages/cli/bin/forward.mjs");
const NOTICE = "`@nudojs/cli` is deprecated";

function runForward(
  args: string[],
  envOverride: Record<string, string | undefined> = {},
): { status: number; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.NUDO_SUPPRESS_DEPRECATION;
  for (const [k, v] of Object.entries(envOverride)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync(process.execPath, [forward, ...args], {
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("@nudojs/cli forward stub deprecation notice", () => {
  it("--version prints version on stdout with no stderr notice", () => {
    const r = runForward(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^nudojs \d+\.\d+\./m);
    expect(r.stderr).not.toContain(NOTICE);
    expect(r.stderr).toBe("");
  });

  it("-V and --help probes are also quiet", () => {
    for (const flag of ["-V", "--help"]) {
      const r = runForward([flag]);
      expect(r.stderr, `flag ${flag}`).not.toContain(NOTICE);
    }
  });

  it("normal invocation (usage face) still shows the notice on stderr", () => {
    const r = runForward([]);
    // argv/exit-code 透传：无参 usage 由 nudojs 决定（exit 1）
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(NOTICE);
    // 提示必须先于 nudojs 自身输出（dynamic import 前置打印）
    expect(r.stderr.indexOf(NOTICE)).toBeLessThan(r.stderr.indexOf("Usage: nudo"));
  });

  it("real command (check on a fixture) still shows the notice", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-forward-"));
    const file = join(dir, "id.js");
    writeFileSync(file, "export function id(x) {\n  return x;\n}\nid(1);\n", "utf8");
    const r = runForward(["check", file]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(NOTICE);
  });

  it("NUDO_SUPPRESS_DEPRECATION=1 silences the notice entirely", () => {
    const r = runForward([], { NUDO_SUPPRESS_DEPRECATION: "1" });
    expect(r.stderr).not.toContain(NOTICE);
    // 静音只摘掉提示：usage/exit-code 透传不变（无参仍由 nudojs 报 usage、exit 1）
    expect(r.stderr).toContain("Usage: nudo");
    expect(r.status).toBe(1);
  });
});
