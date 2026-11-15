/**
 * Bug 591 — `migrate strip --backup` 撞到已存在的 `<file>.ts.bak` 时**静默跳过备份**。
 *
 * 根因：备份分支的条件是 `!existsSync(`${file}.bak`)` ⇒ 撞名就什么都不做，
 * exit 0、输出里也没有一行说明 ⇒ 用户以为备份了，其实在写一份「看起来像备份、
 * 内容却是旧的」的文件，后续按 `.bak` 恢复会拿到陈旧源码。
 *
 * 期望：备份成功与否必须在输出里有一行明确交代；撞名不得静默跳过。
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

describe("Bug 591 — migrate strip --backup 撞名不静默跳过", () => {
  it("已有 keep.ts.bak ⇒ 换名留底（keep.ts.1.bak），且旧备份原样保留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-591-"));
    dirs.push(dir);
    writeFileSync(join(dir, "keep.ts.bak"), `export const OLD = 1;\n`, "utf-8");
    writeFileSync(join(dir, "keep.ts"), `export function keep(): number { return 1; }\n`, "utf-8");

    const results = await migrateStrip([dir], { write: true, draft: false, backup: true });

    // 源确实被改名留底（改前：源留在原地、备份静默跳过）
    expect(existsSync(join(dir, "keep.ts"))).toBe(false);
    // 新备份不撞名
    expect(existsSync(join(dir, "keep.ts.1.bak"))).toBe(true);
    expect(readFileSync(join(dir, "keep.ts.1.bak"), "utf-8")).toContain("function keep");
    // 旧备份没被覆盖（陈旧内容仍可辨认）
    expect(readFileSync(join(dir, "keep.ts.bak"), "utf-8")).toContain("OLD");
  });

  it("备份动作在输出里有一行明确交代（源是否被改名是可观测事实）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-591b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "keep.ts.bak"), `export const OLD = 1;\n`, "utf-8");
    writeFileSync(join(dir, "keep.ts"), `export function keep(): number { return 1; }\n`, "utf-8");

    const results = await migrateStrip([dir], { write: true, draft: false, backup: true });
    const notes = results.flatMap((r) => r.notes).join("\n");
    expect(notes).toMatch(/backed up .*keep\.ts\.1\.bak/);
  });

  it("没有撞名时备份名仍是 <file>.bak", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-591c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "keep.ts"), `export function keep(): number { return 1; }\n`, "utf-8");

    await migrateStrip([dir], { write: true, draft: false, backup: true });
    expect(existsSync(join(dir, "keep.ts.bak"))).toBe(true);
    expect(existsSync(join(dir, "keep.ts"))).toBe(false);
  });
});
