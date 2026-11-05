/**
 * Bug 589 — `nudo migrate verify <空目录>` **静默 exit 0**（零输出、零文件）。
 *
 * 根因：verify 的文件收集为空时没有「空 ⇒ 失败/警告」的判定 ⇒ 迁移闸门
 * （status → strip → verify → retire）里，verify 是唯一用来证明「产物已经能用」
 * 的步骤，对着空目录拿到 exit 0 等于给出一条**无意义但绿色**的通行证。
 * 而 `nudo check` 对**同一个目录**报「No nudo files found」并 exit 1 ⇒ 两个面
 * 对「这里没有任何可分析的文件」给出相反结论。
 *
 * 判据（闸②）：verify 与 check 对**空输入**给出同一结论（红 + 引导）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const root = join(tmpdir(), `nudo-migrate-589-${process.pid}`);
const dir = join(root, "empty");
mkdirSync(dir, { recursive: true });
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("migrate verify — 空目录不是绿灯通行证（Bug 589）", () => {
  it("文本面：空目录判红并给出引导（与 check 同口径）", { timeout: 120_000 }, () => {
    const check = runCliTsx(["check", dir]);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain("No nudo files found");

    const verify = runCliTsx(["migrate", "verify", dir]);
    // 旧行为：零输出、零诊断、exit 0
    expect(verify.status).toBe(1);
    expect(verify.stdout).toContain("No nudo files found");
    expect(verify.stdout).toContain("fix:");
  });

  it("--json 面：stdout 非空且可解析，空集被标成失败", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", dir, "--json"]);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as Array<{
      file: string;
      nudoOk: boolean;
      code?: string;
    }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]!.nudoOk).toBe(false);
    expect(parsed[0]!.code).toBe("no-files");
  });
});
