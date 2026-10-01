/**
 * BUG-024：variadic 旗标（`--from <paths…>` 等）吞噬
 * 其后的位置参数——定向 usage error + `--` 终止符。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), cliEntry, ...args],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
    },
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

describe("BUG-024: variadic 旗标吞噬位置参数", () => {
  it("check --from a.js target.js → targeted usage error pointing at --from", () => {
    const r = runCli(["check", "--from", "a.js", "target.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("variadic flag(s) --from consumed");
    expect(r.stderr).toContain("fix:");
    expect(r.stderr).toContain("-- b.js");
    // 不再报 commander 原生的无关 missing argument
    expect(r.stderr).not.toContain("missing required argument");
  });

  it("-- terminator separates variadic flags from paths (check)", () => {
    // --from a.js -- target.js → from=[a.js], paths=[target.js]
    // → 走正常路径错误面（不是 variadic 吞没）
    const r = runCli(["check", "--from", "a.js", "--", "target.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found");
    expect(r.stderr).not.toContain("variadic flag");
  });

  it("paths before flags work (check)", () => {
    const r = runCli(["check", "target.js", "--from", "a.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found");
    expect(r.stderr).not.toContain("variadic flag");
  });

  it("pnpm-style injected -- at argv[2] is filtered (not a terminator)", () => {
    const r = runCli(["--", "check", "target.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found");
    expect(r.stderr).not.toContain("variadic flag");
  });

  it("test / contract / health share the same face", () => {
    for (const cmd of ["test", "contract", "health"]) {
      const r = runCli([cmd, "--from", "a.js", "target.js"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`\`nudo ${cmd}\` received no paths`);
      expect(r.stderr).toContain("fix:");
    }
  });

  it("check with no args → plain usage error", () => {
    const r = runCli(["check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("needs at least one path");
  });

  it("check --only swallowed → error names --only", () => {
    const r = runCli(["check", "--only", "nudo:entry-may-throw", "target.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("variadic flag(s) --only consumed");
    expect(r.stderr).toContain("fix:");
  });

  it("check --assume swallowed → error names --assume", () => {
    const r = runCli(["check", "--abs", "--assume", "x>0", "target.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("variadic flag(s) --assume consumed");
    expect(r.stderr).toContain("fix:");
  });
});
