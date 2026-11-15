/**
 * Bug 652：`nudo test --abs` 在**一个函数都没有**的文件上 exit 1 + 打
 * 「Function not found」；同一命令**不带** `--abs` 却 exit 0 ⇒ 同一输入、
 * 同一份报告，仅因多一个旗标就换了退出码，且两条文案互相打架。
 *
 * 根因：`--abs` 分支借道 `runAbsView`，后者把「文件没有函数」当**用法
 * 错误**（exit 1 + 专属文案）——那是 `check --abs` 的既有语义（**Bug 669**
 * 钉住的期望行为）⇒ 修法只对 `test` 生效：文件无函数时跳过观察面，
 * 报告与退出码与非 `--abs` 面逐字一致。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const NO_FN_SRC = `export const x = 1;
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-652-"));
  const file = join(cwd, "nofn.js");
  writeFileSync(file, NO_FN_SRC, "utf-8");
  return { cwd, file };
}

describe("Bug 652 — test --abs 与非 --abs 共用同一套「无函数」结论", () => {
  it("无函数文件：--abs 与非 --abs 同为 exit 0 + 同一句报告", () => {
    const { cwd, file } = makeProject();
    try {
      const plain = runCli(["test", file], { cwd });
      const abs = runCli(["test", file, "--abs"], { cwd });
      expect(plain.status).toBe(0);
      // 旧症状：--abs 面 exit 1
      expect(abs.status).toBe(0);
      // 两面同一句「无函数可分析」结论
      expect(plain.stdout).toContain("No functions found to analyze.");
      expect(abs.stdout).toContain("No functions found to analyze.");
      // 旧症状：--abs 面多打一行「Function not found」（与上面那句直接打架）
      expect(abs.stderr).not.toContain("Function not found");
      expect(abs.stdout).not.toContain("Function not found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("无函数文件：--json 面（另一条机器面）同样 exit 0", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.summary.functions).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("对照：check --abs 的「无函数 ⇒ exit 1」是既有期望行为（Bug 669）不被本片改动", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--abs"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Function not found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
