/**
 * Bug 696 — `nudo migrate strip --json` 遇**语法错文件** ⇒ stdout 0 字节
 * （违反「`--json` 下 stdout 永不为空」的产品不变量）⇒ 已成功文件的结果
 * 一并丢失；且 stderr 不含文件名。
 *
 * 族 16（commit e5b3f388）已修好「失败时 stdout 是合法 JSON」的一半（Bug
 * 1006 的信封），但**已成功目标的结果仍会丢**（库面 `migrateStrip` 整批
 * throw ⇒ 命令层拿不到任何结果）。
 *
 * 本片（命令层）修法：**逐目标调用** ⇒ 一个目标失败不再吞掉其它目标的
 * 成功结果；失败也出**合法 JSON 信封**（`ok:false` + `results` + 带文件名
 * 的 `pathErrors`）；stderr 带**文件名**。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「信封含成功目标的 results」断言**必红**
 * （HEAD 的信封没有 `results` 字段）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = "export const a: number = 1;\n";
const BAD = "export function oops( {\n";

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-696-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: Array<{ file: string; outFile: string }>;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};

describe("Bug 696 — migrate strip --json 的失败面（stdout 永不为空 + 结果不丢）", () => {
  it("语法错文件 ⇒ stdout 是合法 JSON（非 0 字节）且带文件名", () => {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout) as StripEnvelope;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(r.stderr).toContain("bad.ts");
  });

  it("一个目标失败 + 另一个目标成功 ⇒ 成功目标的 results 不丢", () => {
    const bad = dirWith({ "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", bad, good]);
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout) as StripEnvelope;
    expect(parsed.ok).toBe(false);
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toContain("good.ts");
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
  });

  it("全成功 ⇒ stdout 仍是顶��数组（形状不变）", () => {
    const dir = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("非 JSON 面：失败目标进 stderr（带文件名），成功目标仍进 stdout", () => {
    const bad = dirWith({ "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });
    const r = runCliTsx(["migrate", "strip", bad, good]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("good.ts");
    expect(r.stderr).toContain("bad.ts");
  });
});
