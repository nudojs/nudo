/**
 * Bug 1085：`nudo check --json --watch <不存在的路径>` /
 * `nudo test --json --watch <不存在的路径>` 的**路径错误早退分支**仍打
 * **pretty 多行** JSON 文档 ⇒ 破坏 watch 面「stdout = JSON Lines（每行一份
 * 完整 JSON 文档，各自可 `JSON.parse`）」的契约。
 *
 * 症状：这两条早退分支位于 **watch 安装之前** ⇒ 命中后直接
 * `console.log(JSON.stringify(..., null, 2))` 落一份缩进多行文档并 return。
 * 逐行 `JSON.parse` 的机器消费者在**第一行**即抛 SyntaxError；且同一 flag
 * 组合的 stdout 形态**随路径是否可解析而变**（合法路径是 1 行 JSON Lines）。
 * 实测：check 29 行 / test 33 行，而同参数的 `health --json --watch` 只有 1 行。
 *
 * 修复：两条早退分支改用 `emitJsonDoc(doc, true)`（watch 面 = JSON Lines）
 * ⇒ 与 health / 每轮文档的口径一致。
 *
 * 负控：**非 watch 面**的单轮 stdout 仍是一份 pretty 文档（既有金标钉的形态）
 * ⇒ 本修复不得改动它。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";
import { runWatchCli } from "./helpers/run-watch-cli.ts";

type Doc = {
  ok?: boolean;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
};

describe("Bug 1085 — watch 面的 JSON Lines 契约（早退分支也不打 pretty 文档）", () => {
  const verbs = ["check", "test"] as const;

  for (const verb of verbs) {
    it(`CLI：${verb} --json --watch <不存在的路径> ⇒ stdout 是**一行**合法 JSON`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-"));
      try {
        const missing = join(dir, "no-such-file.js");
        const r = await runWatchCli([verb, missing, "--json"], {
          cwd: dir,
          timeoutMs: 20_000,
          // 早退分支不装 watch ⇒ 进程自己退出（等退出，不等横幅）
          waitFor: "exit",
        });
        expect(r.exited, `stderr:\n${r.stderr}`).toBe(true);
        expect(r.status).toBe(1);

        const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
        // 旧行为：pretty 多行文档（check 29 行 / test 33 行）
        expect(lines.length, `stdout:\n${r.stdout}`).toBe(1);
        // 每行各自是一份完整 JSON 文档（逐行可 parse）
        const doc = JSON.parse(lines[0]!) as Doc;
        // check 面的信封带 `ok:false`；test 面的 CaseJson 信封不带 `ok`（既有形状）
        if (doc.ok !== undefined) expect(doc.ok).toBe(false);
        expect(doc.pathErrors?.length ?? 0).toBeGreaterThan(0);
        expect(doc.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
        // stdout 保持纯机器面（横幅走 stderr）
        expect(r.stdout).not.toContain("Watching for changes");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }

  it("口径对齐：health --json --watch <不存在的路径> 同样是一行（既有行为不回归）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-health-"));
    try {
      const missing = join(dir, "no-such-file.js");
      const r = await runWatchCli(["health", missing, "--json"], {
        cwd: dir,
        timeoutMs: 20_000,
        waitFor: "exit",
      });
      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(1);
      expect(() => JSON.parse(lines[0]!)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("负控：非 watch 面（--json 无 --watch）仍是一份 pretty 文档（逐字不改）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-plain-"));
    try {
      const missing = join(dir, "no-such-file.js");
      for (const verb of ["check", "test"] as const) {
        const r = runCliTsx([verb, missing, "--json"], { cwd: dir });
        expect(r.status).toBe(1);
        // 非 watch 面 = 一份 pretty 文档（多行）
        expect(r.stdout.trimEnd().split("\n").length, `stdout:\n${r.stdout}`).toBeGreaterThan(1);
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
