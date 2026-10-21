/**
 * Bug 575 — `migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。
 *
 * 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效；
 * 写目标前没有任何「目标已存在」的检查 ⇒ 手写的 `legacy()` 整段消失，exit 0。
 *
 * 期望：覆盖前必须检测 + 拒绝或报错（不得静默）；`--backup` 时先备份既有产物。
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

const TS_SRC = `export function add(a: number, b: number): number { return a + b; }\n`;
const HANDWRITTEN = `export function add(a, b) { return a + b; }\nexport function legacy() { return "hand-written"; }\n`;

describe("Bug 575 — migrate strip --write 不覆盖既有的同名 .js", () => {
  it("既有 util.js ⇒ 拒绝写入并报错（exit 非 0），手写内容原样保留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-575-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.ts"), TS_SRC, "utf-8");
    writeFileSync(join(dir, "util.js"), HANDWRITTEN, "utf-8");

    await expect(migrateStrip([join(dir, "util.ts")], { write: true, draft: false })).rejects.toThrow(
      /target exists/,
    );

    // 手写 JS 必须原样保留（改前：整段被覆盖，legacy() 消失）
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toBe(HANDWRITTEN);
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toContain("legacy");
  });

  it("--backup ⇒ 既有产物先备份再写（不丢数据）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-575b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.ts"), TS_SRC, "utf-8");
    writeFileSync(join(dir, "util.js"), HANDWRITTEN, "utf-8");

    const results = await migrateStrip([join(dir, "util.ts")], {
      write: true,
      draft: false,
      backup: true,
    });

    // 产物被写出
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toContain("function add(a, b)");
    // 既有内容进了备份（不丢数据）
    expect(existsSync(join(dir, "util.js.bak"))).toBe(true);
    expect(readFileSync(join(dir, "util.js.bak"), "utf-8")).toBe(HANDWRITTEN);
    // 备份动作在输出里可观测
    expect(results[0]!.notes.join("\n")).toMatch(/backed up existing .*util\.js/);
  });

  it("幂等重跑（目标内容逐字相同）⇒ 不报错、不丢内容", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-575c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.ts"), TS_SRC, "utf-8");
    await migrateStrip([join(dir, "util.ts")], { write: true, draft: false });
    const first = readFileSync(join(dir, "util.js"), "utf-8");
    await expect(
      migrateStrip([join(dir, "util.ts")], { write: true, draft: false }),
    ).resolves.toBeTruthy();
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toBe(first);
  });
});
