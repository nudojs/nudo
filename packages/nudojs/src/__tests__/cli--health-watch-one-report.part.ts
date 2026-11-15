/**
 * Bug 929：`nudo health --watch <含 N 个文件的目录>`：**watch runner 把自己的
 * per-file 目标整个丢掉** ⇒ 每次都重跑整个路径集 ⇒ 首轮把完整报告打印
 * **N** 遍、`--json` 面 stdout 出 **N** 份完整 JSON 文档（JSON.parse 抛错）、
 * 分析工作量放大 N 倍。
 *
 * 钉：首轮**只**产生一份完整报告（Summary 行数 = 1，不是 N）；--json 面
 * stdout 里**只有一份** JSON 文档（可被 JSON.parse 解析）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractJsonDocs, runWatchCli } from "./helpers/run-watch-cli.ts";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-929-"));
  writeFileSync(join(dir, "a.js"), "export function a(x) {\n  return x;\n}\n");
  writeFileSync(join(dir, "b.js"), "export function b(x) {\n  return x * 2;\n}\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 929: health --watch 一轮只产出一份报告", () => {
  it("人类面：首轮完整报告只打印 1 份（Summary 行数 = 1，不是文件数）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", dir], { timeoutMs: 25_000 });
    const summaries = r.stdout.match(/^Summary:/gm) ?? [];
    expect(summaries.length, `stdout:\n${r.stdout}`).toBe(1);
    // 报告仍然覆盖整个目录（2 个文件都在报告里）
    expect(r.stdout).toContain("2 file(s)");
    expect(r.stdout).toContain("a.js");
    expect(r.stdout).toContain("b.js");
  });

  it("--json 面：stdout 只有一份 JSON 文档（JSON.parse 直接成功）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", dir, "--json"], { timeoutMs: 25_000 });
    const docs = extractJsonDocs(r.stdout);
    expect(docs.length, `stdout:\n${r.stdout}`).toBe(1);
    const parsed = JSON.parse(docs[0]!) as {
      ok: boolean;
      files: Array<{ file: string }>;
      summary: { files: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.files.length).toBe(2);
    expect(parsed.summary.files).toBe(2);
  });
});
