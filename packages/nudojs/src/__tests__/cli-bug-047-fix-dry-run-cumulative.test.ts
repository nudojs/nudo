/**
 * BUG-047 —— `nudo check --fix` 的 dry-run 打印的计划必须等于 `--write` 的
 * 实际写入，且 stdout 可被 `git apply --check -p1` 消费。
 *
 * 旧实现把「推进到计划文本」（`source = next` / `sidecarText = next`）放在
 * `if (opts.write)` 分支内 ⇒ dry-run 时后续 issue 仍按**修改前**的文本算：
 * 同一文件打出两份互相冲突的「新建文件」diff（`@@ -0,0 +1,2 @@`），
 * 第二份丢掉第一份的修改 ⇒ git 拒绝、且与 --write 结果不一致。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 同一文件两处可修问题 ⇒ 两份针对同一侧车的 plan */
const HELPER = `export function staticName(node) {
  return node.type;
}
export function staticLabel(node) {
  return node.label;
}
`;

function makeProject(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b47", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "helper.js"), HELPER, "utf-8");
  return cwd;
}

describe("BUG-047 — --fix 的 dry-run 计划 == --write 结果", () => {
  it("第二份 diff 以第一份为基准（累积），不是又一份「新建文件」", () => {
    const cwd = makeProject("nudo-bug047-");
    try {
      const r = runCliTsx(["check", "helper.js", "--fix"], { cwd });
      const hunks = r.stdout.split("\n").filter((l) => l.startsWith("@@ "));
      expect(hunks.length).toBeGreaterThanOrEqual(2);
      // 第一份 = 新建（空 → 2 行）；第二份必须**基于第一份**（1,2 → 1,3）
      expect(hunks[0]).toBe("@@ -0,0 +1,2 @@");
      expect(hunks[1]).toBe("@@ -1,2 +1,3 @@");
      expect(r.stdout).toContain("staticLabel");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("dry-run 的 diff 可被 `git apply --check -p1` 消费", () => {
    const cwd = makeProject("nudo-bug047-apply-");
    try {
      const init = spawnSync("git", ["init", "-q", "."], { cwd, encoding: "utf8" });
      expect(init.status, `git init 失败: ${init.stderr}`).toBe(0);
      const r = runCliTsx(["check", "helper.js", "--fix"], { cwd });
      const g = spawnSync("git", ["apply", "--check", "-p1"], {
        cwd,
        input: r.stdout,
        encoding: "utf8",
      });
      expect(g.status, `git apply --check -p1 应成功（stderr: ${g.stderr}）`).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("dry-run 与 --write 得到同一份侧车内容", () => {
    const dryCwd = makeProject("nudo-bug047-dry-");
    const writeCwd = makeProject("nudo-bug047-write-");
    try {
      const dry = runCliTsx(["check", "helper.js", "--fix"], { cwd: dryCwd });
      expect(dry.status).toBe(1); // 残余 error ⇒ 门禁红
      const written = runCliTsx(["check", "helper.js", "--fix", "--write"], {
        cwd: writeCwd,
      });
      // 两条 fix 都落盘 ⇒ 残余 error 归零（dry-run 面才保持红）
      expect(written.status).toBe(0);
      const sidecar = readFileSync(join(writeCwd, "helper.nudo.js"), "utf-8");
      // 写入的两条都在（旧实现在 dry-run 面只能「看到」第一条的基准）
      expect(sidecar).toContain("staticName");
      expect(sidecar).toContain("staticLabel");
      // dry-run 的**累加后的** hunk 文本逐行等于写入内容
      for (const line of sidecar.split("\n").filter((l) => l.trim().length > 0)) {
        expect(dry.stdout).toContain(line);
      }
      expect(dry.stdout).toContain("staticName");
      expect(dry.stdout).toContain("staticLabel");
    } finally {
      rmSync(dryCwd, { recursive: true, force: true });
      rmSync(writeCwd, { recursive: true, force: true });
    }
  });
});
