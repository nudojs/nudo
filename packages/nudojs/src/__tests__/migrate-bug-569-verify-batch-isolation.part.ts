/**
 * Bug 569 — `migrate verify`（批量目标）遇**第一个**语法错文件即整批中止。
 *
 * 根因：per-file 循环没有 try/catch ⇒ 一个语法错文件抛出的异常一路冒泡到命令层
 * 唯一的 catch ⇒ 整批结果（连同已算好的行）全部丢弃：stdout **0 字节**、
 * 错误消息不带文件名（用户拿不到「哪些文件通过了」，也拿不到「哪个文件有语法错」）。
 *
 * 判据：per-file 隔离——单个文件失败**不**中止整批；失败项带**文件名**进结果；
 * `--json` 下 stdout 永不为空。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-569-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合法文件 */
writeFileSync(join(dir, "good.js"), "export function good(x) {\n  return x;\n}\n", "utf-8");
/** 语法错文件 */
writeFileSync(join(dir, "syn.js"), "export function broken( {\n  return 1;\n}\n", "utf-8");
/** 第二个合法文件（证明「不是只报第一个」） */
writeFileSync(join(dir, "good2.js"), "export function good2(x) {\n  return x;\n}\n", "utf-8");

describe("migrate verify — 批量目标的 per-file 隔离（Bug 569）", () => {
  it("文本面：合法文件仍被逐行报告，语法错文件带文件名", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", dir]);
    expect(r.status).toBe(1);
    // 旧行为：stdout 空（整批中止）
    expect(r.stdout).toContain("good.js");
    expect(r.stdout).toContain("good2.js");
    expect(r.stdout).toContain("syn.js");
    // 失败行必须带文件名（用户能定位是哪个文件）
    expect(r.stdout).toMatch(/error:.*syn\.js/);
  });

  it("--json 面：stdout 非空且可解析，失败项进结果数组", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", dir, "--json"]);
    expect(r.status).toBe(1);
    // 旧行为：stdout 0 字节（JSON.parse 抛错）
    const parsed = JSON.parse(r.stdout) as Array<{
      file: string;
      nudoOk: boolean;
      error?: string;
    }>;
    expect(parsed).toHaveLength(3);
    const good = parsed.filter((p) => p.file.includes("good"));
    expect(good).toHaveLength(2);
    expect(good.every((g) => g.nudoOk)).toBe(true);
    const bad = parsed.find((p) => p.file.includes("syn.js"));
    expect(bad).toBeDefined();
    expect(bad!.nudoOk).toBe(false);
    expect(bad!.error).toContain("syn.js");
  });
});
