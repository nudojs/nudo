/**
 * Bug 499 回归（CLI 面）：**依赖模块不可读（EACCES）**不得被说成「文件不存在」，
 * 也不得让异常冒到整轮外面。
 *
 * 口径（core 侧 load-guard + service 侧 ModuleReadError 同源）：
 *  - 不可读 ⇒ 一条明确诊断（写明「读不到」+ errno），严重级 error ⇒ 非零退出；
 *  - 不可读 ≠ 不存在（诊断文案不得出现「not found」）；
 *  - 整轮仍产出报告（stdout 非空），不是「0 字节无报告」。
 *
 * root 对 chmod 000 免疫 ⇒ 真实 EACCES 用例在 root 下跳过。
 *
 * cwd 固定为仓库根（repoRoot）：tsx 的 tsconfig `paths` 解析以 cwd 为准
 * ——cwd 在仓库外时 `@nudojs/core` 会落到 package.json exports 的 dist
 * （未 build 时是陈旧产物），本用例要验的 core 侧 load-guard 就不在。
 * 仓库根 ⇒ core/service 走 src（CI build 后同样走 src，行为一致）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli, repoRoot } from "./helpers/run-cli.ts";

const isRoot = process.geteuid?.() === 0;

const MAIN = `import { probe } from "./dep.js";
export function run() {
  return probe();
}
`;
const DEP = `export function probe() {
  return 0;
}
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-499-cli-"));
  writeFileSync(join(dir, "main.js"), MAIN, "utf-8");
  writeFileSync(join(dir, "dep.js"), DEP, "utf-8");
  return dir;
}

describe("Bug 499 CLI：不可读依赖 ⇒ 明确诊断 + 非零退出（不谎报「不存在」）", () => {
  it.runIf(!isRoot)("chmod 000 的依赖 ⇒ EACCES 诊断 + exit 1 + 报告非空", () => {
    const dir = fixture();
    const dep = join(dir, "dep.js");
    chmodSync(dep, 0o000);
    try {
      const r = runCli(["check", join(dir, "main.js")], { cwd: repoRoot });
      // 报告非空（不是「整轮抛未捕获异常 ⇒ stdout 0 字节」）
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.stdout).toContain("nudo check");
      // 明确诊断：写明读不到 + errno
      expect(r.stdout).toContain("cannot read module");
      expect(r.stdout).toContain("EACCES");
      // 不可读 ≠ 不存在
      expect(r.stdout).not.toContain("not found");
      expect(r.stdout).not.toContain("Module file not found");
      // 非零退出（门禁 fail-closed）
      expect(r.status).toBe(1);
    } finally {
      chmodSync(dep, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(!isRoot)("--json 面：ok:false + error 级 issue + 非零退出", () => {
    const dir = fixture();
    const dep = join(dir, "dep.js");
    chmodSync(dep, 0o000);
    try {
      const r = runCli(["check", "--json", join(dir, "main.js")], { cwd: repoRoot });
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        summary: { errors: number };
        issues: { code: string; severity: string; message: string }[];
      };
      expect(json.ok).toBe(false);
      expect(json.summary.errors).toBeGreaterThan(0);
      expect(r.status).toBe(1);
      const readErr = json.issues.filter((i) => i.message.includes("cannot read module"));
      expect(readErr.length).toBeGreaterThan(0);
      for (const i of readErr) expect(i.severity).toBe("error");
    } finally {
      chmodSync(dep, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：依赖可读 ⇒ 无「cannot read module」诊断，门禁绿", () => {
    const dir = fixture();
    try {
      const r = runCli(["check", join(dir, "main.js")], { cwd: repoRoot });
      expect(r.stdout).not.toContain("cannot read module");
      expect(r.stdout).toContain("run() => 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
