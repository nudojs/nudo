/**
 * BUG-062 —— `nudo migrate retire` 在已有**非门禁** `check:nudo` 脚本时**不装门禁**，
 * 却报「retired」并写审计标记 ⇒ 摘掉 typescript 后**零类型检查**；紧接着
 * `migrate status` 又报「no nudo check/test script yet」⇒ 两个子命令结论相反。
 *
 * 根因：注入判据是 `!scripts["check:nudo"]`（**脚本名存不存在**），而
 * `migrate status` 的门禁判据是 `NUDO_GATE_RE`（**命令文本是不是 nudo 门禁**）
 * ⇒ 两个判据不对齐。
 *
 * 修复：注入判据改为「命令文本里有没有门禁」——`check:nudo` 存在但不是门禁
 * 时**覆写**它。
 *
 * 反向闸：真的已有门禁（`typecheck: "tsc --noEmit"` 被改写成 `nudo check .`）
 * 时不重复注入（Bug 567 反向闸口径不变）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire, migrateStatus } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(scripts: Record<string, string>, deps: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-062-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "gate3", version: "1.0.0", type: "module", scripts, devDependencies: deps }),
    "utf-8",
  );
  return dir;
}

function scriptsOf(dir: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  }).scripts;
}

describe("Bug 062: 退役完成的包必须真的装了门禁", () => {
  it("`check:nudo: echo placeholder` ⇒ 被覆写成 nudo 门禁", () => {
    const dir = pkg({ "check:nudo": "echo placeholder" }, { typescript: "^5.4.0" });
    const result = migrateRetire(dir, { workflows: false });
    expect(scriptsOf(dir)["check:nudo"]).toContain("nudo check");
    expect(result.rewrittenScripts.map((s) => s.name)).toContain("check:nudo");
    // 被覆写的旧值必须如实报出（不得谎称 "(none)"）
    const change = result.rewrittenScripts.find((s) => s.name === "check:nudo")!;
    expect(change.from).toBe("echo placeholder");
  });

  it("退役后 status 不再报「还没有门禁」（两面口径一致）", () => {
    const dir = pkg({ "check:nudo": "echo placeholder" }, { typescript: "^5.4.0" });
    writeFileSync(join(dir, "src.ts"), "export const a: number = 1;\n", "utf-8");
    migrateRetire(dir, { workflows: false });
    const rows = migrateStatus(dir);
    expect(rows[0]!.retired).toBe(true);
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("反向闸：已有真门禁时不重复注入 check:nudo", () => {
    const dir = pkg({ typecheck: "tsc --noEmit" }, { typescript: "^5.4.0" });
    const result = migrateRetire(dir, { workflows: false });
    const scripts = scriptsOf(dir);
    expect(scripts["typecheck"]).toBe("nudo check .");
    expect(scripts["check:nudo"]).toBeUndefined();
    expect(result.rewrittenScripts.map((s) => s.name)).toEqual(["typecheck"]);
  });
});
