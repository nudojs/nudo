/**
 * 废弃 infer --json：stdout 只允许一份 JSON（test 用例），不得再叠 check --json。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), cliEntry, ...args],
    { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" } },
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

describe("deprecated infer --json machine contract", () => {
  it("prints exactly one JSON document on stdout and deprecates on stderr", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-infer-json-"));
    const file = join(dir, "id.js");
    writeFileSync(file, `export function id(x) {\n  return x;\n}\nid(1);\n`, "utf-8");
    const r = runCli(["infer", file, "--json"]);
    expect(r.stderr).toContain("deprecated");
    const stdout = r.stdout.trim();
    expect(stdout.startsWith("{") || stdout.startsWith("[")).toBe(true);
    // 恰好一份 JSON：整体 parse 成功
    const parsed = JSON.parse(stdout) as unknown;
    expect(parsed).toBeTruthy();
    // 不应出现第二份 JSON 的起始（check 签名 JSON）
    const body = stdout.replace(/^\s*\{/, "");
    // 若误跑 check --json，stdout 常是两个顶层对象拼接；parse 会失败——已通过 parse 则单文档
    expect(typeof parsed === "object").toBe(true);
    void body;
  });
});
