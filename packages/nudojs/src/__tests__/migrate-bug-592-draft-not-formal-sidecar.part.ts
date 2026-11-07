/**
 * Bug 592 — `migrate strip` 的草稿写进**正式侧车路径** ⇒ CLI 标注与落盘位置不一致，
 * 且草稿被 ambient 侧车表当成真契约。
 *
 * 根因：草稿用 `sidecarPathOf(outFile)` 定位（正式侧车路径），而草稿抬头自述
 * `*.nudo.draft.js` ⇒ 文本与位置自相矛盾；CLI 打印的 draft 行也指着正式侧车路径。
 *
 * 期望：CLI 标注的 draft 路径 == 实际落盘路径 == 草稿路径；正式侧车路径不被占用。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 592 — migrate strip 的 draft 标注与落盘位置一致", () => {
  it("CLI 打印的 draft 路径就是草稿路径，正式侧车路径不被占用", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-592-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "lib.ts"),
      `export function add(a: number, b: number): number { return a + b; }\n`,
      "utf-8",
    );

    const r = runCliTsx(["migrate", "strip", "lib.ts", "--write"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("draft  lib.nudo.draft.js");
    // 改前：stdout 打印 "draft  lib.nudo.js" 且该文件真的存在（草稿冒充契约）
    expect(r.stdout).not.toContain("draft  lib.nudo.js");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
  }, 60_000);
});
