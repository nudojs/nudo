/**
 * G6 / BUG-024 后续：`nudo health --from usage.js`（无位置参数）——
 * --from 收尾、只吞了旗标自身的一个值，没有任何位置参数被吞。
 * 旧门把它误报成 "variadic flag(s) --from consumed ..."（文案失实）；
 * 现为定向 usage error：如实说明 --from 需显式 paths（旧形态静默扫 cwd，
 * freeze-drift 范围错误）+ 给出显式形态建议。真吞没形态（--from 收到
 * ≥2 个裸 token，其后位置参数与多 from 文件不可区分）仍报 BUG-024 错误。
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

describe("G6: health --from 无位置参数（--from 收尾）", () => {
  it("health --from usage.js → 定向 usage error，文案如实、不声称 consumed", () => {
    const r = runCli(["health", "--from", "usage.js"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--from requires explicit paths");
    expect(r.stderr).toContain(". --from"); // 建议形态 nudo health . --from usage.js
    // 本次调用 --from 只吞了 usage.js，没有任何参数被误吞——不得声称 consumed
    expect(r.stderr).not.toContain("consumed");
  });

  it("health lib.js --from usage.js extra.js（真吞参数形态）→ 仍报 BUG-024 variadic 错误", () => {
    const r = runCli(["health", "lib.js", "--from", "usage.js", "extra.js"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("variadic flag(s) --from consumed");
    expect(r.stderr).toContain("fix:");
  });

  it("health lib.js --from usage.js（paths 在旗标前）→ 正常执行，不进 variadic 门", () => {
    const r = runCli(["health", "lib.js", "--from", "usage.js"]);
    // lib.js / usage.js 不存在 → 正常的路径错误面（exit 1），而非 usage gate
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Callsite file not found");
    expect(r.stdout).toContain("File not found: lib.js");
    expect(r.stderr).not.toContain("variadic flag");
    expect(r.stderr).not.toContain("requires explicit paths");
  });
});
