/**
 * Bug 585 — `migrate strip` 生成的侧车草稿落在**正式侧车路径**（`lib.nudo.js`）。
 *
 * 根因：草稿用 `sidecarPathOf(outFile)` 定位 ⇒ 与正式侧车同名同路径 ⇒
 * 草稿被 ambient 侧车表当成真契约加载（草稿内容是「待审模板」，
 * 却以契约身份生效）；而且草稿文件自带的抬头写的又是 `lib.nudo.draft.js`
 * ⇒ 文本与落盘位置自相矛盾。
 *
 * 期望：草稿落在**草稿路径**（`lib.nudo.draft.js`），不进 ambient 侧车表。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 585 — migrate strip 的草稿落在草稿路径", () => {
  it("草稿写进 lib.nudo.draft.js，正式侧车路径 lib.nudo.js 不被占用", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-585-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "lib.ts"),
      `export function add(a: number, b: number): number { return a + b; }\n`,
      "utf-8",
    );

    const results = await migrateStrip([join(dir, "lib.ts")], { write: true, draft: true });

    // 草稿落在草稿路径
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    // 正式侧车路径没有被草稿占用（改前：lib.nudo.js 里躺着草稿内容）
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
    // 结果里的 sidecarDraft 指向草稿路径（CLI 的 "draft" 行也据此打印）
    expect(results[0]!.sidecarDraft?.endsWith("lib.nudo.draft.js")).toBe(true);
  });

  it("草稿抬头自述的文件名与实际落盘一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-585b-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "lib.ts"),
      `export function add(a: number, b: number): number { return a + b; }\n`,
      "utf-8",
    );
    await migrateStrip([join(dir, "lib.ts")], { write: true, draft: true });
    const draft = readFileSync(join(dir, "lib.nudo.draft.js"), "utf-8");
    // 抬头说的是 "lib.nudo.draft.js"（改前：说 draft.js、落在 nudo.js ⇒ 自相矛盾）
    expect(draft).toContain("lib.nudo.draft.js");
    // 抬头说明「复制到 lib.nudo.js 才生效」⇒ 正式侧车路径是 lib.nudo.js
    expect(draft).toContain("lib.nudo.js");
  });
});
