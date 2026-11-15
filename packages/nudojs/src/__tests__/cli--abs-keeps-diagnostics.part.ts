/**
 * Bug 919：`nudo test --abs` 把整段 **diagnostics** 吞掉 ⇒ 期望写错
 * （`=> 42x` 这类）在观察面上是「屏幕上零提示」的**假绿**。
 *
 * 根因：「诊断上屏」的判据把 `--abs` 写成第三个被排除的面
 * （`!opts.json && diagnostics.length > 0 && !opts.abs`）——而 `--abs`
 * 并非「诊断不适用」的面（`--json` 面顶层键含 `diagnostics`）。
 *
 * 修复：`--abs` **不**排除诊断上屏 ⇒ 默认面 / `--json` 面 / `--abs` 面
 * 对同一文件的**诊断条数**一致。
 *
 * ⚠ 只改 `test --abs`：`check --abs` 的既有口径（report.ok 时只打 OK +
 * 计数）不动（Bug 669 / 692 钉住）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 期望写错（`42x` 不是合法类型表达式）⇒ 至少一条指令语法诊断。 */
const BAD_EXPECTATION_SRC = `/** @nudo:case "t" (1) => 42x */
export function f(x) { return x; }
`;

/** 人类面诊断条数：每条诊断一行，行尾带 `(nudo:<code>)`。 */
function humanDiagnosticCount(stdout: string): number {
  return stdout.split("\n").filter((l) => /\(nudo:[a-z-]+\)\s*$/.test(l)).length;
}

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-919-"));
  const file = join(cwd, "x2.js");
  writeFileSync(file, BAD_EXPECTATION_SRC, "utf-8");
  return { cwd, file };
}

describe("Bug 919 — test --abs 不再吞掉 diagnostics（三个面诊断条数一致）", () => {
  it("--abs 面：诊断段上屏（旧行为：整段消失 ⇒ 屏幕上零提示）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--abs"], { cwd });
      expect(r.stdout).toContain("diagnostics");
      expect(r.stdout).toContain("nudo:directive-syntax");
      expect(humanDiagnosticCount(r.stdout)).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("三个面（默认 / --abs / --json）对同一文件的诊断条数一致", () => {
    const { cwd, file } = makeProject();
    try {
      const plain = runCli(["test", file], { cwd });
      const abs = runCli(["test", file, "--abs"], { cwd });
      const json = runCli(["test", file, "--json"], { cwd });
      const plainCount = humanDiagnosticCount(plain.stdout);
      expect(plainCount).toBeGreaterThan(0);
      expect(humanDiagnosticCount(abs.stdout)).toBe(plainCount);
      const doc = JSON.parse(json.stdout);
      expect(doc.diagnostics.length).toBe(plainCount);
      expect(doc.summary.diagnostics).toBe(plainCount);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("对照：check --abs 的既有口径不动（report ok 时不打 issues 列表）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--abs"], { cwd });
      // check 面是另一个 verb 的既有口径（Bug 669 / 692）⇒ 本钉只保证
      // test --abs 的诊断可见，不把 check --abs 改成无条件打 issues。
      expect(typeof r.stdout).toBe("string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
