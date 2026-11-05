/**
 * Bug 645：`nudo check --watch --json` ⇒ **watch 从未启动**（--json 早退把它吞了）。
 *
 * 症状：--json 分支在 watch 安装之前就 return ⇒ 进程跑完 JSON 即退出，
 * 「Watching for changes...」永不出现、文件监听从未启动（用户以为在盯盘）。
 * 修复：两者**共存**——watch 每轮仍吐机器可读文档（每文件一份）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractJsonDocs, runWatchCli } from "./helpers/run-watch-cli.ts";

const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-645-"));
  const file = join(dir, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("Bug 645 — --watch 不再被 --json 静默丢弃", () => {
  it("CLI：--watch --json ⇒ 监听真的启动（横幅出现 + 进程常驻 + stdout 仍是 CheckJson）", async () => {
    const { cwd, file } = makeProject();
    try {
      const r = await runWatchCli(["check", file, "--json"], {
        cwd,
        timeoutMs: 20_000,
        // 收尾条件 = 横幅出现 **且** stdout 里已有可解析的 JSON 文档
        // （两路管道到达顺序不定 ⇒ 只等横幅会偶发「文档还没到」的假失败）
        waitFor: (stdout, stderr) =>
          (stdout + stderr).includes("Watching for changes...") &&
          extractJsonDocs(stdout).length > 0,
      });
      // 旧症状：进程跑完 JSON 就退出 ⇒ 从来没有「Watching for changes...」
      expect(r.stdout + r.stderr).toContain("Watching for changes...");
      // watch 是常驻面 ⇒ 收尾标记出现时进程仍活着（status=null = 被测试杀掉）
      expect(r.status).toBeNull();
      // 机器面：stdout 仍是可解析的 CheckJson（单文件契约：裸 CheckJson）
      const docs = extractJsonDocs(r.stdout);
      expect(docs.length).toBeGreaterThan(0);
      const doc = JSON.parse(docs[0]!);
      expect(doc.version).toBe(1);
      expect(doc.kind).not.toBe("multi");
      expect(doc.ok).toBe(true);
      expect(doc.signatures[0].name).toBe("one");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 40_000);
});
