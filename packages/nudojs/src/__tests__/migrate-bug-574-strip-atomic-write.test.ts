/**
 * Bug 574 — `migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。
 *
 * 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚；
 * 异常路径也不携带文件名（只有 Babel 的 "Unexpected token (2:12)"）。
 *
 * 期望：要么全不写，要么明确报告失败于哪个文件 ⇒ 两阶段（先算完再写）+ 事务写盘。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 574 — migrate strip --write 是原子的（无半写状态）", () => {
  it("语法错文件 ⇒ 报错点名文件 + 一个字节都不落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-574-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "a-good.ts"),
      `export function ok(a: number): number {\n  return a + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "z-bad.ts"),
      `export function oops(a: number): number {\n  return a +;\n}\n`,
      "utf-8",
    );

    // 错误信息必须点名文件（改前只有 "Unexpected token (2:12)"）
    await expect(migrateStrip([dir], { write: true, draft: false })).rejects.toThrow(
      /z-bad\.ts/,
    );

    // 半写状态：改前 a-good.js 已落盘 ⇒ 现在必须没有任何产物
    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(existsSync(join(dir, "z-bad.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("语法错文件 ⇒ 错误信息同时含文件名与解析位置", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-574b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "bad.ts"), `const x = ;\n`, "utf-8");
    const err = await migrateStrip([dir], { write: true, draft: false }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/bad\.ts/);
    expect((err as Error).message).toMatch(/\(1:\d+\)/);
  });
});
